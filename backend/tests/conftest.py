import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))


@pytest.fixture
def app_env(tmp_path, monkeypatch):
    """Fresh data directory, database (via real migrations) and settings per test."""

    from app import db
    from app.ai import registry
    from app.config import get_settings
    from app.security import login_limiter

    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{(tmp_path / 'test.sqlite3').as_posix()}")
    monkeypatch.setenv("GEMINI_API_KEY", "")
    monkeypatch.setenv("AI_PROVIDER", "gemini")
    monkeypatch.setenv("FRONTEND_DIST", str(tmp_path / "no-dist"))
    get_settings.cache_clear()
    db.reset_engine()
    login_limiter._fails.clear()
    registry.set_provider_override(None)
    yield tmp_path
    registry.set_provider_override(None)
    db.reset_engine()
    get_settings.cache_clear()


@pytest.fixture
def client(app_env):
    from api_helpers import Client
    from fastapi.testclient import TestClient

    from app.main import create_app

    with TestClient(create_app(), base_url="http://testserver") as tc:
        yield Client(tc)


@pytest.fixture
def make_client(app_env):
    """Factory for additional independent browser sessions against the same app."""

    from api_helpers import Client
    from fastapi.testclient import TestClient

    from app.main import create_app

    app = create_app()
    clients = []

    def factory():
        tc = TestClient(app, base_url="http://testserver")
        tc.__enter__()
        clients.append(tc)
        return Client(tc)

    yield factory
    for tc in clients:
        tc.__exit__(None, None, None)
