"""Deterministic rule-based layout used for the clearly labelled non-AI demo mode.

It is not AI and makes no design-quality claim: it places required furniture
against walls or relative to anchor pieces and keeps only placements that pass
the same validator used for AI proposals.
"""

from __future__ import annotations

import math
import random
from collections.abc import Iterator
from dataclasses import dataclass

from shapely.geometry import Polygon

from .catalog import CATALOG, collision_kind, default_size
from .geometry.shapes import (
    door_swing_polygon,
    edge_frame,
    footprint_polygon,
    opening_clear_zone,
    room_polygon,
)
from .geometry.validate import AREA_EPS, CONTAIN_TOL, _collision_poly, walkway_check
from .scene import (
    Finish,
    FurnitureRequirement,
    Geometry,
    Inventory,
    Lighting,
    Opening,
    Point,
    Room,
    RoomFinish,
    Scene,
    SceneObject,
    Size,
)

ORDER = ["bed", "sofa", "wardrobe", "desk", "bookshelf", "table", "armchair", "dining_chair", "lamp", "rug", "wall_art"]


@dataclass(frozen=True)
class Palette:
    name: str
    floor: tuple[str, str]
    walls: tuple[str, str]
    wood: tuple[str, str]
    fabric: tuple[str, str]
    accent: str


PALETTES = [
    Palette(
        "Warm oak", ("oak", "#c9a27a"), ("plaster", "#efe9df"), ("oak", "#c9a27a"), ("linen", "#d8d0c2"), "#7f8f7a"
    ),
    Palette(
        "Pale ash",
        ("pale_oak", "#dcc3a1"),
        ("plaster", "#f2eee6"),
        ("ash", "#e3d5bd"),
        ("boucle", "#ece6db"),
        "#a7b39b",
    ),
    Palette(
        "Walnut evening",
        ("walnut", "#6f4e37"),
        ("painted", "#e4dccd"),
        ("walnut", "#6f4e37"),
        ("velvet", "#6b7c65"),
        "#b08d57",
    ),
]


def _facing_inward(nx: float, ny: float) -> float:
    """Rotation whose local front (+Y) points along the inward normal."""

    return math.degrees(math.atan2(-nx, ny)) % 360


def _snap_rotation(deg: float) -> float:
    return round(deg / 90.0) * 90.0 % 360


class Placer:
    def __init__(self, room: Room, clearance: float, rng: random.Random) -> None:
        self.room = room
        self.poly = room_polygon(room)
        self.clearance = clearance
        self.rng = rng
        self.placed: list[SceneObject] = []
        self.keepout: list[Polygon] = []
        self.windows: list[tuple[Opening, Polygon]] = []
        for op in room.openings:
            if op.wall_index >= len(room.polygon):
                continue
            if op.kind in ("door", "opening"):
                swing = door_swing_polygon(room, op)
                if swing is not None:
                    self.keepout.append(swing)
                self.keepout.append(opening_clear_zone(room, op, max(0.6, clearance)))
            else:
                self.windows.append((op, opening_clear_zone(room, op, 0.3)))

    def floor_polys(self) -> list[Polygon]:
        return [footprint_polygon(o) for o in self.placed if collision_kind(o.category, o.variant) == "floor"]

    def fits(self, obj: SceneObject) -> bool:
        kind = collision_kind(obj.category, obj.variant)
        poly = footprint_polygon(obj)
        if kind != "wall" and not self.poly.buffer(CONTAIN_TOL).contains(poly):
            return False
        if kind == "floor":
            for other in self.placed:
                if collision_kind(other.category, other.variant) != "floor":
                    continue
                if _collision_poly(obj, other).intersection(_collision_poly(other, obj)).area > AREA_EPS:
                    return False
            if any(poly.intersection(k).area > AREA_EPS for k in self.keepout):
                return False
            for op, zone in self.windows:
                if obj.size.h > op.sill_m + 0.05 and poly.intersection(zone).area > AREA_EPS:
                    return False
            trial = [*self.placed, obj]
            polys = {o.id: footprint_polygon(o) for o in trial}
            result = walkway_check(self.room, trial, polys, self.clearance)
            if any(i.severity == "error" for i in result.issues):
                return False
        return True

    def wall_slots(self, w: float, d: float, step: float = 0.15) -> Iterator[tuple[float, float, float]]:
        edges = list(range(len(self.room.polygon)))
        self.rng.shuffle(edges)
        edges.sort(key=lambda i: -edge_frame(self.room, i)[3])
        for i in edges:
            (sx, sy), (ux, uy), (nx, ny), length = edge_frame(self.room, i)
            if length < w:
                continue
            offsets = [length / 2]
            t = w / 2 + 0.05
            while t <= length - w / 2 - 0.05:
                offsets.append(t)
                t += step
            offsets.sort(key=lambda o: abs(o - length / 2))
            for off in offsets:
                cx = sx + ux * off + nx * (d / 2 + 0.02)
                cy = sy + uy * off + ny * (d / 2 + 0.02)
                yield cx, cy, _facing_inward(nx, ny)

    def try_place(self, obj: SceneObject, slots: Iterator[tuple[float, float, float]]) -> bool:
        for cx, cy, rot in slots:
            cand = obj.model_copy(update={"position": Point(x=round(cx, 3), y=round(cy, 3)), "rotation_deg": rot % 360})
            if self.fits(cand):
                self.placed.append(cand)
                return True
        return False


def _relative(anchor: SceneObject, local_x: float, local_y: float, rot_offset: float) -> tuple[float, float, float]:
    a = math.radians(anchor.rotation_deg)
    c, s = math.cos(a), math.sin(a)
    return (
        anchor.position.x + local_x * c - local_y * s,
        anchor.position.y + local_x * s + local_y * c,
        (anchor.rotation_deg + rot_offset) % 360,
    )


def _make(req: FurnitureRequirement, index: int, room: Room, palette: Palette, variant: str | None) -> SceneObject:
    spec = CATALOG[req.category]
    var = variant or req.variant or spec.variants[0].id
    if spec.variant(var) is None:
        var = spec.variants[0].id
    w, d, h = default_size(req.category, var)
    if req.size:
        w = min(max(w, req.size.min.w), req.size.max.w)
        d = min(max(d, req.size.min.d), req.size.max.d)
        h = min(max(h, req.size.min.h), req.size.max.h)
    if req.finish:
        finish = req.finish
    else:
        wood = palette.wood
        fabric = palette.fabric
        pick = fabric if spec.default_material in ("linen", "boucle", "wool") else wood
        if req.category in ("lamp", "wall_art", "rug"):
            pick = (spec.default_material, spec.default_color)
        if req.category == "armchair":
            pick = ("boucle", palette.accent) if pick == fabric else pick
        finish = Finish(material=pick[0], color=pick[1])
    elevation = 1.45 - h / 2 if req.category == "wall_art" else 0.0
    if req.category == "lamp" and var == "pendant":
        elevation = max(0.0, room.wall_height_m - h - 0.6)
    return SceneObject(
        id=f"{req.id}-{index + 1}" if req.count > 1 else req.id,
        category=req.category,
        variant=var,
        room_id=room.id,
        requirement_id=req.id,
        label=spec.label if req.count == 1 else f"{spec.label} {index + 1}",
        position=Point(x=0, y=0),
        size=Size(w=w, d=d, h=h),
        finish=finish,
        elevation_m=round(elevation, 3),
        existing=req.existing,
    )


def rule_based_scene(geometry: Geometry, inventory: Inventory, seed: int = 0) -> Scene:
    rng = random.Random(seed)  # noqa: S311 - layout variety, not security
    palette = PALETTES[seed % len(PALETTES)]
    rooms = {r.id: r for r in geometry.rooms}
    default_room = geometry.rooms[0]
    placers = {r.id: Placer(r, inventory.walkway_clearance_m, rng) for r in geometry.rooms}
    unresolved: list[str] = []

    reqs = sorted(inventory.items, key=lambda r: ORDER.index(r.category))
    for req in reqs:
        room = rooms.get(req.room_id or "", default_room)
        placer = placers[room.id]
        for k in range(req.count):
            obj = _make(req, k, room, palette, None)
            if not _place_one(placer, obj, req):
                unresolved.append(f"Could not place {obj.label or obj.category} ({obj.id}) without conflicts.")
    finishes = [
        RoomFinish(
            room_id=r.id,
            floor=Finish(material=palette.floor[0], color=palette.floor[1]),
            walls=Finish(material=palette.walls[0], color=palette.walls[1]),
        )
        for r in geometry.rooms
    ]
    objects = [o for p in placers.values() for o in p.placed]
    return Scene(
        objects=objects,
        finishes=finishes,
        lighting=Lighting(
            mood="evening" if seed % 3 == 2 else "daylight", color_temperature_k=3000 if seed % 3 == 2 else 4000
        ),
        rationale=f"Rule-based layout ({palette.name} palette). Generated without AI for demonstration.",
        tradeoffs=[],
        unresolved=unresolved,
    )


def _place_one(placer: Placer, obj: SceneObject, req: FurnitureRequirement) -> bool:
    cat, var = obj.category, obj.variant
    placed = placer.placed
    sofa = next((o for o in placed if o.category == "sofa"), None)
    coffee = next((o for o in placed if o.category == "table" and o.variant == "coffee"), None)
    dining = next((o for o in placed if o.category == "table" and o.variant in ("dining", "round_dining")), None)
    desk = next((o for o in placed if o.category == "desk"), None)
    w, d = obj.size.w, obj.size.d

    if cat == "table" and var == "coffee" and sofa:
        gap = 0.45
        y = sofa.size.d / 2 + gap + d / 2
        if placer.try_place(obj, iter([_relative(sofa, 0, y, 0)])):
            return True
    if cat == "armchair" and sofa:
        anchor = coffee or sofa
        base = coffee.size.d / 2 if coffee else sofa.size.d / 2 + 0.9
        cands = []
        for side in (1, -1):
            off_x = side * ((anchor.size.w / 2) + 0.35 + w / 2)
            cands.append(_relative(anchor, off_x, (base if not coffee else 0.0), -90 * side))
        cands.append(_relative(sofa, 0, sofa.size.d / 2 + 0.45 + (coffee.size.d if coffee else 0) + 0.45 + d / 2, 180))
        if placer.try_place(obj, iter(cands)):
            return True
    if cat == "dining_chair" and dining:
        cands = []
        tw, td = dining.size.w, dining.size.d
        for i in range(4):
            fx = -tw / 2 + tw * (i + 0.5) / 4
            cands.append(_relative(dining, fx, td / 2 + d / 2 - 0.15, 180))
            cands.append(_relative(dining, fx, -td / 2 - d / 2 + 0.15, 0))
        cands.append(_relative(dining, tw / 2 + d / 2 - 0.15, 0, 90))
        cands.append(_relative(dining, -tw / 2 - d / 2 + 0.15, 0, -90))
        if placer.try_place(obj, iter(cands)):
            return True
    if cat == "rug":
        rug_anchor = coffee or dining or next((o for o in placed if o.category == "bed"), None)
        if rug_anchor:
            cx, cy, rot = _relative(rug_anchor, 0, 0, 0)
            if sofa and rug_anchor is coffee:
                cx, cy, rot = _relative(sofa, 0, sofa.size.d / 2 + 0.2 + d / 2 - 0.3, 0)
            if placer.try_place(obj, iter([(cx, cy, rot)])):
                return True
        cent = placer.poly.centroid
        return placer.try_place(obj, iter([(cent.x, cent.y, 0.0), (cent.x, cent.y, 90.0)]))
    if cat == "lamp" and var == "table":
        hosts = [o for o in placed if o.category in ("table", "desk") and o.variant != "dining"]
        cands = [(h.position.x + 0.0, h.position.y, h.rotation_deg) for h in hosts]
        if desk:
            cands.insert(0, _relative(desk, desk.size.w / 2 - 0.25, -desk.size.d / 2 + 0.2, 0))
        return placer.try_place(obj, iter(cands))
    if cat == "lamp" and var == "pendant":
        over = dining or coffee
        cent = placer.poly.centroid
        cands = [(over.position.x, over.position.y, 0.0)] if over else []
        cands.append((cent.x, cent.y, 0.0))
        return placer.try_place(obj, iter(cands))
    if cat == "lamp" and sofa:
        cands = [_relative(sofa, side * (sofa.size.w / 2 + 0.3), -sofa.size.d / 2 + 0.25, 0) for side in (1, -1)]
        if placer.try_place(obj, iter(cands)):
            return True
    if cat == "wall_art":
        focus = sofa or next((o for o in placed if o.category == "bed"), None)
        slots = list(placer.wall_slots(w, d, step=0.3))
        if focus is not None:
            fx0, fy0 = focus.position.x, focus.position.y
            slots.sort(key=lambda s: math.hypot(s[0] - fx0, s[1] - fy0))
        for cx, cy, rot in slots:
            cand = obj.model_copy(update={"position": Point(x=round(cx - 0.0, 3), y=round(cy, 3)), "rotation_deg": rot})
            # wall art sits flush: back edge on the wall face
            a = math.radians(rot)
            fx, fy = -math.sin(a), math.cos(a)
            cand = cand.model_copy(update={"position": Point(x=round(cx - fx * 0.02, 3), y=round(cy - fy * 0.02, 3))})
            from .geometry.validate import _on_wall

            if _on_wall(cand, placer.room) and not _over_opening(placer, cand):
                placer.placed.append(cand)
                return True
        return False
    if placer.try_place(obj, placer.wall_slots(w, d)):
        return True
    # free-standing fallback on a coarse grid
    minx, miny, maxx, maxy = placer.poly.bounds
    cent = placer.poly.centroid
    grid = []
    y = miny + d / 2 + 0.05
    while y < maxy:
        x = minx + w / 2 + 0.05
        while x < maxx:
            rot = _snap_rotation(math.degrees(math.atan2(-(cent.x - x), cent.y - y)))
            grid.append((x, y, rot))
            x += 0.25
        y += 0.25
    grid.sort(key=lambda g: math.hypot(g[0] - cent.x, g[1] - cent.y))
    return placer.try_place(obj, iter(grid))


def _over_opening(placer: Placer, obj: SceneObject) -> bool:
    poly = footprint_polygon(obj)
    for op in placer.room.openings:
        if op.wall_index >= len(placer.room.polygon):
            continue
        strip = opening_clear_zone(placer.room, op, 0.2)
        if poly.intersection(strip).area > AREA_EPS:
            return True
    return False
