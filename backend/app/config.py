"""Application settings loaded from environment variables and ``backend/.env``."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", env_file_encoding="utf-8", extra="ignore")

    gemini_api_key: SecretStr = SecretStr("")
    gemini_model: str = "gemini-3.8-flash"
    # "gemini" in normal use. "mock" exists only for automated tests and is
    # labelled as such everywhere it appears.
    ai_provider: str = "gemini"
    ai_timeout_seconds: float = 90.0
    ai_max_retries: int = 2
    ai_max_repair_rounds: int = 2

    session_secret: SecretStr = SecretStr("")
    session_days: int = 14
    allow_registration: bool = True
    allowed_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    # Secure cookies need HTTPS; local and LAN pilots run over plain HTTP.
    cookie_secure: bool = False

    data_dir: Path = BACKEND_DIR / "data"
    database_url: str = ""
    frontend_dist: Path = REPO_DIR / "frontend" / "dist"

    max_upload_bytes: int = 15 * 1024 * 1024
    max_upload_pixels: int = 40_000_000

    walkway_clearance_m: float = Field(0.9, ge=0.5, le=1.8)

    @property
    def resolved_database_url(self) -> str:
        if self.database_url:
            return self.database_url
        return f"sqlite:///{(self.data_dir / 'respace.sqlite3').as_posix()}"

    @property
    def upload_dir(self) -> Path:
        return self.data_dir / "uploads"

    @property
    def extra_origins(self) -> set[str]:
        return {o.strip().rstrip("/") for o in self.allowed_origins.split(",") if o.strip()}

    @property
    def ai_configured(self) -> bool:
        return bool(self.gemini_api_key.get_secret_value().strip())


@lru_cache
def get_settings() -> Settings:
    return Settings()
