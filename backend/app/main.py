"""Session-isolated local API for the existing campaign workspace."""

import asyncio
import logging
import multiprocessing as mp
import secrets
import threading
import time
from contextlib import asynccontextmanager
from queue import Empty
from typing import Literal

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ValidationError
from starlette.exceptions import HTTPException

from ai.models.llm import provider
from ai.models.workspace import Dataset, DomainError, Snapshot
from ai.pipelines.data import MAX_BYTES, parse_dataset
from ai.pipelines.runtime import (
    ROOT,
    capabilities,
    data_snapshot,
    factory_reference,
    now,
    worker,
)

log = logging.getLogger(__name__)
RUN_STATES = {"AGENT_RUNNING", "PILOT_RUNNING", "OPTIMIZING"}
ALLOWED_ORIGINS = [
    f"http://{host}:{port}"
    for host in ("localhost", "127.0.0.1")
    for port in (5173, 4173, 8000)
]
SESSION_TTL = 3600
MAX_SESSIONS = 8
MAX_ACTIVE_RUNS = 2
RUN_TIMEOUT = 300


class ErrorDetail(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    success: Literal[False] = False
    error: ErrorDetail


class RunAccepted(BaseModel):
    run_id: str
    state: Literal["AGENT_RUNNING"] = "AGENT_RUNNING"


class Health(BaseModel):
    status: Literal["ok"] = "ok"
    agent_available: bool
    agent_reason: str | None
    llm_available: bool
    llm_reason: str | None


class Session:
    def __init__(self):
        self.snapshot = data_snapshot(None)
        self.dataset: Dataset | None = None
        self.touched = time.monotonic()
        self.process = None
        self.monitor = None
        self.queue = None
        self.run_started = None
        self.lock = threading.RLock()


class Store:
    def __init__(self):
        self.sessions: dict[str, Session] = {}
        self.lock = threading.RLock()
        self.closed = False

    def session(self, request):
        token = request.cookies.get("nx_session")
        with self.lock:
            for key, value in list(self.sessions.items()):
                if (
                    time.monotonic() - value.touched > SESSION_TTL
                    and value.snapshot.state not in RUN_STATES
                ):
                    del self.sessions[key]
            if token not in self.sessions:
                if len(self.sessions) >= MAX_SESSIONS:
                    raise DomainError(
                        "SESSION_LIMIT",
                        "Local workspace capacity reached. Retry after inactive sessions expire.",
                        503,
                    )
                token = secrets.token_urlsafe(32)
                self.sessions[token] = Session()
            self.sessions[token].touched = time.monotonic()
            return token, self.sessions[token]

    def start(self, session):
        factory_reference()
        with self.lock, session.lock:
            if self.closed:
                raise DomainError("SHUTTING_DOWN", "Backend is shutting down.", 503)
            if session.snapshot.state in RUN_STATES or (
                session.monitor and session.monitor.is_alive()
            ):
                raise DomainError(
                    "RUN_IN_PROGRESS", "This workspace already has an active run.", 409
                )
            if (
                sum(
                    item.snapshot.state in RUN_STATES for item in self.sessions.values()
                )
                >= MAX_ACTIVE_RUNS
            ):
                raise DomainError(
                    "RUN_LIMIT",
                    "All agent workers are busy. Try again after a run finishes.",
                    429,
                )
            run_id = secrets.token_hex(12)
            session.snapshot = data_snapshot(session.dataset).model_copy(
                update={"state": "AGENT_RUNNING", "run_id": run_id}
            )
            context = mp.get_context("spawn")
            session.queue = context.Queue(maxsize=8)
            session.process = context.Process(
                target=worker,
                args=(
                    session.dataset.model_dump(exclude_none=True)
                    if session.dataset
                    else None,
                    session.queue,
                ),
                daemon=True,
            )
            try:
                session.process.start()
            except (OSError, RuntimeError):
                session.queue.close()
                session.snapshot = session.snapshot.model_copy(
                    update={
                        "state": "FAILED",
                        "error": "Unable to start the isolated agent worker.",
                    }
                )
                raise DomainError(
                    "WORKER_UNAVAILABLE",
                    "Unable to start the isolated agent worker.",
                    503,
                ) from None
            session.run_started = time.monotonic()
            session.monitor = threading.Thread(
                target=self.watch, args=(session, run_id), daemon=True
            )
            session.monitor.start()
            log.info("agent_run_started run_id=%s", run_id)
            return RunAccepted(run_id=run_id)

    def watch(self, session, run_id):
        deadline = time.monotonic() + RUN_TIMEOUT
        error = None
        try:
            while time.monotonic() < deadline and not self.closed:
                try:
                    kind, body = session.queue.get(timeout=0.2)
                except Empty:
                    if not session.process.is_alive():
                        error = "Agent worker exited before completing the run."
                        break
                    continue
                if kind == "error":
                    error = body["message"]
                    break
                if kind == "done":
                    if session.snapshot.state != "COMPLETED":
                        error = "Agent worker returned an incomplete result."
                    break
                with session.lock:
                    merged = session.snapshot.model_dump()
                    merged.update(body)
                    merged["run_id"] = run_id
                    session.snapshot = Snapshot.model_validate(merged)
            else:
                error = (
                    "Agent exceeded the 300-second time limit."
                    if not self.closed
                    else "Backend stopped the run."
                )
        except (ValueError, TypeError, ValidationError, OSError, EOFError):
            error = "Agent produced an invalid response. Check the environment adapter."
        finally:
            if session.process.is_alive():
                session.process.terminate()
            session.process.join(timeout=2)
            if session.process.is_alive():
                session.process.kill()
                session.process.join(timeout=2)
            session.queue.close()
            session.queue.cancel_join_thread()
            if error:
                with session.lock:
                    session.snapshot = session.snapshot.model_copy(
                        update={
                            "state": "FAILED",
                            "error": error,
                            "budget": None,
                            "contacts": None,
                            "pilot_limit": None,
                            "updated_at": now(),
                        }
                    )
                log.warning("agent_run_failed run_id=%s", run_id)
            else:
                log.info("agent_run_finished run_id=%s", run_id)

    def close(self):
        self.closed = True
        for session in list(self.sessions.values()):
            if session.monitor:
                session.monitor.join(timeout=5)


def error_response(error):
    return JSONResponse(
        status_code=error.status,
        content=ErrorResponse(
            error=ErrorDetail(code=error.code, message=error.message)
        ).model_dump(),
        headers={"Cache-Control": "no-store"},
    )


def create_app():
    store = Store()

    @asynccontextmanager
    async def lifespan(app):
        yield
        await asyncio.to_thread(store.close)

    app = FastAPI(title="HackAlem Campaign Agent", version="1.0", lifespan=lifespan)
    app.state.store = store
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "Accept"],
    )

    @app.middleware("http")
    async def local_boundary(request, call_next):
        if request.method == "POST":
            origin = request.headers.get("origin")
            if origin and origin not in ALLOWED_ORIGINS:
                return error_response(
                    DomainError(
                        "ORIGIN_NOT_ALLOWED",
                        "This origin is not allowed to change the workspace.",
                        403,
                    )
                )
            if request.headers.get("sec-fetch-site") == "cross-site":
                return error_response(
                    DomainError(
                        "ORIGIN_NOT_ALLOWED",
                        "Cross-site workspace changes are blocked.",
                        403,
                    )
                )
        response = await call_next(request)
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
            response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.exception_handler(DomainError)
    async def domain_error(request, error):
        log.warning("api_rejected code=%s", error.code)
        return error_response(error)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, error):
        return error_response(
            DomainError("INVALID_REQUEST", "Request does not match the API schema.")
        )

    @app.exception_handler(HTTPException)
    async def http_error(request, error):
        message = {
            404: "Endpoint not found.",
            405: "HTTP method is not supported.",
        }.get(error.status_code, "HTTP request could not be completed.")
        return error_response(DomainError("HTTP_ERROR", message, error.status_code))

    @app.exception_handler(Exception)
    async def internal_error(request, error):
        log.error("api_error type=%s", type(error).__name__)
        return error_response(
            DomainError("INTERNAL_ERROR", "The operation could not be completed.", 500)
        )

    def respond(token, content, status=200):
        response = JSONResponse(content=content, status_code=status)
        response.set_cookie(
            "nx_session",
            token,
            httponly=True,
            samesite="strict",
            max_age=SESSION_TTL,
            path="/api",
        )
        return response

    @app.get("/health", response_model=Health)
    def health():
        caps = capabilities()
        _, reason = provider()
        return Health(
            agent_available=caps.run_agent,
            agent_reason=caps.reason,
            llm_available=reason is None,
            llm_reason=reason,
        )

    @app.get(
        "/api/workspace", response_model=Snapshot, response_model_exclude_none=True
    )
    def workspace(request: Request):
        token, session = store.session(request)
        with session.lock:
            return respond(token, session.snapshot.model_dump(exclude_none=True))

    @app.post(
        "/api/datasets", response_model=Snapshot, response_model_exclude_none=True
    )
    async def upload(request: Request):
        token, session = store.session(request)
        with session.lock:
            if session.snapshot.state in RUN_STATES or (
                session.monitor and session.monitor.is_alive()
            ):
                raise DomainError(
                    "RUN_IN_PROGRESS",
                    "Wait for the active run before replacing its data.",
                    409,
                )
        content = bytearray()
        try:
            async with asyncio.timeout(30):
                async for chunk in request.stream():
                    if len(content) + len(chunk) > MAX_BYTES:
                        raise DomainError(
                            "FILE_TOO_LARGE", "Dataset exceeds the 20 MB limit.", 413
                        )
                    content.extend(chunk)
        except TimeoutError:
            raise DomainError(
                "UPLOAD_TIMEOUT", "Dataset upload exceeded 30 seconds.", 408
            ) from None
        dataset = await asyncio.to_thread(
            parse_dataset,
            bytes(content),
            request.headers.get("content-type", "").split(";")[0],
        )

        def commit():
            with session.lock:
                if session.snapshot.state in RUN_STATES or (
                    session.monitor and session.monitor.is_alive()
                ):
                    raise DomainError(
                        "RUN_IN_PROGRESS",
                        "An agent run started while the upload was being validated.",
                        409,
                    )
                session.dataset = dataset
                session.snapshot = data_snapshot(dataset)
                log.info("dataset_validated rows=%s", len(dataset.customer_profile))
                return respond(token, session.snapshot.model_dump(exclude_none=True))

        return await asyncio.to_thread(commit)

    @app.post("/api/agent/runs", response_model=RunAccepted, status_code=202)
    async def run(request: Request):
        try:
            async with asyncio.timeout(5):
                async for chunk in request.stream():
                    if chunk:
                        raise DomainError(
                            "INVALID_REQUEST",
                            "Agent start accepts an empty body; configure datasets through /api/datasets.",
                        )
        except TimeoutError:
            raise DomainError(
                "REQUEST_TIMEOUT", "Agent start request timed out.", 408
            ) from None
        token, session = store.session(request)
        result = await asyncio.to_thread(store.start, session)
        return respond(token, result.model_dump(), 202)

    dist = ROOT / "frontend" / "dist"
    if dist.is_dir():
        app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")
    return app


app = create_app()
