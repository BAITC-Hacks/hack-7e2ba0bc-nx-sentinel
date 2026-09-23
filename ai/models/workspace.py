"""Validated wire contract shared with frontend schema_version 1."""

from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field


def reject_bool(value):
    if isinstance(value, bool):
        raise ValueError("Boolean is not a number")  # noqa: TRY004 - Pydantic validators require ValueError
    return value


Text = Annotated[str, Field(min_length=1, max_length=12000)]
Label = Annotated[str, Field(min_length=1, max_length=256, pattern=r"\S")]
Amount = Annotated[
    float, Field(ge=0, allow_inf_nan=False), BeforeValidator(reject_bool)
]
Number = Annotated[float, Field(allow_inf_nan=False), BeforeValidator(reject_bool)]
Count = Annotated[int, Field(ge=0, strict=True)]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Subscriber(Model):
    id: Label
    current_tariff: Label
    arpu: Amount
    predicted_arpu: Amount | None = None
    arpu_segment: Label | None = None
    data_segment: Label | None = None
    call_segment: Label | None = None


class Tariff(Model):
    id: Label
    name: Label | None = None
    price: Amount | None = None
    data_gb: Amount | None = None
    minutes: Amount | None = None
    sms: Count | None = None


class Channel(Model):
    id: Label
    name: Label | None = None
    cost: Amount
    effectiveness: Annotated[
        float, Field(gt=0, allow_inf_nan=False), BeforeValidator(reject_bool)
    ]


class Transition(Model):
    current_tariff: Label
    target_tariff: Label
    arpu_before: Annotated[
        float, Field(gt=0, allow_inf_nan=False), BeforeValidator(reject_bool)
    ]
    arpu_after: Amount


class Dataset(Model):
    customer_profile: Annotated[
        list[Subscriber], Field(min_length=1, max_length=100000)
    ]
    tariffs: Annotated[list[Tariff], Field(max_length=500)] = []
    channels: Annotated[list[Channel], Field(max_length=50)] = []
    change_tariff: Annotated[list[Transition], Field(max_length=100000)] = []


class Targeting(Model):
    current_tariff: Label | None = None
    arpu_segment: Label | None = None
    data_segment: Label | None = None
    call_segment: Label | None = None


class Campaign(Model):
    id: Label
    name: Label | None = None
    target_tariff: Label
    channel: Label
    targeting: Targeting
    audience_size: Count | None = None
    estimated_cost: Amount | None = None
    expected_impact: Number | None = None
    confidence: (
        Annotated[
            float, Field(ge=0, le=1, allow_inf_nan=False), BeforeValidator(reject_bool)
        ]
        | None
    ) = None
    reasoning: Text | None = None
    risk: Text | None = None
    evidence_ids: list[Label] = []


class Pilot(Campaign):
    status: Literal[
        "selected", "promoted", "rejected", "uncertain", "testing", "needs_more_data"
    ]
    observed_effect: Number | None = None
    sample_size: Count | None = None
    uncertainty: Amount | None = None
    cost: Amount | None = None
    timestamp: str


class Activity(Model):
    id: Label
    title: Text
    status: Literal[
        "pending", "running", "completed", "warning", "rejected", "selected"
    ]
    description: Text | None = None
    timestamp: str
    cost: Amount | None = None
    contacts: Count | None = None


class Budget(Model):
    total: Amount
    exploration_spent: Amount
    campaigns_allocated: Amount
    remaining: Amount


class Limit(Model):
    total: Count
    used: Count
    remaining: Count


class Capabilities(Model):
    run_agent: bool = False
    upload_dataset: bool = True
    llm_explanations: bool = False
    reason: Text | None = None


class Snapshot(Model):
    schema_version: Literal[1] = 1
    state: Literal[
        "INITIAL",
        "DATA_READY",
        "AGENT_RUNNING",
        "PILOT_RUNNING",
        "OPTIMIZING",
        "COMPLETED",
        "FAILED",
    ] = "INITIAL"
    run_id: str | None = None
    updated_at: str | None = None
    error: Text | None = None
    summary: Text | None = None
    next_action: Text | None = None
    capabilities: Capabilities = Capabilities()
    audience_total: Count | None = None
    audience: list[Subscriber] = []
    tariffs: list[Tariff] = []
    channels: list[Channel] = []
    campaigns: list[Campaign] = []
    pilots: list[Pilot] = []
    events: list[Activity] = []
    budget: Budget | None = None
    contacts: Limit | None = None
    pilot_limit: Limit | None = None


class DomainError(Exception):
    def __init__(self, code: str, message: str, status: int = 422):
        self.code, self.message, self.status = code, message, status
        super().__init__(message)
