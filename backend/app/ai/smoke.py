"""One small live structured-output request against the configured provider.

Usage (from backend/):  .venv\\Scripts\\python -m app.ai.smoke

Sends only a synthetic 4 m x 5 m room description. Never prints the API key.
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
    x: float = Field(description="Sofa centre x in metres from the room's west wall")
    y: float = Field(description="Sofa centre y in metres from the room's north wall")
    rotation_deg: float = Field(description="Clockwise rotation in degrees seen from above")
    reason: str = Field(description="One short sentence")


async def run() -> int:
    settings = get_settings()
    print(f"provider=gemini model={settings.gemini_model} key_configured={settings.ai_configured}")
    try:
        provider = get_provider()
        schema = inline_json_schema(SmokePlacement.model_json_schema())
        started = time.perf_counter()
        response = await provider.generate_structured(
            StructuredRequest(
                task="smoke",
                system="You place furniture in a synthetic test room. Reply with JSON only.",
                text=(
                    "Room: rectangle 4.0 m wide (x) by 5.0 m deep (y), door centred on the north "
                    "wall (y=0). Place one 2.1 m x 0.9 m sofa against the south wall facing north."
                ),
                schema=schema,
                max_output_tokens=2048,
                temperature=0.2,
                thinking="low",
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
        print(response.text[:400])
        return 3
    print(f"OK model={response.model} seconds={elapsed:.1f} usage={json.dumps(response.usage)}")
    print(placement.model_dump_json())
    inside = 0 < placement.x < 4 and 0 < placement.y < 5
    print(f"placement_inside_room={inside}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(run()))
