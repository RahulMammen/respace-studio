"""FastAPI application: API under /api, production frontend served from the same origin."""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import Depends, FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from sqlalchemy.orm import Session
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

from .catalog import catalog_payload
from .config import BACKEND_DIR, get_settings
from .db import User, get_db
from .deps import current_user
from .routers import ai, alternatives, auth, feedback, projects, transfer
from .samples import create_samples
from .security import origin_allowed

log = logging.getLogger("respace")
MAX_BODY = 40 * 1024 * 1024


def run_migrations() -> None:
    from alembic.config import Config

    from alembic import command

    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    cfg.set_main_option("sqlalchemy.url", get_settings().resolved_database_url)
    cfg.attributes["configure_logger"] = False
    command.upgrade(cfg, "head")


class GuardMiddleware(BaseHTTPMiddleware):
    """Origin check for unsafe requests, body size cap, and security headers."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        if request.url.path.startswith("/api/"):
            if not origin_allowed(request):
                return JSONResponse({"detail": "Cross-origin request blocked."}, status_code=403)
            length = request.headers.get("content-length")
            if length and length.isdigit() and int(length) > MAX_BODY:
                return JSONResponse({"detail": "Request is too large."}, status_code=413)
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        response.headers.setdefault("X-Frame-Options", "DENY")
        if request.url.path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "no-store")
        else:
            response.headers.setdefault(
                "Content-Security-Policy",
                "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; "
                "script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'; "
                "font-src 'self' data:; frame-ancestors 'none'",
            )
        return response


def create_app(*, migrate: bool = True) -> FastAPI:
    settings = get_settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    if migrate:
        run_migrations()
    app = FastAPI(title="ReSpace Studio", version="0.1.0", docs_url="/api/docs", openapi_url="/api/openapi.json")
    app.add_middleware(GuardMiddleware)
    for r in (auth.router, transfer.router, projects.router, alternatives.router, ai.router, feedback.router):
        app.include_router(r)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/catalog")
    def catalog() -> dict[str, object]:
        return catalog_payload()

    @app.post("/api/samples", status_code=201)
    def samples(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, object]:
        made = create_samples(db, user)
        return {"projects": [{"id": p.id, "name": p.name} for p in made]}

    dist = settings.frontend_dist
    if dist.is_dir():
        index = dist / "index.html"

        @app.get("/{path:path}", include_in_schema=False)
        def spa(path: str) -> Response:
            if path.startswith("api/"):
                return JSONResponse({"detail": "Not found"}, status_code=404)
            candidate = (dist / path).resolve()
            if path and candidate.is_file() and Path(dist.resolve()) in candidate.parents:
                headers = {"Cache-Control": "public, max-age=31536000, immutable"} if "/assets/" in f"/{path}" else {}
                return FileResponse(candidate, headers=headers)
            return FileResponse(index, headers={"Cache-Control": "no-cache"})

    return app
