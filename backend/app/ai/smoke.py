"""One small live structured-output request against the configured provider.

Usage (from backend/):  .venv\\Scripts\\python -m app.ai.smoke

Sends only a synthetic 4 m x 5 m room description, then checks the JSON *and*
the requested placement and orientation under ReSpace's coordinate convention.
Exit codes: 0 pass, 2 provider error, 3 invalid JSON, 4 wrong placement.
Never prints the API key.
"""

from __future__ import annotations

import asyncio
import json
import sys
import time

from pydantic import BaseModel, Field, ValidationError

from ..config import get_settings
from .provider import AIError, StructuredRequest, inline_json_schema
from .registry import get_provider


class SmokePlacement(BaseModel):
    x: float = Field(description="Sofa footprint centre x in metres")
    y: float = Field(description="Sofa footprint centre y in metres")
    rotation_deg: float = Field(description="Clockwise rotation in degrees seen from above")
    reason: str = Field(description="One short sentence")


SYSTEM = (
    "You place furniture in a synthetic test room and reply with JSON only. Coordinates are metres. "
    "x increases to the east (right of the plan); y increases to the south (down the plan); the north "
    "wall is y = 0. rotation_deg is clockwise seen from above. At rotation 0 an object's front faces +y "
    "(south); at 90 it faces west (-x); at 180 it faces north (-y); at 270 it faces east (+x). Width runs "
    "along the object's local x and depth along its local y. Positions are footprint centres."
)
TEXT = (
    "Room: rectangle 4.0 m wide (x from 0 to 4) by 5.0 m deep (y from 0 to 5). Door centred on the north "
    "wall. Place one sofa, 2.1 m wide and 0.9 m deep, centred on the south wall with its back touching "
    "that wall, facing north into the room."
)
EXPECTED = {"x": 2.0, "y": 5.0 - 0.45, "rotation_deg": 180.0}


def check(p: SmokePlacement) -> list[str]:
    problems = []
    if abs(p.x - EXPECTED["x"]) > 0.15:
        problems.append(f"x={p.x:.2f}, expected about {EXPECTED['x']:.2f}")
    if abs(p.y - EXPECTED["y"]) > 0.15:
        problems.append(f"y={p.y:.2f}, expected about {EXPECTED['y']:.2f}")
    delta = abs((p.rotation_deg - EXPECTED["rotation_deg"] + 180) % 360 - 180)
    if delta > 10:
        problems.append(f"rotation_deg={p.rotation_deg:.0f}, expected 180 (facing north)")
    return problems


async def run() -> int:
    settings = get_settings()
    print(f"provider=gemini model={settings.gemini_model} key_configured={settings.ai_configured}")
    try:
        provider = get_provider()
        started = time.perf_counter()
        response = await provider.generate_structured(
            StructuredRequest(
                task="smoke",
                system=SYSTEM,
                text=TEXT,
                schema=inline_json_schema(SmokePlacement.model_json_schema()),
                max_output_tokens=2048,
                temperature=0.2,
                thinking="low",
                max_retries=0,
            )
        )
        elapsed = time.perf_counter() - started
    except AIError as err:
        print(f"FAILED code={err.code}: {err.user_message} ({err.detail})")
        return 2
    try:
        placement = SmokePlacement.model_validate_json(response.text)
    except ValidationError as err:
        print(f"FAILED schema validation: {err.error_count()} errors")
        return 3
    print(f"model={response.model} seconds={elapsed:.1f} usage={json.dumps(response.usage)}")
    print(placement.model_dump_json())
    problems = check(placement)
    if problems:
        print("FAILED placement: " + "; ".join(problems))
        return 4
    print("OK placement and orientation match the request")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(run()))
