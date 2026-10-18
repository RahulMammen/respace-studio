"""Pins backend geometry to shared/geometry_fixtures.json, which the frontend also tests.

Regenerate after an intentional change:  set UPDATE_FIXTURES=1 and run this test.
"""

import json
import math
import os
from pathlib import Path

import pytest
from factories import door, obj, rect_room, window

from app.geometry.shapes import (
    door_swing_polygon,
    footprint,
    opening_segment,
    plan_to_world,
    rotation_to_three_y,
    world_to_three,
)
from app.scene import Calibration, PlanPoint, Room

FIXTURE = Path(__file__).resolve().parents[2] / "shared" / "geometry_fixtures.json"


def build() -> dict:
    cases: dict = {"footprints": [], "openings": [], "calibration": [], "three": []}
    for rot in (0, 37.5, 90, 180, 270, 315):
        o = obj("t", "sofa", 2.0, 1.5, 2.2, 0.9, rot=rot)
        cases["footprints"].append(
            {
                "x": 2.0,
                "y": 1.5,
                "w": 2.2,
                "d": 0.9,
                "rotation_deg": rot,
                "corners": [[round(a, 6), round(b, 6)] for a, b in footprint(o)],
            }
        )
    cw = rect_room(5, 4, openings=[door(wall=0, offset=1.0, width=0.9), window(wall=1, offset=2.0, width=1.2)])
    ccw = Room(
        id="r",
        name="R",
        polygon=list(reversed(cw.polygon)),
        openings=[door(wall=3, offset=4.0, width=0.9, hinge="end"), window(wall=2, offset=2.0, width=1.2)],
    )
    for room in (cw, ccw):
        for op in room.openings:
            a, b = opening_segment(room, op)
            swing = door_swing_polygon(room, op)
            cases["openings"].append(
                {
                    "polygon": [[p.x, p.y] for p in room.polygon],
                    "opening": op.model_dump(mode="json"),
                    "a": [round(a[0], 6), round(a[1], 6)],
                    "b": [round(b[0], 6), round(b[1], 6)],
                    "swing_bounds": [round(v, 6) for v in swing.bounds] if swing is not None else None,
                }
            )
    cal = Calibration(a=PlanPoint(u=120, v=80), b=PlanPoint(u=420, v=480), length_m=5.0)
    for u, v in ((0, 0), (120, 80), (420, 480), (1000, 333)):
        p = plan_to_world(PlanPoint(u=u, v=v), cal)
        cases["calibration"].append(
            {"calibration": cal.model_dump(mode="json"), "u": u, "v": v, "x": round(p.x, 6), "y": round(p.y, 6)}
        )
    for x, y, elev, rot in ((1.0, 2.0, 0.0, 0), (3.5, 0.25, 1.2, 90), (0.0, 4.0, 0.4, 225)):
        tx, ty, tz = world_to_three(x, y, elev)
        cases["three"].append(
            {
                "x": x,
                "y": y,
                "elevation": elev,
                "rotation_deg": rot,
                "position": [tx, ty, tz],
                "rotation_y": round(rotation_to_three_y(rot), 9),
            }
        )
    return cases


def test_fixture_matches_backend():
    data = build()
    if os.environ.get("UPDATE_FIXTURES") == "1" or not FIXTURE.exists():
        FIXTURE.parent.mkdir(parents=True, exist_ok=True)
        FIXTURE.write_text(json.dumps(data, indent=1) + "\n", encoding="utf-8")
    stored = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert stored == data


def test_fixture_contains_rotated_and_reversed_cases():
    stored = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert any(f["rotation_deg"] not in (0, 90, 180, 270) for f in stored["footprints"])
    assert len(stored["openings"]) == 4 and any(o["opening"]["hinge"] == "end" for o in stored["openings"])
    assert all(math.isfinite(c["rotation_y"]) for c in stored["three"])
    assert pytest.approx(stored["calibration"][2]["x"]) == 420 * 0.01
