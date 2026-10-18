"""Google Gemini adapter using the official ``google-genai`` SDK (generate_content, JSON schema)."""

from __future__ import annotations

import asyncio
import logging
import random
import re
from typing import Any

import httpx

from .budget import AIBudgetExhausted, CallBudget
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
    quota = _quota_info(exc)
    if quota is not None:
        return quota
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


def _quota_info(exc: BaseException) -> AIQuotaExceeded | None:
    """Read Google's QuotaFailure/RetryInfo details to tell daily from per-minute limits."""

    details = getattr(exc, "details", None)
    if not isinstance(details, dict):
        return None
    error = details.get("error", details)
    if not isinstance(error, dict) or error.get("status") != "RESOURCE_EXHAUSTED":
        return None
    quota_id, limit, retry = "", "", ""
    for item in error.get("details", []) or []:
        kind = str(item.get("@type", ""))
        if kind.endswith("QuotaFailure"):
            for v in item.get("violations", []) or []:
                quota_id = str(v.get("quotaId", "")) or quota_id
                limit = str(v.get("quotaValue", "")) or limit
        elif kind.endswith("RetryInfo"):
            retry = str(item.get("retryDelay", ""))
    seconds = int(float(retry.rstrip("s"))) if retry.rstrip("s").replace(".", "", 1).isdigit() else None
    wait = ""
    if seconds is not None:
        wait = (
            f" Try again in about {seconds // 3600} h {seconds % 3600 // 60} min."
            if seconds >= 3600
            else (
                f" Try again in about {max(1, seconds // 60)} min." if seconds >= 60 else f" Try again in {seconds} s."
            )
        )
    err = AIQuotaExceeded(f"{quota_id or 'quota'} limit={limit or '?'} retry={retry or '?'}")
    if "PerDay" in quota_id:
        err.user_message = f"The AI provider's daily free-tier request limit ({limit or '?'}) is used up.{wait}"
    elif "PerMinute" in quota_id:
        err.user_message = f"The AI provider's per-minute rate limit was reached.{wait or ' Wait a minute and retry.'}"
    else:
        err.user_message = AIQuotaExceeded.user_message + wait
    return err


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

    def __init__(
        self, api_key: str, model: str, timeout: float, max_retries: int, budget: CallBudget | None = None
    ) -> None:
        if not api_key:
            raise AINotConfigured()
        self._api_key = api_key
        self._client: Any = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self.model = model
        self._timeout = timeout
        self._max_retries = max_retries
        self._budget = budget

    def _contents(self, request: StructuredRequest) -> list[Any]:
        from google.genai import types

        parts: list[Any] = [types.Part.from_text(text=request.text)]
        for image in request.images:
            parts.append(types.Part.from_bytes(data=image.data, mime_type=image.mime_type))
        return [types.Content(role="user", parts=parts)]

    def _client_for_loop(self) -> Any:
        """The SDK's async HTTP client is bound to an event loop; rebuild it per loop."""

        loop = asyncio.get_running_loop()
        if self._client is None or self._loop is not loop:
            from google import genai  # imported lazily so tests never need network
            from google.genai import types

            # SDK-level HTTP retries are disabled: retries are counted and bounded here.
            self._client = genai.Client(
                api_key=self._api_key,
                http_options=types.HttpOptions(retry_options=types.HttpRetryOptions(attempts=1)),
            )
            self._loop = loop
        return self._client

    async def _call_once(self, request: StructuredRequest) -> StructuredResponse:
        # generate_content is used rather than the Interactions API: during live testing
        # (2026-10-18) the Interactions endpoint hung on an exhausted free-tier quota,
        # while generate_content returned HTTP 429 immediately.
        from google.genai import types

        if self._budget is not None:
            self._budget.consume(request.task)  # every outbound attempt, before sending
        client = self._client_for_loop()
        timeout = request.timeout_s or self._timeout
        config = types.GenerateContentConfig(
            system_instruction=request.system,
            response_mime_type="application/json",
            response_json_schema=request.schema,
            max_output_tokens=request.max_output_tokens,
            temperature=request.temperature,
            thinking_config=types.ThinkingConfig(thinking_level=request.thinking),
            http_options=types.HttpOptions(timeout=int(timeout * 1000)),
        )
        response = await asyncio.wait_for(
            client.aio.models.generate_content(model=self.model, contents=self._contents(request), config=config),
            timeout=timeout + 5,
        )
        candidates = getattr(response, "candidates", None) or []
        finish = str(getattr(candidates[0], "finish_reason", "") or "") if candidates else ""
        if "MAX_TOKENS" in finish:
            # Thinking tokens count toward the output limit.
            raise AIInvalidOutput("response truncated at the output limit")
        if any(word in finish for word in ("SAFETY", "BLOCKLIST", "PROHIBITED", "RECITATION")):
            raise AIBlocked(finish)
        text = getattr(response, "text", None) or ""
        if not text.strip():
            feedback = getattr(response, "prompt_feedback", None)
            raise AIBlocked(f"empty response {feedback or finish}".strip())
        usage: dict[str, int] = {}
        meta = getattr(response, "usage_metadata", None)
        if meta is not None:
            for src, dst in (
                ("prompt_token_count", "input_tokens"),
                ("candidates_token_count", "output_tokens"),
                ("thoughts_token_count", "thought_tokens"),
                ("total_token_count", "total_tokens"),
            ):
                value = getattr(meta, src, None)
                if isinstance(value, int):
                    usage[dst] = value
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


__all__ = ["GeminiProvider", "classify_error", "AIInvalidOutput", "AIBudgetExhausted"]
