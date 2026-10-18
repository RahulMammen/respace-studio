"""Google Gemini adapter using the official ``google-genai`` SDK (Interactions API)."""

from __future__ import annotations

import asyncio
import base64
import logging
import random
import re
from typing import Any

import httpx

from .provider import (
    AIAuthError,
    AIBlocked,
    AIError,
    AIInvalidOutput,
    AIModelUnavailable,
    AINotConfigured,
    AIQuotaExceeded,
    AITimeout,
    StructuredRequest,
    StructuredResponse,
)

log = logging.getLogger("respace.ai")


def classify_error(exc: BaseException) -> AIError:
    """Map SDK / transport exceptions to product-level errors without leaking secrets."""

    if isinstance(exc, AIError):
        return exc
    if isinstance(exc, (httpx.TimeoutException, asyncio.TimeoutError, TimeoutError)):
        return AITimeout()
    status = getattr(exc, "status_code", None) or getattr(exc, "code", None)
    body = str(getattr(exc, "body", "") or getattr(exc, "message", "") or exc)
    lowered = body.lower()
    excerpt = _sanitize(body)
    if isinstance(status, int):
        if status == 429 or "resource_exhausted" in lowered or "quota" in lowered:
            return AIQuotaExceeded(excerpt)
        if status in (401, 403) or "api key not valid" in lowered or "permission_denied" in lowered:
            return AIAuthError(excerpt)
        if status == 404 or ("models/" in lowered and "not found" in lowered):
            return AIModelUnavailable(excerpt)
        if status >= 500:
            return AIError(f"provider server error {status}: {excerpt}")
        return AIError(f"provider request error {status}: {excerpt}")
    return AIError(type(exc).__name__)


def _sanitize(text: str) -> str:
    """Short, key-free excerpt of a provider error for diagnostics."""

    cleaned = re.sub(r"AIza[0-9A-Za-z_-]{10,}", "[redacted]", text)
    cleaned = re.sub(r"key=[^&\s]+", "key=[redacted]", cleaned)
    return " ".join(cleaned.split())[:240]


def _retryable(err: AIError) -> bool:
    # Quota errors are not retried immediately: free-tier limits reset slowly
    # and retries only burn the remaining allowance.
    return type(err) is AIError and "server error" in str(err) or isinstance(err, AITimeout)


class GeminiProvider:
    name = "gemini"
    is_test_double = False

    def __init__(self, api_key: str, model: str, timeout: float, max_retries: int) -> None:
        if not api_key:
            raise AINotConfigured()
        self._api_key = api_key
        self._client: Any = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self.model = model
        self._timeout = timeout
        self._max_retries = max_retries

    def _build_input(self, request: StructuredRequest) -> list[dict[str, Any]]:
        parts: list[dict[str, Any]] = [{"type": "text", "text": request.text}]
        for image in request.images:
            parts.append(
                {
                    "type": "image",
                    "data": base64.b64encode(image.data).decode("ascii"),
                    "mime_type": image.mime_type,
                }
            )
        return parts

    def _client_for_loop(self):
        """The SDK's async HTTP client is bound to an event loop; rebuild it per loop."""

        loop = asyncio.get_running_loop()
        if self._client is None or self._loop is not loop:
            from google import genai  # imported lazily so tests never need network

            self._client = genai.Client(api_key=self._api_key)
            self._loop = loop
        return self._client

    async def _call_once(self, request: StructuredRequest) -> StructuredResponse:
        client = self._client_for_loop()
        interaction = await asyncio.wait_for(
            client.aio.interactions.create(
                model=self.model,
                system_instruction=request.system,
                input=self._build_input(request),
                response_format={
                    "type": "text",
                    "mime_type": "application/json",
                    "schema": request.schema,
                },
                response_mime_type="application/json",
                generation_config={
                    "max_output_tokens": request.max_output_tokens,
                    "temperature": request.temperature,
                    "thinking_level": request.thinking,
                },
                store=False,
                timeout=request.timeout_s or self._timeout,
            ),
            timeout=(request.timeout_s or self._timeout) + 5,
        )
        status = getattr(interaction, "status", "completed")
        if status in ("incomplete", "budget_exceeded"):
            # Usually the output limit was reached (thinking tokens count toward it).
            raise AIInvalidOutput(f"response truncated (status={status})")
        if status in ("failed", "cancelled"):
            raise AIError(f"provider status {status}")
        text = getattr(interaction, "output_text", None) or ""
        if not text.strip():
            raise AIBlocked("empty response")
        usage: dict[str, int] = {}
        raw_usage = getattr(interaction, "usage", None)
        if raw_usage is not None:
            for key in ("total_input_tokens", "total_output_tokens", "total_thought_tokens", "total_tokens"):
                value = getattr(raw_usage, key, None)
                if isinstance(value, int):
                    usage[key] = value
        return StructuredResponse(text=text, model=self.model, usage=usage)

    async def generate_structured(self, request: StructuredRequest) -> StructuredResponse:
        attempt = 0
        while True:
            try:
                return await self._call_once(request)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - classified below
                err = classify_error(exc)
                log.warning("ai call failed task=%s code=%s attempt=%d", request.task, err.code, attempt)
                limit = self._max_retries if request.max_retries is None else request.max_retries
                if attempt >= limit or not _retryable(err):
                    raise err from None
                attempt += 1
                await asyncio.sleep(min(8.0, 1.5**attempt + random.random()))  # noqa: S311


__all__ = ["GeminiProvider", "classify_error", "AIInvalidOutput"]
