from __future__ import annotations

import logging
import math
import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

try:
    import pandas as pd
except (
    ImportError
):  # evaluator is expected to provide pandas because customer_profile is a DataFrame
    pd = None


log = logging.getLogger(__name__)

# Existing case economics; HTTP runtime requires an explicit catalog from the environment.
_CHANNEL_COST = {
    "push": 0.0,
    "sms": 4.0,
    "digital_ads": 22.0,
    "call": 160.0,
}

_CHANNEL_EFF = {
    "push": 0.50,
    "sms": 0.65,
    "digital_ads": 0.85,
    "call": 1.20,
}

_MAX_CAMPAIGNS = 10
_MAX_CAMPAIGN_SIZE = 5000
_MAX_PILOT_SIZE = 200
_MIN_PILOT_SIZE = 10


@dataclass
class Candidate:
    current_tariff: str
    target_tariff: str
    arpu_segment: str | None
    size: int
    avg_arpu: float
    prior_effect: float = 0.0
    prior_n: int = 0
    pilots: list[dict[str, Any]] = field(default_factory=list)

    @property
    def segment_key(self) -> tuple[str, str | None]:
        return self.current_tariff, self.arpu_segment


class Agent:
    """Adaptive tariff-campaign agent for the HackAlem AI Beeline case.

    Design goals:
    - no hard-coded winning tariff/segment;
    - use real env data and real env.run_pilot results;
    - exploration -> confirmation -> economic portfolio selection;
    - respect budget/contact/pilot limits;
    - gracefully degrade when optional historical files/columns are unavailable.
    """

    def __init__(self, *, history=None, channel_costs=None, channel_effectiveness=None):
        self.history = history
        self._cost = dict(_CHANNEL_COST if channel_costs is None else channel_costs)
        self._eff = dict(
            _CHANNEL_EFF if channel_effectiveness is None else channel_effectiveness
        )
        self.candidates: list[Candidate] = []

    def act(self, env) -> list[dict]:
        profile = getattr(env, "customer_profile", None)
        if profile is None or not hasattr(profile, "columns") or len(profile) == 0:
            return self._minimal_fallback(env)

        columns = self._detect_profile_columns(profile)
        tariff_col = columns["tariff"]
        if tariff_col is None:
            return self._minimal_fallback(env)

        tariffs, tariff_prices = self._extract_tariffs(getattr(env, "tariffs", None))
        if not tariffs:
            return self._minimal_fallback(env)

        channels = self._extract_channels(getattr(env, "channels", None))
        channels = [
            channel
            for channel in channels
            if channel in self._cost and channel in self._eff
        ]
        if not channels:
            return []

        historical = self._load_historical_priors()
        candidates = self._build_candidates(
            profile=profile,
            columns=columns,
            tariffs=tariffs,
            tariff_prices=tariff_prices,
            historical=historical,
        )
        self.candidates = candidates
        if not candidates:
            return self._minimal_fallback(
                env,
                profile=profile,
                tariff_col=tariff_col,
                tariffs=tariffs,
                channels=channels,
            )

        # Stage 1: broad and cheap exploration. Push costs nothing and lets us rank hidden effects.
        stage1_channel = (
            "push" if "push" in channels else self._cheapest_channel(channels)
        )
        stage1 = candidates[: min(12, len(candidates))]
        for cand in stage1:
            if not self._can_pilot(env, cand, stage1_channel, desired_n=40):
                continue
            n = self._pilot_size(env, cand, stage1_channel, desired_n=40)
            result = self._safe_run_pilot(env, cand, stage1_channel, n)
            if result is not None:
                cand.pilots.append(
                    self._pilot_observation(result, cand, stage1_channel, n)
                )

        # Rank using pilot-normalized hidden effect, shrunk toward historical prior.
        explored = [c for c in stage1 if c.pilots]
        explored.sort(key=self._candidate_exploration_score, reverse=True)

        # Stage 2: confirm a few promising / uncertain candidates with a stronger but still cheap channel.
        confirm_channel = "sms" if "sms" in channels else stage1_channel
        for cand in explored[: min(5, len(explored))]:
            if not self._can_pilot(env, cand, confirm_channel, desired_n=100):
                continue
            # Larger sample only when first-stage signal is not clearly terrible.
            if self._candidate_exploration_score(cand) < -0.03:
                continue
            desired = 120 if self._candidate_uncertainty(cand) > 0.035 else 80
            n = self._pilot_size(env, cand, confirm_channel, desired_n=desired)
            result = self._safe_run_pilot(env, cand, confirm_channel, n)
            if result is not None:
                cand.pilots.append(
                    self._pilot_observation(result, cand, confirm_channel, n)
                )

        # Optional final confirmation for the single strongest but still uncertain candidate.
        explored.sort(key=self._candidate_exploration_score, reverse=True)
        if explored:
            best = explored[0]
            if (
                self._candidate_uncertainty(best) > 0.025
                and self._candidate_exploration_score(best) > 0
            ):
                final_channel = "sms" if "sms" in channels else stage1_channel
                if self._can_pilot(env, best, final_channel, desired_n=180):
                    n = self._pilot_size(env, best, final_channel, desired_n=180)
                    result = self._safe_run_pilot(env, best, final_channel, n)
                    if result is not None:
                        best.pilots.append(
                            self._pilot_observation(result, best, final_channel, n)
                        )

        return self._select_portfolio(env, explored or candidates, channels)

    # ------------------------------------------------------------------
    # Data discovery
    # ------------------------------------------------------------------

    def _detect_profile_columns(self, df) -> dict[str, str | None]:
        cols = [str(c) for c in df.columns]
        return {
            "tariff": self._find_column(
                cols,
                [
                    r"^current_tariff$",
                    r"current.*tariff",
                    r"tariff.*current",
                    r"^tariff$",
                    r"tariff_id",
                ],
            ),
            "arpu_segment": self._find_column(
                cols, [r"^arpu_segment$", r"arpu.*segment"]
            ),
            "predicted_arpu": self._find_column(
                cols, [r"^predicted_arpu$", r"pred.*arpu", r"arpu.*pred"]
            ),
            "arpu": self._find_column(
                cols, [r"^arpu_3m_avg$", r"arpu.*avg", r"^arpu$"]
            ),
        }

    @staticmethod
    def _find_column(columns: Iterable[str], patterns: Iterable[str]) -> str | None:
        for pattern in patterns:
            rx = re.compile(pattern, re.IGNORECASE)
            for col in columns:
                if rx.search(col):
                    return col
        return None

    def _extract_tariffs(self, raw: Any) -> tuple[list[str], dict[str, float]]:
        names: list[str] = []
        prices: dict[str, float] = {}
        if raw is None:
            return names, prices

        if hasattr(raw, "columns") and hasattr(raw, "iterrows"):
            cols = [str(c) for c in raw.columns]
            name_col = self._find_column(
                cols, [r"^tariff$", r"tariff_name", r"tariff_id", r"^name$"]
            )
            price_col = self._find_column(
                cols, [r"price", r"fee", r"monthly.*cost", r"subscription"]
            )
            if name_col:
                for _, row in raw.iterrows():
                    name = str(row[name_col])
                    if name and name != "nan":
                        names.append(name)
                        if price_col:
                            price = self._as_float(row[price_col])
                            if price is not None:
                                prices[name] = price
            return self._unique(names), prices

        if isinstance(raw, Mapping):
            # Common shapes: {tariff_name: {...}} or {"tariffs": [...]}.
            if "tariffs" in raw:
                return self._extract_tariffs(raw["tariffs"])
            for key, value in raw.items():
                if isinstance(value, Mapping):
                    name = str(
                        value.get("name")
                        or value.get("tariff")
                        or value.get("tariff_id")
                        or key
                    )
                    price = self._first_number(
                        value, ["price", "fee", "monthly_fee", "cost"]
                    )
                else:
                    name = str(key)
                    price = (
                        self._as_float(value)
                        if isinstance(value, (int, float))
                        else None
                    )
                names.append(name)
                if price is not None:
                    prices[name] = price
            return self._unique(names), prices

        if isinstance(raw, (list, tuple, set)):
            for item in raw:
                if isinstance(item, Mapping):
                    name = str(
                        item.get("name")
                        or item.get("tariff")
                        or item.get("tariff_id")
                        or ""
                    )
                    if name:
                        names.append(name)
                        price = self._first_number(
                            item, ["price", "fee", "monthly_fee", "cost"]
                        )
                        if price is not None:
                            prices[name] = price
                else:
                    names.append(str(item))
            return self._unique(names), prices

        return [str(raw)], prices

    def _extract_channels(self, raw: Any) -> list[str]:
        if raw is None:
            return []
        values: list[str] = []
        if hasattr(raw, "columns") and hasattr(raw, "iterrows"):
            cols = [str(c) for c in raw.columns]
            col = self._find_column(cols, [r"^channel$", r"^name$"])
            if col:
                values = [str(v) for v in raw[col].dropna().tolist()]
        elif isinstance(raw, Mapping):
            values = [str(k) for k in raw]
        elif isinstance(raw, (list, tuple, set)):
            for item in raw:
                if isinstance(item, Mapping):
                    values.append(str(item.get("name") or item.get("channel") or ""))
                else:
                    values.append(str(item))
        else:
            values = [str(raw)]
        return [v for v in self._unique(values) if v]

    # ------------------------------------------------------------------
    # Historical priors (optional, never required for correctness)
    # ------------------------------------------------------------------

    def _load_historical_priors(self) -> dict[tuple[str, str], tuple[float, int]]:
        if pd is None:
            return {}
        df = self.history
        if df is None:
            root = Path(__file__).resolve().parents[2]
            path = root / "data" / "change_tariff.csv"
            if not path.is_file() or not path.resolve().is_relative_to(root):
                return {}
            try:
                df = pd.read_csv(path)
            except (OSError, ValueError):
                log.warning("historical_data_unavailable")
                return {}
        if df.empty:
            return {}

        cols = [str(c) for c in df.columns]
        old_col = self._find_column(
            cols,
            [
                r"old.*tariff",
                r"previous.*tariff",
                r"from.*tariff",
                r"current.*tariff",
                r"tariff.*before",
            ],
        )
        new_col = self._find_column(
            cols, [r"new.*tariff", r"target.*tariff", r"to.*tariff", r"tariff.*after"]
        )
        before_col = self._find_column(
            cols,
            [
                r"arpu.*before",
                r"before.*arpu",
                r"old.*arpu",
                r"prev.*arpu",
                r"arpu.*pre",
            ],
        )
        after_col = self._find_column(
            cols, [r"arpu.*after", r"after.*arpu", r"new.*arpu", r"arpu.*post"]
        )
        if not (old_col and new_col and before_col and after_col):
            return {}

        try:
            work = df[[old_col, new_col, before_col, after_col]].copy()
            work[before_col] = pd.to_numeric(work[before_col], errors="coerce")
            work[after_col] = pd.to_numeric(work[after_col], errors="coerce")
            work = work.replace([float("inf"), -float("inf")], float("nan")).dropna()
            work = work[work[before_col].abs() > 1e-9]
            if work.empty:
                return {}
            work["__effect"] = (work[after_col] - work[before_col]) / work[
                before_col
            ].abs()
            # Winsorize extreme historical outliers rather than fitting to them.
            work["__effect"] = work["__effect"].clip(-1.0, 2.0)
            grouped = work.groupby([old_col, new_col])["__effect"].agg(
                ["mean", "count"]
            )
            global_mean = float(work["__effect"].mean())
            priors: dict[tuple[str, str], tuple[float, int]] = {}
            for (old_t, new_t), row in grouped.iterrows():
                n = int(row["count"])
                raw = float(row["mean"])
                # Empirical-Bayes style shrinkage; low-count transitions stay close to broad prior.
                w = n / (n + 35.0)
                effect = w * raw + (1.0 - w) * global_mean
                priors[(str(old_t), str(new_t))] = (effect, n)
            return priors
        except (TypeError, ValueError, KeyError):
            log.warning("historical_data_invalid")
            return {}

    # ------------------------------------------------------------------
    # Candidate generation
    # ------------------------------------------------------------------

    def _build_candidates(
        self,
        profile,
        columns: dict[str, str | None],
        tariffs: list[str],
        tariff_prices: dict[str, float],
        historical: dict[tuple[str, str], tuple[float, int]],
    ) -> list[Candidate]:
        tariff_col = columns["tariff"]
        arpu_seg_col = columns["arpu_segment"]
        arpu_value_col = columns["predicted_arpu"] or columns["arpu"]
        if tariff_col is None:
            return []

        work = profile.copy()
        work = work[work[tariff_col].notna()]
        if work.empty:
            return []

        segment_cols = [tariff_col] + ([arpu_seg_col] if arpu_seg_col else [])
        candidates: list[Candidate] = []

        # A missing segment cannot be represented by the official wildcard filter.
        if arpu_seg_col:
            work = work[work[arpu_seg_col].notna()]
        grouped = work.groupby(segment_cols, dropna=False)
        for key, grp in grouped:
            if not isinstance(key, tuple):
                key = (key,)
            current = str(key[0])
            arpu_segment = None if len(key) < 2 or self._is_nan(key[1]) else str(key[1])
            size = len(grp)
            if size < _MIN_PILOT_SIZE or size > _MAX_CAMPAIGN_SIZE:
                continue

            if arpu_value_col:
                vals = (
                    pd.to_numeric(grp[arpu_value_col], errors="coerce")
                    if pd is not None
                    else grp[arpu_value_col]
                )
                avg_arpu = self._safe_mean(vals, default=0.0)
            else:
                avg_arpu = 0.0
            if not math.isfinite(avg_arpu) or avg_arpu < 0:
                avg_arpu = 0.0

            targets = self._target_candidates(
                current, tariffs, tariff_prices, historical
            )
            for target in targets[:3]:
                if target == current:
                    continue
                prior_effect, prior_n = historical.get((current, target), (0.0, 0))
                candidates.append(
                    Candidate(
                        current_tariff=current,
                        target_tariff=target,
                        arpu_segment=arpu_segment,
                        size=size,
                        avg_arpu=avg_arpu,
                        prior_effect=float(prior_effect),
                        prior_n=int(prior_n),
                    )
                )

        # Prefer evidence-backed transitions and valuable, non-tiny segments.
        candidates.sort(
            key=lambda c: (
                self._prior_rank(c),
                math.log1p(max(c.size, 0)),
                math.log1p(max(c.avg_arpu, 0.0)),
            ),
            reverse=True,
        )
        return candidates

    def _target_candidates(
        self,
        current: str,
        tariffs: list[str],
        prices: dict[str, float],
        historical: dict[tuple[str, str], tuple[float, int]],
    ) -> list[str]:
        hist = []
        for target in tariffs:
            if target == current:
                continue
            effect, n = historical.get((current, target), (0.0, 0))
            if n > 0:
                confidence = n / (n + 35.0)
                hist.append((effect * confidence, n, target))
        if hist:
            hist.sort(reverse=True)
            return [t for _, _, t in hist]

        if current in prices:
            cur_price = prices[current]
            upsell = sorted(
                (
                    (price - cur_price, name)
                    for name, price in prices.items()
                    if name != current and price > cur_price
                ),
                key=lambda x: x[0],
            )
            if upsell:
                return [name for _, name in upsell]

        # No historical/price signal: deterministic diversity, not a hard-coded "winner".
        others = sorted(t for t in tariffs if t != current)
        if not others:
            return []
        offset = sum(ord(ch) for ch in current) % len(others)
        return others[offset:] + others[:offset]

    def _prior_rank(self, c: Candidate) -> float:
        confidence = c.prior_n / (c.prior_n + 35.0) if c.prior_n else 0.0
        return c.prior_effect * confidence

    # ------------------------------------------------------------------
    # Pilot execution and interpretation
    # ------------------------------------------------------------------

    def _safe_run_pilot(self, env, c: Candidate, channel: str, n: int) -> Any | None:
        kwargs = {
            "target_tariff": c.target_tariff,
            "channel": channel,
            "n_customers": int(n),
            "filter_current_tariff": c.current_tariff,
        }
        if c.arpu_segment is not None:
            kwargs["filter_arpu_segment"] = c.arpu_segment
        if not _MIN_PILOT_SIZE <= n <= _MAX_PILOT_SIZE:
            return None
        # Pilot calls consume resources. Never retry after an ambiguous exception.
        try:
            return env.run_pilot(**kwargs)
        except Exception as error:
            log.warning("pilot_failed type=%s", type(error).__name__)
            raise

    def _pilot_observation(
        self, result: Any, c: Candidate, channel: str, n: int
    ) -> dict[str, Any]:
        raw = self._object_to_mapping(result)
        actual_n = self._first_number(raw, ["sample_size", "n_customers", "n"])
        n = (
            int(actual_n)
            if actual_n is not None and actual_n > 0 and actual_n.is_integer()
            else n
        )
        effect = self._extract_effect(result, avg_arpu=c.avg_arpu, n=n)
        # Normalize channel-scaled pilot effect back to a comparable latent transition effect.
        eff = self._eff.get(channel, 1.0)
        base_effect = effect / eff if effect is not None and eff > 0 else None
        return {
            "channel": channel,
            "n": int(n),
            "effect": effect,
            "base_effect": base_effect,
            "raw": result,
        }

    def _extract_effect(self, result: Any, avg_arpu: float, n: int) -> float | None:
        data = self._object_to_mapping(result)
        if not data:
            return self._as_float(result)

        flat = {str(k).lower(): v for k, v in data.items()}

        # 1) Explicit before/after ARPU is the most interpretable signal.
        before = self._first_number(
            flat, ["arpu_before", "before_arpu", "mean_arpu_before", "avg_arpu_before"]
        )
        after = self._first_number(
            flat, ["arpu_after", "after_arpu", "mean_arpu_after", "avg_arpu_after"]
        )
        if before is not None and after is not None and abs(before) > 1e-9:
            return (after - before) / abs(before)

        # 2) Explicit effect/uplift/relative-delta fields.
        preferred = [
            "mean_effect",
            "avg_effect",
            "effect",
            "uplift",
            "arpu_uplift",
            "relative_uplift",
            "relative_effect",
            "effect_pct",
            "effect_percent",
            "delta_pct",
            "arpu_delta_pct",
            "mean_relative_change",
        ]
        for key in preferred:
            if key in flat:
                x = self._as_float(flat[key])
                if x is not None:
                    if "pct" in key or "percent" in key:
                        x /= 100.0
                    return x

        # 3) Absolute ARPU delta -> relative effect.
        delta = self._first_number(
            flat, ["arpu_delta", "mean_arpu_delta", "avg_arpu_delta", "delta_arpu"]
        )
        denom = self._first_number(
            flat, ["avg_arpu", "mean_arpu", "baseline_arpu", "arpu_before"]
        )
        if delta is not None:
            base = denom if denom is not None and abs(denom) > 1e-9 else avg_arpu
            if base and abs(base) > 1e-9:
                return delta / abs(base)

        # 4) If only revenue/profit-like aggregate exists, normalize conservatively.
        aggregate = self._first_number(
            flat, ["revenue_delta", "incremental_revenue", "gross_uplift"]
        )
        if aggregate is not None and avg_arpu > 0 and n > 0:
            return aggregate / (avg_arpu * n)

        # Unknown units are unavailable, not an inferred relative effect.
        return None

    def _candidate_posterior(self, c: Candidate) -> tuple[float, float]:
        observations = [p for p in c.pilots if p.get("base_effect") is not None]
        prior = self._clip_effect(c.prior_effect)
        prior_strength = (
            min(80.0, math.sqrt(max(c.prior_n, 0)) * 5.0) if c.prior_n else 20.0
        )

        weighted_sum = prior * prior_strength
        total_weight = prior_strength
        effective_n = 0
        for p in observations:
            n = max(int(p.get("n") or 0), 1)
            x = self._clip_effect(float(p["base_effect"]))
            weighted_sum += x * n
            total_weight += n
            effective_n += n

        mean = weighted_sum / total_weight if total_weight else 0.0
        # Strategy risk penalty, NOT a measured standard error or statistical confidence.
        uncertainty = 0.075 * math.sqrt(30.0 / max(effective_n, 10))
        if observations:
            vals = [float(p["base_effect"]) for p in observations]
            if len(vals) >= 2:
                spread = max(vals) - min(vals)
                uncertainty += min(0.08, 0.35 * abs(spread))
        else:
            uncertainty += 0.06
        return self._clip_effect(mean), min(0.25, max(0.01, uncertainty))

    def _candidate_exploration_score(self, c: Candidate) -> float:
        mean, uncertainty = self._candidate_posterior(c)
        return mean - 0.75 * uncertainty

    def _candidate_uncertainty(self, c: Candidate) -> float:
        return self._candidate_posterior(c)[1]

    def _can_pilot(self, env, c: Candidate, channel: str, desired_n: int) -> bool:
        pilots_left = self._safe_int(getattr(env, "pilots_left", 0), 0)
        contacts_left = self._safe_int(getattr(env, "remaining_contacts", 0), 0)
        budget_left = self._safe_float(getattr(env, "remaining_budget", 0.0), 0.0)
        if (
            pilots_left <= 0
            or contacts_left < _MIN_PILOT_SIZE
            or c.size < _MIN_PILOT_SIZE
        ):
            return False
        n = min(desired_n, _MAX_PILOT_SIZE, c.size, contacts_left)
        if n < _MIN_PILOT_SIZE:
            return False
        cost = self._cost.get(channel, 0.0) * n
        # Preserve most of the budget for the final portfolio.
        reserve_ratio = 0.70
        return cost <= max(0.0, budget_left * (1.0 - reserve_ratio)) or cost == 0.0

    def _pilot_size(self, env, c: Candidate, channel: str, desired_n: int) -> int:
        contacts_left = self._safe_int(
            getattr(env, "remaining_contacts", desired_n), desired_n
        )
        budget_left = self._safe_float(getattr(env, "remaining_budget", 0.0), 0.0)
        n = min(max(desired_n, _MIN_PILOT_SIZE), _MAX_PILOT_SIZE, c.size, contacts_left)
        unit_cost = self._cost.get(channel, 0.0)
        if unit_cost > 0:
            # at most 30% of current remaining budget can be consumed by one pilot
            by_budget = int(max(0.0, budget_left * 0.30) // unit_cost)
            n = min(n, by_budget)
        return max(0, int(n))

    # ------------------------------------------------------------------
    # Economic portfolio selection
    # ------------------------------------------------------------------

    def _select_portfolio(
        self, env, candidates: list[Candidate], channels: list[str]
    ) -> list[dict]:
        budget_left = self._safe_float(getattr(env, "remaining_budget", 0.0), 0.0)
        contacts_left = self._safe_int(getattr(env, "remaining_contacts", 0), 0)

        ranked: list[tuple[float, float, Candidate, str]] = []
        for c in candidates:
            if not 0 < c.size <= _MAX_CAMPAIGN_SIZE:
                continue
            if not any(p.get("base_effect") is not None for p in c.pilots):
                continue
            mean, penalty = self._candidate_posterior(c)
            for channel in channels:
                if channel not in self._cost or channel not in self._eff:
                    continue
                cost = self._cost[channel] * c.size
                net = (
                    c.avg_arpu * (mean - 0.85 * penalty) * self._eff[channel]
                    - self._cost[channel]
                ) * c.size
                ranked.append((net, cost, c, channel))
        ranked.sort(key=lambda row: row[0], reverse=True)
        selected = []
        used_segments = set()
        for net, cost, c, channel in ranked:
            if len(selected) >= _MAX_CAMPAIGNS:
                break
            if c.segment_key in used_segments or net <= 0:
                continue
            if c.size > contacts_left or cost > budget_left + 1e-9:
                continue
            selected.append(self._campaign_dict(c, channel))
            used_segments.add(c.segment_key)
            contacts_left -= c.size
            budget_left -= cost
        # No profitable evidence-backed portfolio is a legitimate outcome.
        return selected

    @staticmethod
    def _campaign_dict(c: Candidate, channel: str) -> dict:
        seg = c.arpu_segment or "ALL"
        name = f"AUTO_{seg}_{c.current_tariff}_TO_{c.target_tariff}_{channel}"[:120]
        out = {
            "campaign_name": name,
            "filter_current_tariff": c.current_tariff,
            "target_tariff": c.target_tariff,
            "channel": channel,
        }
        if c.arpu_segment is not None:
            out["filter_arpu_segment"] = c.arpu_segment
        return out

    # ------------------------------------------------------------------
    # Fallbacks / utilities
    # ------------------------------------------------------------------

    def _minimal_fallback(self, env, **kwargs) -> list[dict]:
        log.info("agent_no_valid_candidates")
        return []

    def _cheapest_channel(self, channels: list[str]) -> str:
        return (
            min(channels, key=lambda ch: self._cost.get(ch, float("inf")))
            if channels
            else "push"
        )

    @staticmethod
    def _unique(values: Iterable[str]) -> list[str]:
        seen = set()
        out = []
        for value in values:
            if value not in seen:
                seen.add(value)
                out.append(value)
        return out

    @staticmethod
    def _is_nan(value: Any) -> bool:
        try:
            return bool(math.isnan(float(value)))
        except (TypeError, ValueError, OverflowError):
            return str(value).lower() == "nan"

    @staticmethod
    def _safe_mean(values, default: float = 0.0) -> float:
        try:
            if hasattr(values, "dropna"):
                values = values.dropna()
            if len(values) == 0:
                return default
            result = float(values.mean())
            return result if math.isfinite(result) else default
        except (TypeError, ValueError, OverflowError):
            return default

    @staticmethod
    def _as_float(value: Any) -> float | None:
        if value is None or isinstance(value, bool):
            return None
        try:
            x = float(value)
            return x if math.isfinite(x) else None
        except (TypeError, ValueError, OverflowError):
            return None

    def _first_number(
        self, mapping: Mapping[str, Any], keys: Iterable[str]
    ) -> float | None:
        lowered = {str(k).lower(): v for k, v in mapping.items()}
        for key in keys:
            if key.lower() in lowered:
                x = self._as_float(lowered[key.lower()])
                if x is not None:
                    return x
        return None

    @staticmethod
    def _object_to_mapping(obj: Any) -> dict[str, Any]:
        if isinstance(obj, Mapping):
            return dict(obj)
        if hasattr(obj, "_asdict"):
            try:
                return dict(obj._asdict())
            except (TypeError, ValueError, AttributeError):
                return {}
        if hasattr(obj, "__dict__"):
            try:
                return {
                    k: v for k, v in vars(obj).items() if not str(k).startswith("_")
                }
            except (TypeError, ValueError, AttributeError):
                return {}
        return {}

    @staticmethod
    def _clip_effect(value: float) -> float:
        # Protect optimization from pathological/mock outliers without assuming a winning value.
        return max(-1.0, min(2.0, float(value)))

    @staticmethod
    def _safe_int(value: Any, default: int) -> int:
        try:
            return int(value)
        except (TypeError, ValueError, OverflowError):
            return default

    @staticmethod
    def _safe_float(value: Any, default: float) -> float:
        try:
            x = float(value)
            return x if math.isfinite(x) else default
        except (TypeError, ValueError, OverflowError):
            return default
