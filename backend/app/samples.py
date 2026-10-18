"""Synthetic sample projects. Plans are drawn programmatically: no real client data."""

from __future__ import annotations

import io
import math

from PIL import Image, ImageDraw, ImageFont
from sqlalchemy.orm import Session

from .config import get_settings
from .db import Asset, Project, User, new_id
from .geometry.shapes import edge_frame, opening_segment
from .layout import rule_based_scene
from .scene import (
    Brief,
    Calibration,
    FurnitureRequirement,
    Geometry,
    Inventory,
    Opening,
    PlanPoint,
    Point,
    Room,
)
from .services import create_alternative

PX_PER_M = 100
MARGIN = 90


def _font(size: int) -> ImageFont.ImageFont | ImageFont.FreeTypeFont:
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # older Pillow
        return ImageFont.load_default()


def draw_plan(rooms: list[Room], title: str) -> bytes:
    """Draw a clean, synthetic architectural plan at 100 px per metre."""

    maxx = max(p.x for r in rooms for p in r.polygon)
    maxy = max(p.y for r in rooms for p in r.polygon)
    w, h = int(maxx * PX_PER_M + 2 * MARGIN), int(maxy * PX_PER_M + 2 * MARGIN + 40)
    img = Image.new("RGB", (w, h), "#fbfaf6")
    d = ImageDraw.Draw(img)

    def px(x: float, y: float) -> tuple[float, float]:
        return (MARGIN + x * PX_PER_M, MARGIN + y * PX_PER_M)

    for gx in range(0, w, 25):
        d.line([(gx, 0), (gx, h)], fill="#f1eee6")
    for gy in range(0, h, 25):
        d.line([(0, gy), (w, gy)], fill="#f1eee6")
    for room in rooms:
        pts = [px(p.x, p.y) for p in room.polygon]
        d.polygon(pts, fill="#ffffff")
    for room in rooms:
        n = len(room.polygon)
        for i in range(n):
            a = room.polygon[i]
            b = room.polygon[(i + 1) % n]
            d.line([px(a.x, a.y), px(b.x, b.y)], fill="#2b2a28", width=int(room.wall_thickness_m * PX_PER_M))
        for op in room.openings:
            p0, p1 = opening_segment(room, op)
            _, (ux, uy), (nx, ny), _ = edge_frame(room, op.wall_index)
            d.line([px(*p0), px(*p1)], fill="#ffffff", width=int(room.wall_thickness_m * PX_PER_M) + 2)
            if op.kind == "window":
                for off in (-0.04, 0.0, 0.04):
                    d.line(
                        [px(p0[0] - nx * off, p0[1] - ny * off), px(p1[0] - nx * off, p1[1] - ny * off)],
                        fill="#4a6b78",
                        width=2,
                    )
            elif op.kind == "door":
                hinge = p0 if op.hinge == "start" else p1
                free = p1 if op.hinge == "start" else p0
                r = op.width_m
                leaf_end = (hinge[0] + nx * r, hinge[1] + ny * r)
                d.line([px(*hinge), px(*leaf_end)], fill="#2b2a28", width=3)
                start = math.atan2(free[1] - hinge[1], free[0] - hinge[0])
                end = math.atan2(ny, nx)
                delta = (end - start + math.pi) % (2 * math.pi) - math.pi
                arc = [
                    px(hinge[0] + r * math.cos(start + delta * t / 24), hinge[1] + r * math.sin(start + delta * t / 24))
                    for t in range(25)
                ]
                d.line(arc, fill="#8a8680", width=1)
        cx = sum(p.x for p in room.polygon) / len(room.polygon)
        cy = sum(p.y for p in room.polygon) / len(room.polygon)
        d.text(px(cx, cy), room.name.upper(), fill="#6b6862", font=_font(16), anchor="mm")
    # overall dimension along the top
    y = MARGIN - 45
    d.line([(MARGIN, y), (MARGIN + maxx * PX_PER_M, y)], fill="#2b2a28", width=1)
    for xx in (MARGIN, MARGIN + maxx * PX_PER_M):
        d.line([(xx, y - 8), (xx, y + 8)], fill="#2b2a28", width=1)
    d.text((MARGIN + maxx * PX_PER_M / 2, y - 14), f"{maxx * 1000:.0f}", fill="#2b2a28", font=_font(15), anchor="mm")
    d.text((MARGIN, h - 30), f"{title} - synthetic sample plan, scale 1:50 at print", fill="#8a8680", font=_font(13))
    out = io.BytesIO()
    img.save(out, format="PNG", optimize=True)
    return out.getvalue()


def _rect(rid: str, name: str, x0: float, y0: float, w: float, d: float, openings: list[Opening]) -> Room:
    return Room(
        id=rid,
        name=name,
        polygon=[Point(x=x0, y=y0), Point(x=x0 + w, y=y0), Point(x=x0 + w, y=y0 + d), Point(x=x0, y=y0 + d)],
        openings=openings,
    )


def _shift(rooms: list[Room]) -> list[Room]:
    """Place rooms in plan-image world coordinates (origin at the image's top-left pixel)."""

    off = MARGIN / PX_PER_M
    return [
        r.model_copy(update={"polygon": [Point(x=round(p.x + off, 4), y=round(p.y + off, 4)) for p in r.polygon]})
        for r in rooms
    ]


def _store_plan(db: Session, project: Project, png: bytes, name: str) -> Asset:
    settings = get_settings()
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    storage = f"{new_id()}.png"
    (settings.upload_dir / storage).write_bytes(png)
    with Image.open(io.BytesIO(png)) as img:
        w, h = img.size
    asset = Asset(
        project_id=project.id,
        kind="plan",
        filename=storage,
        original_name=name,
        mime_type="image/png",
        width_px=w,
        height_px=h,
        source="synthetic sample",
        size_bytes=len(png),
    )
    db.add(asset)
    db.flush()
    return asset


def _calibration(width_m: float) -> Calibration:
    return Calibration(
        a=PlanPoint(u=MARGIN, v=MARGIN - 45),
        b=PlanPoint(u=MARGIN + width_m * PX_PER_M, v=MARGIN - 45),
        length_m=width_m,
    )


LIVING_BRIEF = (
    "Living room with a three-seater sofa, two accent chairs, a bookshelf, and a coffee table. Warm contemporary "
    "style, oak finishes, muted green accents, and evening lighting. Preserve a clear main walkway."
)


def create_samples(db: Session, user: User) -> list[Project]:
    created: list[Project] = []

    # 1. Single living room, confirmed, with a rule-based sample layout.
    living = [
        _rect(
            "living",
            "Living room",
            0,
            0,
            5.4,
            4.2,
            [
                Opening(
                    id="door-1", kind="door", wall_index=0, offset_m=0.75, width_m=0.9, is_entrance=True, hinge="start"
                ),
                Opening(id="win-1", kind="window", wall_index=1, offset_m=2.1, width_m=1.6, height_m=1.4, sill_m=0.8),
                Opening(id="win-2", kind="window", wall_index=2, offset_m=2.7, width_m=2.0, height_m=1.4, sill_m=0.8),
            ],
        )
    ]
    p1 = Project(
        owner_id=user.id, name="Sample · Warm living room", is_sample=True, geometry={}, inventory={}, brief={}
    )
    db.add(p1)
    db.flush()
    plan1 = _store_plan(db, p1, draw_plan(living, "Living room"), "sample-living-room.png")
    geo1 = Geometry(plan_asset_id=plan1.id, calibration=_calibration(5.4), rooms=_shift(living), confirmed=True)
    inv1 = Inventory(
        items=[
            FurnitureRequirement(id="sofa", category="sofa", variant="three_seat"),
            FurnitureRequirement(id="chairs", category="armchair", variant="slim", count=2),
            FurnitureRequirement(id="bookshelf", category="bookshelf", variant="tall"),
            FurnitureRequirement(id="coffee", category="table", variant="coffee"),
            FurnitureRequirement(id="rug", category="rug", required=False),
            FurnitureRequirement(id="lamp", category="lamp", variant="floor", required=False),
        ]
    )
    p1.geometry = geo1.model_dump(mode="json")
    p1.inventory = inv1.model_dump(mode="json")
    p1.brief = Brief(text=LIVING_BRIEF, priorities=["clear walkway", "evening mood"]).model_dump(mode="json")
    for seed in range(2):
        create_alternative(
            db,
            p1,
            f"Sample layout {'AB'[seed]} (not AI)",
            "sample",
            rule_based_scene(geo1, inv1, seed=seed),
            "Rule-based sample layout (not AI)",
            "sample",
        )
    created.append(p1)

    # 2. Two rooms on one floor sharing a wall and a door.
    two = [
        _rect(
            "living",
            "Living",
            0,
            0,
            4.8,
            4.0,
            [
                Opening(id="door-1", kind="door", wall_index=3, offset_m=1.0, width_m=0.9, is_entrance=True),
                Opening(id="door-2", kind="door", wall_index=1, offset_m=3.0, width_m=0.8, hinge="end"),
                Opening(id="win-1", kind="window", wall_index=0, offset_m=2.4, width_m=1.8, height_m=1.4, sill_m=0.8),
            ],
        ),
        _rect(
            "bedroom",
            "Bedroom",
            4.8,
            0,
            3.6,
            4.0,
            [
                Opening(id="door-2b", kind="door", wall_index=3, offset_m=1.0, width_m=0.8, swing="out"),
                Opening(id="win-2", kind="window", wall_index=1, offset_m=2.0, width_m=1.4, height_m=1.3, sill_m=0.9),
            ],
        ),
    ]
    p2 = Project(
        owner_id=user.id, name="Sample · Living and bedroom", is_sample=True, geometry={}, inventory={}, brief={}
    )
    db.add(p2)
    db.flush()
    plan2 = _store_plan(db, p2, draw_plan(two, "Two-room flat"), "sample-two-room.png")
    geo2 = Geometry(plan_asset_id=plan2.id, calibration=_calibration(8.4), rooms=_shift(two), confirmed=True)
    inv2 = Inventory(
        items=[
            FurnitureRequirement(id="sofa", category="sofa", variant="two_seat", room_id="living"),
            FurnitureRequirement(id="dining", category="table", variant="round_dining", room_id="living"),
            FurnitureRequirement(id="dchairs", category="dining_chair", count=2, room_id="living"),
            FurnitureRequirement(id="bed", category="bed", variant="double", room_id="bedroom"),
            FurnitureRequirement(id="wardrobe", category="wardrobe", room_id="bedroom"),
            FurnitureRequirement(id="desk", category="desk", room_id="bedroom", required=False),
        ]
    )
    p2.geometry = geo2.model_dump(mode="json")
    p2.inventory = inv2.model_dump(mode="json")
    p2.brief = Brief(
        text="Calm Scandinavian flat for one person who works from home. Pale ash, linen, soft daylight.",
        priorities=["daylight at the desk", "uncluttered"],
    ).model_dump(mode="json")
    create_alternative(
        db,
        p2,
        "Sample layout (not AI)",
        "sample",
        rule_based_scene(geo2, inv2, seed=1),
        "Rule-based sample layout (not AI)",
        "sample",
    )
    created.append(p2)

    # 3. Plan only: the tester calibrates, traces and confirms it.
    study = [
        _rect(
            "study",
            "Study",
            0,
            0,
            3.6,
            3.2,
            [
                Opening(id="door-1", kind="door", wall_index=2, offset_m=0.8, width_m=0.85, is_entrance=True),
                Opening(id="win-1", kind="window", wall_index=0, offset_m=1.8, width_m=1.4, height_m=1.3, sill_m=0.9),
            ],
        )
    ]
    p3 = Project(
        owner_id=user.id,
        name="Sample · Study to trace",
        is_sample=True,
        geometry=Geometry().model_dump(mode="json"),
        inventory=Inventory(
            items=[
                FurnitureRequirement(id="desk", category="desk"),
                FurnitureRequirement(id="bookshelf", category="bookshelf", variant="tall"),
                FurnitureRequirement(id="chair", category="armchair", variant="lounge"),
            ]
        ).model_dump(mode="json"),
        brief=Brief(text="Quiet study with a reading corner and walnut shelving.").model_dump(mode="json"),
    )
    db.add(p3)
    db.flush()
    plan3 = _store_plan(db, p3, draw_plan(study, "Study"), "sample-study.png")
    p3.geometry = Geometry(plan_asset_id=plan3.id).model_dump(mode="json")
    created.append(p3)
    db.commit()
    return created
