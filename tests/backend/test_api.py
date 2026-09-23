import time

import pytest
from fastapi.testclient import TestClient

from backend.app.main import create_app


@pytest.fixture
def app(monkeypatch):
    monkeypatch.delenv("NX_ENV_FACTORY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    return create_app()


def test_health_missing_provider_and_environment(app):
    with TestClient(app) as client:
        health = client.get("/health")
        assert health.status_code == 200
        assert not health.json()["agent_available"]
        assert not health.json()["llm_available"]
        assert client.get("/api/workspace").json()["state"] == "INITIAL"
        run = client.post("/api/agent/runs")
        assert run.status_code == 409
        assert run.json()["error"]["code"] == "ENV_UNAVAILABLE"


def test_upload_isolation_error_preservation_and_cors(app):
    with TestClient(app) as first, TestClient(app) as second:
        response = first.post(
            "/api/datasets",
            content="id,current_tariff,arpu\nunit-id,unit-a,15\n",
            headers={"Content-Type": "text/csv"},
        )
        assert response.status_code == 200
        assert response.json()["audience_total"] == 1
        assert "HttpOnly" in response.headers["set-cookie"]
        assert "audience_total" not in second.get("/api/workspace").json()
        invalid = first.post(
            "/api/datasets", content="bad data", headers={"Content-Type": "text/csv"}
        )
        assert invalid.status_code == 422
        assert first.get("/api/workspace").json()["audience_total"] == 1
        assert (
            first.post(
                "/api/agent/runs",
                content="{}",
                headers={"Origin": "https://outside.example"},
            ).status_code
            == 403
        )
        assert first.post("/api/agent/runs", content="{}").status_code == 422
        preflight = first.options(
            "/api/datasets",
            headers={
                "Origin": "http://127.0.0.1:5173",
                "Access-Control-Request-Method": "POST",
            },
        )
        assert (
            preflight.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"
        )


def test_api_runs_existing_agent_in_process(app, monkeypatch):
    monkeypatch.setenv(
        "NX_ENV_FACTORY", "tests.ai.test_agent_runtime:environment_factory"
    )
    with TestClient(app) as client:
        client.get("/api/workspace")
        accepted = client.post("/api/agent/runs")
        assert accepted.status_code == 202
        assert client.post("/api/agent/runs").status_code == 409
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            result = client.get("/api/workspace").json()
            if result["state"] in {"FAILED", "COMPLETED"}:
                break
            time.sleep(0.05)
        assert result["state"] == "COMPLETED", result.get("error")
        assert result["run_id"] == accepted.json()["run_id"]
        assert result["pilots"] and result["campaigns"]
        assert result["budget"]["remaining"] >= 0


@pytest.mark.parametrize(
    "factory,timeout,expected",
    [
        ("hanging_factory", 0.5, "time limit"),
        ("failing_factory", 5, "execution failed"),
        ("debit_failure_factory", 5, "execution failed"),
    ],
)
def test_failed_and_timed_out_workers_finish(
    app, monkeypatch, factory, timeout, expected
):
    monkeypatch.setenv("NX_ENV_FACTORY", "tests.ai.test_agent_runtime:" + factory)
    monkeypatch.setattr("backend.app.main.RUN_TIMEOUT", timeout)
    with TestClient(app) as client:
        assert client.post("/api/agent/runs").status_code == 202
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            result = client.get("/api/workspace").json()
            if result["state"] == "FAILED":
                break
            time.sleep(0.05)
        assert result["state"] == "FAILED"
        assert expected in result["error"]
        assert "unit-secret" not in str(result)
        assert (
            "budget" not in result
            and "contacts" not in result
            and "pilot_limit" not in result
        )
        assert not next(iter(app.state.store.sessions.values())).process.is_alive()


def test_factory_cannot_reference_arbitrary_paths(app, monkeypatch):
    monkeypatch.setenv("NX_ENV_FACTORY", "../../outside:run")
    with TestClient(app) as client:
        response = client.post("/api/agent/runs")
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "ENV_CONFIGURATION"
