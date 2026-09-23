"""Run the existing Agent against a trusted, project-local official environment."""

import importlib
import json
import logging
import math
import os
import re
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from ai.agents.agent import Agent
from ai.models.llm import provider
from ai.models.workspace import (
    Activity,
    Budget,
    Campaign,
    Capabilities,
    Dataset,
    DomainError,
    Limit,
    Pilot,
    Snapshot,
    Targeting,
)
from ai.pipelines.data import parse_dataset

log = logging.getLogger(__name__)
ROOT = Path(__file__).resolve().parents[2]
ENV_REASON = "Official pilot environment unavailable. Configure NX_ENV_FACTORY with a project-local factory implementing run_pilot. Uploaded audience data remains available."


def now():
    return datetime.now(timezone.utc).isoformat()


def factory_reference():
    reference = os.getenv("NX_ENV_FACTORY", "").strip()
    if not reference:
        raise DomainError("ENV_UNAVAILABLE", ENV_REASON, 409)
    if not re.fullmatch(r"[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*:[A-Za-z_]\w*", reference):
        raise DomainError(
            "ENV_CONFIGURATION",
            "NX_ENV_FACTORY must be a project-local module:function.",
            503,
        )
    module, name = reference.split(":")
    path = ROOT.joinpath(*module.split(".")).with_suffix(".py")
    if not path.is_file() or not path.resolve().is_relative_to(ROOT):
        raise DomainError(
            "ENV_CONFIGURATION",
            "The configured environment module is missing from the project.",
            503,
        )
    return module, name


def capabilities():
    _, llm_reason = provider()
    try:
        factory_reference()
        return Capabilities(run_agent=True, llm_explanations=llm_reason is None)
    except DomainError as error:
        return Capabilities(
            run_agent=False, llm_explanations=llm_reason is None, reason=error.message
        )


def data_snapshot(dataset: Dataset | None):
    return Snapshot(
        state="DATA_READY" if dataset else "INITIAL",
        updated_at=now(),
        capabilities=capabilities(),
        audience_total=len(dataset.customer_profile) if dataset else None,
        audience=dataset.customer_profile if dataset else [],
        tariffs=dataset.tariffs if dataset else [],
        channels=dataset.channels if dataset else [],
        summary="Audience data validated. No pilot outcomes or predictions have been generated."
        if dataset
        else None,
        next_action="Run Agent using the configured official environment."
        if capabilities().run_agent
        else ENV_REASON,
    )


def environment_data(env):
    profile = getattr(env, "customer_profile", None)
    if not isinstance(profile, pd.DataFrame):
        raise DomainError(
            "ENV_CONTRACT", "Environment customer_profile must be a DataFrame."
        )
    raw = {"customer_profile": json.loads(profile.to_json(orient="records"))}
    for name in ("tariffs", "channels"):
        value = getattr(env, name, None)
        if isinstance(value, pd.DataFrame):
            value = json.loads(value.to_json(orient="records"))
        if not isinstance(value, list) or not value:
            raise DomainError(
                "ENV_CONTRACT",
                f"Environment {name} must provide an explicit catalog; see docs/api.md.",
            )
        raw[name] = value
    history = getattr(env, "change_tariff", None)
    if isinstance(history, pd.DataFrame) and not history.empty:
        raw["change_tariff"] = json.loads(history.to_json(orient="records"))
    return parse_dataset(json.dumps(raw, allow_nan=False).encode(), "application/json")


def resources(env):
    values = []
    for name in ("remaining_budget", "remaining_contacts", "pilots_left"):
        value = getattr(env, name, None)
        if (
            isinstance(value, bool)
            or not isinstance(value, (float, int))
            or not math.isfinite(value)
            or value < 0
        ):
            raise DomainError(
                "ENV_CONTRACT", f"Environment {name} must be finite and non-negative."
            )
        if name != "remaining_budget" and int(value) != value:
            raise DomainError("ENV_CONTRACT", f"Environment {name} must be an integer.")
        values.append(float(value) if name == "remaining_budget" else int(value))
    return tuple(values)


class ObservedEnvironment:
    def __init__(self, env, dataset, agent, publish):
        self.env, self.dataset, self.agent, self.publish = env, dataset, agent, publish
        self.customer_profile = pd.DataFrame(
            [row.model_dump(exclude_none=True) for row in dataset.customer_profile]
        )
        self.tariffs = {row.id: {"price": row.price} for row in dataset.tariffs}
        self.channels = {row.id: row for row in dataset.channels}
        self.initial = resources(env)
        self.pilots = []
        self.events = []
        self.calls = 0

    def __getattr__(self, key):
        return getattr(self.env, key)

    def event(self, title, status, description=None):
        self.events.append(
            Activity(
                id=f"event-{len(self.events) + 1}",
                title=title,
                status=status,
                description=description,
                timestamp=now(),
            )
        )
        log.info("agent_stage stage=%s", title)

    def resource_fields(self, allocated=0.0, reserved=0):
        budget, contacts, pilots = resources(self.env)
        initial_budget, initial_contacts, initial_pilots = self.initial
        if (
            budget > initial_budget
            or contacts > initial_contacts
            or pilots > initial_pilots
            or allocated > budget + 1e-7
            or reserved > contacts
        ):
            raise DomainError(
                "ENV_CONTRACT", "Environment resource accounting is inconsistent."
            )
        return {
            "budget": Budget(
                total=initial_budget,
                exploration_spent=initial_budget - budget,
                campaigns_allocated=allocated,
                remaining=max(0.0, budget - allocated),
            ).model_dump(),
            "contacts": Limit(
                total=initial_contacts,
                used=initial_contacts - contacts + reserved,
                remaining=contacts - reserved,
            ).model_dump(),
            "pilot_limit": Limit(
                total=initial_pilots, used=initial_pilots - pilots, remaining=pilots
            ).model_dump(),
        }

    def update(self, state, **fields):
        self.publish(
            {
                "state": state,
                "updated_at": now(),
                "pilots": [p.model_dump(exclude_none=True) for p in self.pilots],
                "events": [e.model_dump(exclude_none=True) for e in self.events],
                **self.resource_fields(),
                **fields,
            }
        )

    def scope(self, args):
        rows = self.customer_profile
        for key in ("current_tariff", "arpu_segment", "data_segment", "call_segment"):
            value = args.get("filter_" + key)
            if value is not None:
                if key not in rows:
                    raise DomainError(
                        "INVALID_CAMPAIGN",
                        "Campaign references an unavailable segment.",
                    )
                rows = rows[rows[key] == value]
        return rows

    def run_pilot(self, **args):
        n, channel, target = (
            args.get("n_customers"),
            args.get("channel"),
            args.get("target_tariff"),
        )
        before = resources(self.env)
        if (
            self.calls >= 18
            or type(n) is not int
            or not 10 <= n <= 200
            or channel not in self.channels
            or target not in self.tariffs
        ):
            raise DomainError(
                "INVALID_PILOT", "Pilot arguments violate the configured limits."
            )
        rows = self.scope(args)
        if (
            len(rows) < n
            or n > before[1]
            or before[2] < 1
            or self.channels[channel].cost * n > before[0] + 1e-7
        ):
            raise DomainError(
                "RESOURCE_LIMIT",
                "Not enough eligible audience, contacts, pilots, or budget.",
            )
        self.calls += 1
        self.event(
            "Pilot started", "running", f"Requested sample: {n}. Results pending."
        )
        self.update("PILOT_RUNNING")
        result = self.env.run_pilot(**args)
        after = resources(self.env)
        actual_n = before[1] - after[1]
        cost = before[0] - after[0]
        if (
            not 0 < actual_n <= n
            or after[2] != before[2] - 1
            or cost < 0
            or not math.isclose(
                cost, self.channels[channel].cost * actual_n, abs_tol=1e-6
            )
        ):
            raise DomainError(
                "ENV_CONTRACT",
                "Pilot resource counters do not match the actual sample and channel cost.",
            )
        raw = self.agent._object_to_mapping(result)
        reported_n = self.agent._first_number(raw, ["sample_size", "n_customers", "n"])
        if reported_n is not None and reported_n != actual_n:
            raise DomainError(
                "ENV_CONTRACT",
                "Pilot sample size disagrees with environment resource counters.",
            )
        effect = self.agent._extract_effect(
            result, float(rows["arpu"].mean()), actual_n
        )
        if effect is not None and not math.isfinite(effect):
            raise DomainError("ENV_CONTRACT", "Pilot returned a non-finite effect.")
        measured = {}
        for field in ("confidence", "uncertainty"):
            if field in raw and raw[field] is not None:
                value = self.agent._as_float(raw[field])
                if value is None or value < 0 or (field == "confidence" and value > 1):
                    raise DomainError(
                        "ENV_CONTRACT", "Pilot confidence or uncertainty is invalid."
                    )
                measured[field] = value
        pilot = Pilot(
            **measured,
            audience_size=len(rows),
            id=f"pilot-{self.calls}",
            target_tariff=target,
            channel=channel,
            targeting=Targeting(
                **{
                    key.removeprefix("filter_"): value
                    for key, value in args.items()
                    if key.startswith("filter_")
                }
            ),
            observed_effect=effect,
            sample_size=actual_n,
            cost=cost,
            timestamp=now(),
            status="needs_more_data" if effect is None else "uncertain",
            reasoning="Observed relative effect from the official pilot. Confidence and uncertainty are displayed only when explicitly supplied by the environment."
            if effect is not None
            else "The result contains no supported relative-effect measure.",
        )
        self.pilots.append(pilot)
        self.event(
            "Pilot completed",
            "completed",
            f"Actual sample: {actual_n}; cost: {cost:g}.",
        )
        self.update("AGENT_RUNNING")
        # Normalize only verified measures; don't propagate arbitrary result objects.
        return {"relative_effect": effect, "sample_size": actual_n}


def execute(dataset_payload, publish):
    module, name = factory_reference()
    factory = getattr(importlib.import_module(module), name, None)
    if not callable(factory):
        raise DomainError(
            "ENV_CONFIGURATION", "Configured environment factory is not callable."
        )
    uploaded = Dataset.model_validate(dataset_payload) if dataset_payload else None
    inputs = (
        {
            "customer_profile": pd.DataFrame(
                [row.model_dump(exclude_none=True) for row in uploaded.customer_profile]
            ),
            "tariffs": [row.model_dump(exclude_none=True) for row in uploaded.tariffs],
            "channels": [
                row.model_dump(exclude_none=True) for row in uploaded.channels
            ],
            "change_tariff": pd.DataFrame(
                [row.model_dump() for row in uploaded.change_tariff]
            ),
        }
        if uploaded
        else None
    )
    env = factory(inputs)
    if not callable(getattr(env, "run_pilot", None)):
        raise DomainError(
            "ENV_CONTRACT", "Official environment must implement run_pilot."
        )
    dataset = environment_data(env)
    agent = Agent(
        history=pd.DataFrame([row.model_dump() for row in dataset.change_tariff]),
        channel_costs={row.id: row.cost for row in dataset.channels},
        channel_effectiveness={row.id: row.effectiveness for row in dataset.channels},
    )
    observed = ObservedEnvironment(env, dataset, agent, publish)
    start = data_snapshot(dataset).model_dump(exclude_none=True)
    start["state"] = "AGENT_RUNNING"
    publish(start)
    observed.event(
        "Agent started", "running", "Using actual environment data and pilot results."
    )
    observed.update("AGENT_RUNNING")
    campaigns = agent.act(observed)
    observed.event(
        "Portfolio optimization",
        "running",
        "Applying resource limits and the existing conservative scoring strategy.",
    )
    observed.update("OPTIMIZING")
    selected, ids, allocated, reserved = [], set(), 0.0, 0
    for index, row in enumerate(campaigns):
        audience = observed.scope(row)
        current_ids = set(audience["id"])
        if (
            not current_ids
            or len(current_ids) > 5000
            or ids & current_ids
            or len(selected) >= 10
        ):
            raise DomainError(
                "INVALID_PORTFOLIO",
                "Campaign audience is empty, overlapping, or exceeds the case limits.",
            )
        channel, target = row["channel"], row["target_tariff"]
        if channel not in observed.channels or target not in observed.tariffs:
            raise DomainError(
                "INVALID_PORTFOLIO", "Campaign references an unknown channel or tariff."
            )
        evidence = [
            p.id
            for p in observed.pilots
            if p.target_tariff == target
            and p.targeting.current_tariff == row.get("filter_current_tariff")
            and p.targeting.arpu_segment == row.get("filter_arpu_segment")
            and p.observed_effect is not None
        ]
        if not evidence:
            raise DomainError(
                "INVALID_PORTFOLIO", "Campaign has no measured pilot evidence."
            )
        c = next(
            c
            for c in agent.candidates
            if c.current_tariff == row["filter_current_tariff"]
            and c.arpu_segment == row.get("filter_arpu_segment")
            and c.target_tariff == target
        )
        mean, penalty = agent._candidate_posterior(c)
        cost = len(current_ids) * observed.channels[channel].cost
        estimate = (
            c.avg_arpu
            * (mean - 0.85 * penalty)
            * observed.channels[channel].effectiveness
            - observed.channels[channel].cost
        ) * len(current_ids)
        selected.append(
            Campaign(
                id=f"campaign-{index + 1}",
                name=row["campaign_name"],
                target_tariff=target,
                channel=channel,
                targeting=Targeting(
                    current_tariff=c.current_tariff, arpu_segment=c.arpu_segment
                ),
                audience_size=len(current_ids),
                estimated_cost=cost,
                expected_impact=estimate,
                evidence_ids=evidence,
                reasoning=f"Conservative strategy estimate based on {len(evidence)} actual pilot(s), observed ARPU, channel economics, and the agent's shrinkage/risk penalty. Not a realized financial result.",
                risk="Heuristic estimate; no calibrated confidence interval. Audience size is the full eligible filter population; contact resources include pilot use.",
            )
        )
        ids.update(current_ids)
        allocated += cost
        reserved += len(current_ids)
    fields = observed.resource_fields(allocated, reserved)
    facts = {
        "audience": f"Validated {len(dataset.customer_profile)} subscribers.",
        "pilots": f"Completed {len(observed.pilots)} actual pilots.",
        "portfolio": f"Selected {len(selected)} evidence-backed campaigns, reserving {reserved} campaign contacts and {allocated:g} budget.",
    }
    explainer, reason = provider()
    summary, mode = explainer.explain(facts)
    if reason or mode not in {"deterministic", "llm_ordered_verified_facts"}:
        observed.event("Explanation status", "warning", reason or mode)
    observed.event(
        "Agent completed",
        "completed",
        "No campaign has been sent. Selected campaigns are recommendations for review.",
    )
    observed.update(
        "COMPLETED",
        campaigns=[c.model_dump(exclude_none=True) for c in selected],
        summary=summary,
        next_action="Review and export the proposed campaigns."
        if selected
        else "No positive evidence-backed portfolio fits the current resource limits. Review pilots and data.",
        **fields,
    )


def worker(dataset, queue):
    try:
        execute(dataset, lambda update: queue.put(("update", update)))
        queue.put(("done", None))
    except DomainError as error:
        log.warning("agent_failed code=%s", error.code)
        queue.put(("error", {"code": error.code, "message": error.message}))
    except Exception as error:  # noqa: BLE001 - worker boundary sanitizes third-party failures
        log.error("agent_failed type=%s", type(error).__name__)
        queue.put(
            (
                "error",
                {
                    "code": "AGENT_FAILED",
                    "message": "Agent execution failed. Check the official environment adapter and server logs.",
                },
            )
        )
