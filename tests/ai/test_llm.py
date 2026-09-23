import json

import httpx
import pytest

from ai.models.llm import OpenAIExplanation, provider

FACTS = {"audience": "Validated 3 test records.", "portfolio": "No selected campaigns."}


def explanation(handler):
    return OpenAIExplanation(
        "unit-key-not-real",
        "unit-model",
        "https://api.openai.com/v1",
        transport=httpx.MockTransport(handler),
    )


def test_missing_key_does_not_block_calculations(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    model, reason = provider()
    assert "disabled" in reason
    assert model.explain(FACTS)[0] == " ".join(FACTS.values())


def test_structured_verified_facts_only():
    def handler(request):
        body = json.loads(request.content)
        assert body["store"] is False and "tools" not in body
        assert body["text"]["format"]["strict"] is True
        return httpx.Response(
            200,
            json={
                "output": [
                    {
                        "type": "message",
                        "content": [
                            {
                                "type": "output_text",
                                "text": '{"fact_ids":["portfolio","audience"]}',
                            }
                        ],
                    }
                ]
            },
        )

    result, mode = explanation(handler).explain(FACTS)
    assert result == FACTS["portfolio"] + " " + FACTS["audience"]
    assert mode == "llm_ordered_verified_facts"


@pytest.mark.parametrize(
    "status,attempts",
    [(401, 1), (403, 1), (404, 1), (429, 2), (500, 2), (502, 2), (503, 2)],
)
def test_http_failure_bounded_fallback(status, attempts, monkeypatch):
    monkeypatch.setattr("ai.models.llm.time.sleep", lambda _: None)
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(status, json={"error": "unit-secret-do-not-echo"})

    result, mode = explanation(handler).explain(FACTS)
    assert len(calls) == attempts
    assert result == " ".join(FACTS.values())
    assert str(status) in mode and "unit-secret" not in mode


@pytest.mark.parametrize("error", [httpx.ReadTimeout, httpx.ConnectError])
def test_timeout_and_network_failure(error, monkeypatch):
    monkeypatch.setattr("ai.models.llm.time.sleep", lambda _: None)
    calls = []

    def handler(request):
        calls.append(request)
        raise error("unit-error", request=request)

    result, mode = explanation(handler).explain(FACTS)
    assert len(calls) == 2
    assert "unavailable" in mode and result == " ".join(FACTS.values())


@pytest.mark.parametrize(
    "output",
    [
        [{"type": "function_call", "name": "read_secret", "arguments": "{}"}],
        [
            {
                "type": "message",
                "content": [
                    {"type": "output_text", "text": '{"fact_ids":["invented"]}'}
                ],
            }
        ],
        [{"type": "message", "content": [{"type": "output_text", "text": "not JSON"}]}],
        [{"type": "message", "content": [{"type": "refusal", "refusal": "No"}]}],
    ],
)
def test_invalid_response_and_unknown_tool_are_not_executed(output):
    result, mode = explanation(
        lambda _: httpx.Response(200, json={"output": output})
    ).explain(FACTS)
    assert "invalid" in mode and result == " ".join(FACTS.values())
