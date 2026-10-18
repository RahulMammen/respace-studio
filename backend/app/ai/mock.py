"""Deterministic provider double for automated tests ONLY.

Selected with AI_PROVIDER=mock. Every response it produces is labelled as a
test double in the API (``provider.test_double = true``) and in the UI. It
never counts as live AI verification.
"""

from __future__ import annotations

import json
import os
import re
from collections.abc import Awaitable, Callable
from typing import Any

from .provider import StructuredRequest, StructuredResponse

Handler = Callable[[StructuredRequest], Awaitable[str] | str]


def _context(text: str) -> dict[str, Any]:
    for line in text.splitlines():
        if line.startswith("{") and '"rooms"' in line:
            return json.loads(line)
    return {}


def _rebuild(ctx: dict[str, Any]) -> tuple[Any, Any]:
    from ..scene import FurnitureRequirement, Geometry, Inventory, Opening, Point, Room
    from .vision import snap_opening

    rooms = []
    for r in ctx.get("rooms", []):
        poly = [{"x": x, "y": y} for x, y in r["polygon"]]
        openings = []
        for o in r.get("openings", []):
            snapped = snap_opening(poly, tuple(o["from"]), tuple(o["to"]))
            if snapped:
                openings.append(
                    Opening(
                        id=o["id"],
                        kind=o["kind"],
                        wall_index=snapped[0],
                        offset_m=snapped[1],
                        width_m=snapped[2],
                        swing=o.get("swing", "in"),
                        is_entrance=o.get("entrance", False),
                        sill_m=o.get("sill", 0.0),
                    )
                )
        rooms.append(
            Room(
                id=r["id"],
                name=r["name"],
                polygon=[Point(**p) for p in poly],
                wall_height_m=r["wall_height"],
                openings=openings,
            )
        )
    inv = ctx.get("inventory", {})
    items = []
    for it in inv.get("items", []):
        items.append(
            FurnitureRequirement(
                id=it["id"],
                category=it["category"],
                count=it["count"],
                required=it["required"],
                variant=it.get("variant"),
                room_id=it.get("room_id"),
                existing=it.get("existing_keep_as_is", False),
            )
        )
    return Geometry(rooms=rooms, confirmed=True), Inventory(
        items=items, walkway_clearance_m=inv.get("walkway_clearance_m", 0.9)
    )


def _scene_to_ai(scene: Any, name: str) -> dict[str, Any]:
    return {
        "name": name,
        "concept": "Deterministic test layout.",
        "objects": [
            {
                "id": o.id,
                "category": o.category,
                "variant": o.variant,
                "requirement_id": o.requirement_id or "",
                "room_id": o.room_id,
                "label": o.label,
                "x": o.position.x,
                "y": o.position.y,
                "rotation_deg": o.rotation_deg,
                "w": o.size.w,
                "d": o.size.d,
                "h": o.size.h,
                "elevation_m": o.elevation_m,
                "material": o.finish.material,
                "color": o.finish.color,
            }
            for o in scene.objects
        ],
        "finishes": [
            {
                "room_id": f.room_id,
                "floor_material": f.floor.material,
                "floor_color": f.floor.color,
                "wall_material": f.walls.material,
                "wall_color": f.walls.color,
            }
            for f in scene.finishes
        ],
        "lighting": scene.lighting.model_dump(),
        "rationale": "Test double output.",
        "tradeoffs": [],
        "unresolved": list(scene.unresolved),
    }


def default_handler(request: StructuredRequest) -> str:
    from ..layout import rule_based_scene

    if request.task == "smoke":
        return json.dumps({"x": 2.0, "y": 4.4, "rotation_deg": 180, "reason": "mock"})
    if request.task in ("generate", "repair"):
        geometry, inventory = _rebuild(_context(request.text))
        n = 3 if "Produce 3" in request.text else 1
        proposals = [
            _scene_to_ai(rule_based_scene(geometry, inventory, seed=s), f"Test layout {s + 1}") for s in range(n)
        ]
        return json.dumps({"proposals": proposals, "conflicts": []})
    if request.task in ("edit", "edit_repair"):
        req = re.search(r"<request>\n(.*?)\n</request>", request.text, re.S)
        message = (req.group(1) if req else "").lower()
        ctx = _context(request.text)
        ops: list[dict[str, Any]] = []
        intent = "edit"
        if "arrangement" in message:
            intent = "rearrange"
        if "floor" in message:
            for r in ctx.get("rooms", []):
                ops.append(
                    {
                        "op": "set_room_finish",
                        "target_id": r["id"],
                        "surface": "floor",
                        "material": "pale_oak",
                        "color": "#dcc3a1",
                    }
                )
        if "warm" in message or "light" in message:
            ops.append(
                {
                    "op": "set_lighting",
                    "target_id": "",
                    "mood": "evening",
                    "color_temperature_k": 2700,
                    "accent_lights": True,
                }
            )
        if "move" in message:
            for o in ctx.get("scene", {}).get("objects", []):
                if o["category"] in message or o["id"] in message:
                    ops.append({"op": "move", "target_id": o["id"], "x": o["x"] + 0.1, "y": o["y"]})
        return json.dumps({"intent": intent, "reply": "Test double reply.", "operations": ops, "conflicts": []})
    if request.task == "extract":
        return json.dumps(
            {
                "rooms": [
                    {
                        "name": "Room",
                        "polygon": [[100, 100], [600, 100], [600, 500], [100, 500]],
                        "confidence": "medium",
                    }
                ],
                "openings": [{"room_index": 0, "kind": "door", "a": [150, 100], "b": [240, 100], "confidence": "low"}],
                "dimension_labels": [],
                "uncertain": ["Test double extraction."],
            }
        )
    if request.task == "review":
        return json.dumps({"summary": "Test double review.", "observations": [], "suggestions": [], "operations": []})
    raise ValueError(f"mock has no handler for task {request.task}")


class MockProvider:
    name = "mock"
    model = "mock-test-double"
    is_test_double = True

    def __init__(self, handler: Handler | None = None) -> None:
        self.handler = handler or default_handler
        self.requests: list[StructuredRequest] = []

    async def generate_structured(self, request: StructuredRequest) -> StructuredResponse:
        self.requests.append(request)
        # MOCK_AI_FAIL=quota simulates an exhausted provider quota offline (browser tests only).
        if os.environ.get("MOCK_AI_FAIL") == "quota":
            from .provider import AIQuotaExceeded

            err = AIQuotaExceeded("simulated by MOCK_AI_FAIL")
            err.user_message = "The AI provider's daily free-tier request limit (20) is used up. Try again later."
            raise err
        out = self.handler(request)
        text = await out if not isinstance(out, str) else out
        return StructuredResponse(text=text, model=self.model)
