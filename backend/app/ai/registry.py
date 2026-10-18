"""Selects the configured provider. Never substitutes another provider silently."""

from __future__ import annotations

from ..config import get_settings
from .provider import AINotConfigured, DesignModelProvider

_override: DesignModelProvider | None = None


def set_provider_override(provider: DesignModelProvider | None) -> None:
    """Test hook: install a provider double for the current process."""

    global _override
    _override = provider


def get_provider() -> DesignModelProvider:
    if _override is not None:
        return _override
    settings = get_settings()
    if settings.ai_provider == "mock":
        from .mock import MockProvider

        return MockProvider()
    if settings.ai_provider != "gemini":
        raise AINotConfigured(f"unknown provider {settings.ai_provider!r}")
    if not settings.ai_configured:
        raise AINotConfigured()
    from .gemini import GeminiProvider

    return GeminiProvider(
        api_key=settings.gemini_api_key.get_secret_value().strip(),
        model=settings.gemini_model,
        timeout=settings.ai_timeout_seconds,
        max_retries=settings.ai_max_retries,
    )


def provider_status() -> dict[str, object]:
    settings = get_settings()
    return {
        "provider": settings.ai_provider,
        "model": settings.gemini_model,
        "configured": settings.ai_provider == "mock" or settings.ai_configured,
        "test_double": settings.ai_provider == "mock",
    }
