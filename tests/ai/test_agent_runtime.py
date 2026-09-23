"""Synthetic fixtures below are only unit-test inputs, never product data."""

import json
import math

import pandas as pd
import pytest

from HACKTON.ai.agents.agent_backup import Agent, Candidate
from ai.models.workspace import DomainError, Snapshot
from ai.pipelines.data import MAX_BYTES, parse_dataset
from ai.pipelines.runtime import execute


def dataset_payload():
    return {
        "customer_profile": [
            {"id": f"unit-{i}", "current_tariff": "unit-a", "arpu": 1000}
            for i in range(300)
        ],
        "tariffs": [{"id": "unit-a", "price": 1000}, {"id": "unit-b", "price": 1200}],
        "channels": [
            {"id": "push", "cost": 0, "effectiveness": 0.5},
            {"id": "sms", "cost": 4, "effectiveness": 0.65},
        ],
    }


class TestEnvironment:
    __test__ = False

    def __init__(self, inputs=None):
        payload = dataset_payload()
        self.customer_profile = (
            inputs["customer_profile"]
            if inputs
            else pd.DataFrame(payload["customer_profile"])
        )
        self.tariffs = inputs["tariffs"] if inputs else payload["tariffs"]
        self.channels = inputs["channels"] if inputs else payload["channels"]
        self.remaining_budget, self.remaining_contacts, self.pilots_left = (
            10000.0,
            2000,
            3,
        )

    def run_pilot(self, **args):
        n = args["n_customers"]
        channel = next(item for item in self.channels if item["id"] == args["channel"])
        self.remaining_contacts -= n
        self.remaining_budget -= n * channel["cost"]
        self.pilots_left -= 1
        return {"relative_effect": 0.4 * channel["effectiveness"], "sample_size": n}


def environment_factory(inputs):
    return TestEnvironment(inputs)


@pytest.mark.parametrize(
    "content,media",
    [
        (b"", "text/csv"),
        (b"id,current_tariff\na,a\n", "text/csv"),
        (b"id,current_tariff,arpu\na,a,NaN\n", "text/csv"),
        (b"id,current_tariff,arpu\na,a,inf\n", "text/csv"),
        (b"id,current_tariff,arpu\na,a,-1\n", "text/csv"),
        (b"id,current_tariff,arpu\na,a,1,extra\n", "text/csv"),
        (b"id,id,current_tariff,arpu\na,a,a,1\n", "text/csv"),
        (b"{", "application/json"),
        (b'{"customer_profile":[]}', "application/json"),
        (b'{"customer_profile":[],"customer_profile":[]}', "application/json"),
        (
            b'{"customer_profile":[{"id":"a","current_tariff":"a","arpu":NaN}]}',
            "application/json",
        ),
        (b"x", "application/octet-stream"),
    ],
)
def test_reject_invalid_data(content, media):
    with pytest.raises(DomainError):
        parse_dataset(content, media)


def test_csv_aliases_and_real_values():
    data = parse_dataset(
        b"customer_id,current_tariff,arpu_3m_avg\nunit-id,unit-a,123.5\n", "text/csv"
    )
    assert data.customer_profile[0].id == "unit-id"
    assert data.customer_profile[0].arpu == 123.5


def test_size_limit():
    with pytest.raises(DomainError) as caught:
        parse_dataset(b"x" * (MAX_BYTES + 1), "text/csv")
    assert caught.value.status == 413


def test_duplicate_ids_and_unknown_tariffs():
    payload = dataset_payload()
    payload["customer_profile"][1]["id"] = "unit-0"
    with pytest.raises(DomainError, match="unique"):
        parse_dataset(json.dumps(payload).encode(), "application/json")
    payload = dataset_payload()
    payload["customer_profile"][0]["current_tariff"] = "absent"
    with pytest.raises(DomainError, match="missing"):
        parse_dataset(json.dumps(payload).encode(), "application/json")


def test_percent_and_ambiguous_units():
    agent = Agent()
    assert agent._extract_effect({"effect_pct": 0.5}, 100, 10) == 0.005
    assert agent._extract_effect({"effect_pct": -0.5}, 100, 10) == -0.005
    assert agent._extract_effect({"profit": 100}, 100, 10) is None
    assert agent._extract_effect({"mystery_change": 5}, 100, 10) is None
    assert agent._extract_effect({"relative_effect": math.inf}, 100, 10) is None


def test_pilot_failure_never_retried():
    class Broken:
        calls = 0

        def run_pilot(self, **kwargs):
            self.calls += 1
            raise TypeError("internal failure after debit")

    env = Broken()
    with pytest.raises(TypeError):
        Agent()._safe_run_pilot(env, Candidate("a", "b", None, 40, 100), "sms", 10)
    assert env.calls == 1


def test_no_forced_campaign_when_resources_or_evidence_missing():
    agent = Agent()
    env = TestEnvironment()
    env.remaining_contacts = 0
    assert agent.act(env) == []
    c = Candidate("unit-a", "unit-b", None, 100, 1000)
    env.remaining_contacts = 1000
    assert agent._select_portfolio(env, [c], ["push"]) == []
    assert agent._pilot_size(env, c, "sms", 120) <= env.remaining_contacts


def test_cheaper_feasible_campaign_is_considered():
    agent = Agent()
    env = TestEnvironment()
    env.remaining_budget = 0
    c = Candidate("a", "b", None, 100, 1000, pilots=[{"base_effect": 0.5, "n": 200}])
    campaigns = agent._select_portfolio(env, [c], ["call", "push"])
    assert len(campaigns) == 1 and campaigns[0]["channel"] == "push"


def test_execute_contract_and_accounting(monkeypatch):
    monkeypatch.setenv(
        "NX_ENV_FACTORY", "tests.ai.test_agent_runtime:environment_factory"
    )
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    updates = []
    execute(None, updates.append)
    snapshot = Snapshot()
    for update in updates:
        snapshot = Snapshot.model_validate({**snapshot.model_dump(), **update})
    assert snapshot.state == "COMPLETED"
    assert snapshot.pilots and snapshot.campaigns
    assert snapshot.audience_total == 300
    assert snapshot.budget.total == pytest.approx(
        snapshot.budget.exploration_spent
        + snapshot.budget.campaigns_allocated
        + snapshot.budget.remaining
    )
    assert (
        snapshot.contacts.total == snapshot.contacts.used + snapshot.contacts.remaining
    )
    assert all(c.evidence_ids for c in snapshot.campaigns)
    assert len(snapshot.pilots) <= 3
    assert all(p.sample_size >= 10 for p in snapshot.pilots)
    assert "No campaign has been sent" in snapshot.events[-1].description


def hanging_factory(inputs):
    import time

    time.sleep(60)
    return TestEnvironment(inputs)


def failing_factory(inputs):
    raise RuntimeError("unit-secret-must-not-reach-client")


def test_boolean_is_not_arpu():
    with pytest.raises(DomainError):
        parse_dataset(
            b'{"customer_profile":[{"id":"unit","current_tariff":"unit","arpu":true}]}',
            "application/json",
        )


def test_partial_segments_are_rejected():
    payload = dataset_payload()
    payload["customer_profile"][0]["arpu_segment"] = "unit-segment"
    with pytest.raises(DomainError, match="every subscriber"):
        parse_dataset(json.dumps(payload).encode(), "application/json")


class DebitFailureEnvironment(TestEnvironment):
    def run_pilot(self, **args):
        super().run_pilot(**args)
        raise RuntimeError("unit-secret-failure-after-debit")


def debit_failure_factory(inputs):
    return DebitFailureEnvironment(inputs)
