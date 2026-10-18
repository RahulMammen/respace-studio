"""Optional hard cap on outbound model calls, shared across processes via a file.

Enabled only when ``AI_CALL_BUDGET`` > 0 (manual live verification runs). Every
outbound attempt, including our own retries and repair calls, consumes one unit
before the request is sent. The SDK's built-in HTTP retries are disabled in the
adapter, so nothing can bypass the count.
"""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path

from .provider import AIError

_lock = threading.Lock()


class AIBudgetExhausted(AIError):
    code = "ai_budget"
    user_message = "The AI call budget for this verification run is used up."
    http_status = 429


class CallBudget:
    def __init__(self, path: Path, limit: int) -> None:
        self.path = path
        self.limit = limit

    def used(self) -> int:
        try:
            return int(json.loads(self.path.read_text(encoding="utf-8")).get("used", 0))
        except (FileNotFoundError, ValueError, OSError):
            return 0

    def consume(self, task: str) -> int:
        with _lock:
            used = self.used()
            if used >= self.limit:
                raise AIBudgetExhausted(f"{used}/{self.limit} calls used")
            data = {"used": used + 1, "limit": self.limit, "last_task": task}
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(data), encoding="utf-8")
            os.replace(tmp, self.path)
            return used + 1

    def reset(self) -> None:
        self.path.unlink(missing_ok=True)
