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

    budget = None
    if settings.ai_call_budget > 0:
        from .budget import CallBudget

        budget = CallBudget(settings.ai_budget_file or settings.data_dir / "ai-budget.json", settings.ai_call_budget)
    return GeminiProvider(
        api_key=settings.gemini_api_key.get_secret_value().strip(),
        model=settings.gemini_model,
        timeout=settings.ai_timeout_seconds,
        max_retries=settings.ai_max_retries,
        budget=budget,
    )


def provider_status() -> dict[str, object]:
    settings = get_settings()
    return {
        "provider": settings.ai_provider,
        "model": settings.gemini_model,
        "configured": settings.ai_provider == "mock" or settings.ai_configured,
        "test_double": settings.ai_provider == "mock",
    }
