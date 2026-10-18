"""Provider-neutral interface for structured multimodal model calls.

The rest of the backend talks only to :class:`DesignModelProvider`. Swapping
providers means writing one new adapter; no other module imports a vendor SDK.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field
from typing import Any, Protocol


class AIError(Exception):
    """Base class for provider failures shown to the user in product language."""

    code = "ai_error"
    user_message = "The design assistant could not complete the request."
    http_status = 502

    def __init__(self, detail: str = "") -> None:
        super().__init__(detail or self.user_message)
        self.detail = detail


class AINotConfigured(AIError):
    code = "ai_not_configured"
    user_message = (
        "AI is not configured. Add GEMINI_API_KEY to backend/.env, restart the server, or use sample proposals."
    )
    http_status = 503


class AIAuthError(AIError):
    code = "ai_auth"
    user_message = "The AI provider rejected the API key or this project lacks access."
    http_status = 502


class AIModelUnavailable(AIError):
    code = "ai_model_unavailable"
    user_message = "The configured AI model is not available to this API key."
    http_status = 502


class AIQuotaExceeded(AIError):
    code = "ai_quota"
    user_message = "The AI provider's rate limit or free-tier quota was reached. Try again later."
    http_status = 429


class AITimeout(AIError):
    code = "ai_timeout"
    user_message = "The AI request took too long and was stopped."
    http_status = 504


class AIInvalidOutput(AIError):
    code = "ai_invalid_output"
    user_message = "The AI returned a response that did not match the required structure."
    http_status = 502


class AIBlocked(AIError):
    code = "ai_blocked"
    user_message = "The AI provider declined to answer this request."
    http_status = 502


@dataclass
class ImagePart:
    data: bytes
    mime_type: str  # image/png or image/jpeg


@dataclass
class StructuredRequest:
    """One bounded call: instructions + content + JSON schema for the reply."""

    task: str  # short label used in diagnostics, never contains user content
    system: str
    text: str
    schema: dict[str, Any]
    images: list[ImagePart] = field(default_factory=list)
    max_output_tokens: int = 8192
    temperature: float = 0.7


@dataclass
class StructuredResponse:
    text: str
    model: str
    usage: dict[str, int] = field(default_factory=dict)


class DesignModelProvider(Protocol):
    name: str
    model: str
    is_test_double: bool

    async def generate_structured(self, request: StructuredRequest) -> StructuredResponse: ...


def inline_json_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """Inline ``$defs`` references and drop keywords providers commonly reject.

    Pydantic emits ``$ref``/``$defs``; flattening keeps the schema inside the
    subset most structured-output implementations accept.
    """

    defs = schema.get("$defs", {})
    dropped = {"title", "default", "examples", "$defs"}

    def walk(node: Any) -> Any:
        if isinstance(node, dict):
            if "$ref" in node:
                name = node["$ref"].split("/")[-1]
                merged = copy.deepcopy(defs[name])
                extra = {k: v for k, v in node.items() if k != "$ref"}
                merged.update(extra)
                return walk(merged)
            return {k: walk(v) for k, v in node.items() if k not in dropped}
        if isinstance(node, list):
            return [walk(v) for v in node]
        return node

    result = walk(schema)
    assert isinstance(result, dict)
    return result
