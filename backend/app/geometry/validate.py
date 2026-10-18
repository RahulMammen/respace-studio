"""Geometric validation of building geometry and furniture scenes.

Schema validity (Pydantic) says a scene is well-formed. This module checks
whether it makes geometric sense: containment, collisions, openings, counts,
dimension limits and an approximate walkway connectivity test.
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Literal

from shapely.geometry import MultiPolygon, Polygon
from shapely.geometry import Point as SPoint
from shapely.ops import unary_union

from ..catalog import CATALOG, MATERIALS, collision_kind
from ..scene import Geometry, Inventory, Room, Scene, SceneObject
from .shapes import (
    door_swing_polygon,
    edge_frame,
    footprint,
    footprint_polygon,
    opening_clear_zone,
    opening_entry_point,
    opening_segment,
    rect_corners,
    room_polygon,
)

Severity = Literal["error", "warning", "info"]
AREA_EPS = 1e-4  # m^2: overlaps smaller than 1 cm^2 are ignored
CONTAIN_TOL = 0.005  # m: footprints may touch walls within 5 mm
WALL_MOUNT_TOL = 0.06  # m: wall items must sit within 6 cm of a wall face
ARC_QUAD_SEGS = 16  # buffer arcs: max chord error r*(1-cos(pi/64)) < 0.6 mm at r = 0.5 m


@dataclass
class Issue:
    code: str
    severity: Severity
    message: str
    object_ids: list[str] = field(default_factory=list)
    check: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "severity": self.severity,
            "message": self.message,
            "object_ids": self.object_ids,
            "check": self.check,
        }


CHECKS: dict[str, str] = {
    "schema": "Objects use supported categories and references",
    "dimensions": "Sizes within allowed ranges",
    "counts": "Required furniture present",
    "containment": "Furniture inside the room",
    "collisions": "No overlapping furniture",
    "openings": "Doors and windows kept clear",
    "walkway": "Walkway connects the entrance to furniture",
}


def _status(issues: list[Issue]) -> str:
    if any(i.severity == "error" for i in issues):
        return "invalid"
    if any(i.severity == "warning" for i in issues):
        return "warnings"
    return "valid"


def _round_ring(coords: Any) -> list[list[float]]:
    return [[round(x, 3), round(y, 3)] for x, y in coords]


def _rings(poly: Polygon) -> list[list[list[float]]]:
    """Polygon as [exterior, *holes], rounded to millimetres."""

    return [_round_ring(poly.exterior.coords)] + [_round_ring(h.coords) for h in poly.interiors]


def _polys(geom: Any) -> list[Polygon]:
    if geom.is_empty:
        return []
    if isinstance(geom, Polygon):
        return [geom]
    if isinstance(geom, MultiPolygon):
        return list(geom.geoms)
    return [g for g in getattr(geom, "geoms", []) if isinstance(g, Polygon)]


# ============================================================ building geometry


def validate_geometry(geometry: Geometry) -> list[Issue]:
    issues: list[Issue] = []
    if not geometry.rooms:
        issues.append(Issue("no_rooms", "error", "Add at least one room.", check="geometry"))
    ids: set[str] = set()
    polys: dict[str, Polygon] = {}
    for room in geometry.rooms:
        if room.id in ids:
            issues.append(Issue("duplicate_id", "error", f"Room id '{room.id}' is used twice."))
        ids.add(room.id)
        issues.extend(_validate_room(room))
        poly = room_polygon(room)
        if poly.is_valid:
            polys[room.id] = poly
    room_ids = list(polys)
    for i, a in enumerate(room_ids):
        for b in room_ids[i + 1 :]:
            if polys[a].intersection(polys[b]).area > 0.01:
                issues.append(Issue("rooms_overlap", "error", f"Rooms '{a}' and '{b}' overlap.", check="geometry"))
    return issues


def _validate_room(room: Room) -> list[Issue]:
    issues: list[Issue] = []
    name = room.name
    pts = [(p.x, p.y) for p in room.polygon]
    if len(set(pts)) != len(pts):
        issues.append(Issue("duplicate_vertex", "error", f"{name}: two corners share a position."))
        return issues
    poly = Polygon(pts)
    if not poly.is_valid or not poly.exterior.is_simple:
        issues.append(Issue("self_intersecting", "error", f"{name}: the boundary crosses itself.", check="geometry"))
        return issues
    if poly.area < 1.0:
        issues.append(Issue("room_too_small", "error", f"{name}: area is under 1 m².", check="geometry"))
    minx, miny, maxx, maxy = poly.bounds
    if max(maxx - minx, maxy - miny) > 60:
        issues.append(Issue("room_too_large", "error", f"{name}: larger than 60 m across.", check="geometry"))
    n = len(room.polygon)
    for i in range(n):
        _, _, _, length = edge_frame(room, i)
        if length < 0.2:
            issues.append(Issue("short_wall", "error", f"{name}: wall {i + 1} is shorter than 0.2 m."))
    if not 2.0 <= room.wall_height_m <= 6.0:
        issues.append(Issue("wall_height", "error", f"{name}: wall height must be 2.0–6.0 m."))
    by_edge: dict[int, list[tuple[float, float, str]]] = defaultdict(list)
    seen: set[str] = set()
    for op in room.openings:
        if op.id in seen:
            issues.append(Issue("duplicate_id", "error", f"{name}: opening id '{op.id}' is used twice."))
        seen.add(op.id)
        if op.wall_index >= n:
            issues.append(Issue("opening_wall", "error", f"{name}: {op.kind} '{op.id}' is on a missing wall."))
            continue
        _, _, _, length = edge_frame(room, op.wall_index)
        start, end = op.offset_m - op.width_m / 2, op.offset_m + op.width_m / 2
        if start < 0 or end > length + 1e-9:
            issues.append(Issue("opening_outside_wall", "error", f"{name}: {op.kind} '{op.id}' extends past its wall."))
        if op.sill_m + op.height_m > room.wall_height_m + 1e-9:
            issues.append(Issue("opening_too_tall", "error", f"{name}: {op.kind} '{op.id}' is taller than the wall."))
        if op.kind == "door" and op.sill_m > 0:
            issues.append(Issue("door_sill", "warning", f"{name}: door '{op.id}' has a raised sill."))
        for s, e, other in by_edge[op.wall_index]:
            if start < e - 1e-9 and s < end - 1e-9:
                issues.append(Issue("openings_overlap", "error", f"{name}: openings '{other}' and '{op.id}' overlap."))
        by_edge[op.wall_index].append((start, end, op.id))
        swing = door_swing_polygon(room, op)
        if swing is not None and swing.difference(poly.buffer(CONTAIN_TOL)).area > 0.01:
            issues.append(Issue("door_swing_outside", "warning", f"{name}: door '{op.id}' swing hits another wall."))
    return issues


# ============================================================ scene validation


@dataclass
class ValidationReport:
    status: str
    issues: list[Issue]
    checks: list[dict[str, Any]]
    derived: dict[str, Any]

    def as_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "issues": [i.as_dict() for i in self.issues],
            "checks": self.checks,
            "derived": self.derived,
        }

    @property
    def errors(self) -> list[Issue]:
        return [i for i in self.issues if i.severity == "error"]


def validate_scene(
    geometry: Geometry, inventory: Inventory, scene: Scene, *, include_derived: bool = True
) -> ValidationReport:
    issues: list[Issue] = []
    rooms = {r.id: r for r in geometry.rooms}
    room_polys = {r.id: room_polygon(r) for r in geometry.rooms}
    requirements = {r.id: r for r in inventory.items}
    clearance = inventory.walkway_clearance_m

    def add(check: str, code: str, sev: Severity, msg: str, ids: list[str] | None = None) -> None:
        issues.append(Issue(code, sev, msg, ids or [], check))

    # ---- schema-level references
    seen: set[str] = set()
    valid_objs: list[SceneObject] = []
    for obj in scene.objects:
        if obj.id in seen:
            add("schema", "duplicate_id", "error", f"Object id '{obj.id}' is used twice.", [obj.id])
            continue
        seen.add(obj.id)
        spec = CATALOG.get(obj.category)
        if spec is None or spec.variant(obj.variant) is None:
            add("schema", "unknown_variant", "error", f"'{obj.id}' uses unsupported model '{obj.variant}'.", [obj.id])
            continue
        if obj.room_id not in rooms:
            add("schema", "unknown_room", "error", f"'{obj.id}' refers to a missing room.", [obj.id])
            continue
        if obj.requirement_id is not None:
            req = requirements.get(obj.requirement_id)
            if req is None:
                add("schema", "unknown_requirement", "error", f"'{obj.id}' refers to a missing requirement.", [obj.id])
            elif req.category != obj.category:
                add("schema", "requirement_category", "error", f"'{obj.id}' is not a {req.category}.", [obj.id])
        bad = [f.material for f in (obj.finish, obj.accent) if f is not None and f.material not in MATERIALS]
        if bad:
            add("schema", "unknown_material", "error", f"'{obj.id}' uses unknown material '{bad[0]}'.", [obj.id])
        valid_objs.append(obj)
    for fin in scene.finishes:
        if fin.room_id not in rooms:
            add("schema", "unknown_room", "error", f"Finish refers to missing room '{fin.room_id}'.")
        for f in (fin.floor, fin.walls):
            if f.material not in MATERIALS:
                add("schema", "unknown_material", "error", f"Finish uses unknown material '{f.material}'.")

    # ---- dimensions
    for obj in valid_objs:
        spec = CATALOG[obj.category]
        dims = (obj.size.w, obj.size.d, obj.size.h)
        if any(v < lo - 1e-9 or v > hi + 1e-9 for v, lo, hi in zip(dims, spec.min_size, spec.max_size, strict=True)):
            add(
                "dimensions",
                "size_out_of_catalog",
                "error",
                f"'{obj.id}' size {_fmt(dims)} is outside the supported {spec.label.lower()} range.",
                [obj.id],
            )
        req = requirements.get(obj.requirement_id or "")
        if req and req.size:
            lo3 = (req.size.min.w, req.size.min.d, req.size.min.h)
            hi3 = (req.size.max.w, req.size.max.d, req.size.max.h)
            if any(v < lo - 1e-9 or v > hi + 1e-9 for v, lo, hi in zip(dims, lo3, hi3, strict=True)):
                add(
                    "dimensions",
                    "size_out_of_requirement",
                    "error",
                    f"'{obj.id}' size {_fmt(dims)} is outside the requested range {_fmt(lo3)}–{_fmt(hi3)}.",
                    [obj.id],
                )

    # ---- counts
    counts: dict[str, list[SceneObject]] = defaultdict(list)
    for obj in valid_objs:
        if obj.requirement_id:
            counts[obj.requirement_id].append(obj)
    for req in inventory.items:
        have = counts.get(req.id, [])
        label = CATALOG[req.category].label.lower()
        if req.required and len(have) < req.count:
            add(
                "counts", "missing_required", "error", f"Needs {req.count} × {label} ({req.id}); scene has {len(have)}."
            )
        if len(have) > req.count:
            add(
                "counts",
                "too_many",
                "error",
                f"Allows {req.count} × {label} ({req.id}); scene has {len(have)}.",
                [o.id for o in have],
            )
        if req.existing:
            not_existing = [o.id for o in have if not o.existing]
            if not_existing:
                add(
                    "counts",
                    "existing_replaced",
                    "error",
                    f"Existing {label} must be retained, not replaced.",
                    not_existing,
                )
        if req.room_id:
            wrong = [o.id for o in have if o.room_id != req.room_id]
            if wrong:
                add("counts", "wrong_room", "error", f"{label.capitalize()} belongs in room '{req.room_id}'.", wrong)

    # ---- containment and wall mounting
    polys: dict[str, Polygon] = {}
    for obj in valid_objs:
        kind = collision_kind(obj.category, obj.variant)
        poly = footprint_polygon(obj)
        polys[obj.id] = poly
        room = rooms[obj.room_id]
        rpoly = room_polys[obj.room_id]
        if kind == "wall":
            if not _on_wall(obj, room):
                add("containment", "not_on_wall", "error", f"'{obj.id}' must be mounted flat against a wall.", [obj.id])
            if obj.elevation_m + obj.size.h > room.wall_height_m:
                add("containment", "above_ceiling", "error", f"'{obj.id}' extends above the ceiling.", [obj.id])
            continue
        if not rpoly.buffer(CONTAIN_TOL).contains(poly):
            add("containment", "outside_room", "error", f"'{obj.id}' extends outside {room.name}.", [obj.id])
        if kind in ("floor", "surface") and obj.size.h > room.wall_height_m:
            add("containment", "above_ceiling", "error", f"'{obj.id}' is taller than the room.", [obj.id])

    # ---- collisions
    floor_objs = [o for o in valid_objs if collision_kind(o.category, o.variant) == "floor"]
    for i, a in enumerate(floor_objs):
        for b in floor_objs[i + 1 :]:
            if a.room_id != b.room_id:
                continue
            pa, pb = _collision_poly(a, b), _collision_poly(b, a)
            overlap = pa.intersection(pb).area
            if overlap > AREA_EPS:
                add(
                    "collisions",
                    "overlap",
                    "error",
                    f"'{a.id}' and '{b.id}' overlap by {overlap:.2f} m².",
                    [a.id, b.id],
                )
    hosts = [o for o in floor_objs if o.category in ("table", "desk", "bookshelf", "wardrobe")]
    for obj in valid_objs:
        if collision_kind(obj.category, obj.variant) != "surface":
            continue
        centre = SPoint(obj.position.x, obj.position.y)
        if not any(polys[h.id].contains(centre) and h.room_id == obj.room_id for h in hosts):
            add(
                "collisions",
                "surface_unsupported",
                "warning",
                f"'{obj.id}' should stand on a table, desk or shelf.",
                [obj.id],
            )

    # ---- openings
    derived_swings: list[dict[str, Any]] = []
    derived_openings: list[dict[str, Any]] = []
    for room in geometry.rooms:
        room_floor = [o for o in floor_objs if o.room_id == room.id]
        room_wall = [o for o in valid_objs if o.room_id == room.id and collision_kind(o.category, o.variant) == "wall"]
        for op in room.openings:
            if op.wall_index >= len(room.polygon):
                continue
            p0, p1 = opening_segment(room, op)
            derived_openings.append({"room_id": room.id, "id": op.id, "kind": op.kind, "a": _r(p0), "b": _r(p1)})
            if op.kind in ("door", "opening"):
                swing = door_swing_polygon(room, op)
                if swing is not None:
                    derived_swings.append(
                        {"room_id": room.id, "id": op.id, "polygon": _round_ring(swing.exterior.coords)}
                    )
                zone = opening_clear_zone(room, op, max(0.6, clearance))
                blocked = []
                for obj in room_floor:
                    poly = polys[obj.id]
                    if (
                        swing is not None
                        and poly.intersection(swing).area > AREA_EPS
                        or poly.intersection(zone).area > AREA_EPS
                    ):
                        blocked.append(obj.id)
                if blocked:
                    add(
                        "openings",
                        "door_blocked",
                        "error",
                        f"{_label(op.kind)} '{op.id}' in {room.name} is blocked by {', '.join(blocked)}.",
                        blocked,
                    )
                if op.width_m + 1e-9 < clearance and op.kind == "door":
                    add(
                        "openings",
                        "door_narrow",
                        "warning",
                        f"Door '{op.id}' ({op.width_m:.2f} m) is narrower than the walkway clearance "
                        f"({clearance:.2f} m).",
                    )
            else:
                zone = opening_clear_zone(room, op, 0.3)
                tall = [
                    o.id
                    for o in room_floor
                    if o.size.h > op.sill_m + 0.05 and polys[o.id].intersection(zone).area > AREA_EPS
                ]
                if tall:
                    add(
                        "openings",
                        "window_obstructed",
                        "warning",
                        f"Window '{op.id}' is partly blocked by {', '.join(tall)}.",
                        tall,
                    )
            for art in room_wall:
                art_poly = polys[art.id]
                strip = opening_clear_zone(room, op, WALL_MOUNT_TOL + art.size.d + 0.01)
                if art_poly.intersection(strip).area > AREA_EPS:
                    add(
                        "openings",
                        "art_over_opening",
                        "error",
                        f"'{art.id}' is mounted over {op.kind} '{op.id}'.",
                        [art.id],
                    )

    # ---- walkway connectivity
    walkway: list[dict[str, Any]] = []
    for room in geometry.rooms:
        result = walkway_check(
            room, [o for o in valid_objs if o.room_id == room.id], polys, clearance, inventory.access_clearance_m
        )
        walkway.append(result.as_dict())
        for issue in result.issues:
            issue.check = "walkway"
            issues.append(issue)

    checks = []
    for check_id, label in CHECKS.items():
        relevant = [i for i in issues if i.check == check_id]
        checks.append({"id": check_id, "label": label, "status": _status(relevant), "count": len(relevant)})

    derived: dict[str, Any] = {}
    if include_derived:
        derived = {
            "footprints": {o.id: _round_ring(polys[o.id].exterior.coords)[:-1] for o in valid_objs},
            "door_swings": derived_swings,
            "openings": derived_openings,
            "walkway": walkway,
            "clearance_m": clearance,
            "access_clearance_m": min(inventory.access_clearance_m, clearance),
        }
    return ValidationReport(status=_status(issues), issues=issues, checks=checks, derived=derived)


def _collision_poly(obj: SceneObject, other: SceneObject) -> Polygon:
    """Footprint used for collision; chairs may tuck partly under tables/desks."""

    spec = CATALOG[obj.category]
    if spec.tuck_m > 0 and other.category in ("table", "desk"):
        d = obj.size.d
        return Polygon(rect_corners(obj.position, obj.rotation_deg, obj.size.w, d, -d / 2, d / 2 - spec.tuck_m))
    return footprint_polygon(obj)


def _on_wall(obj: SceneObject, room: Room) -> bool:
    """Back edge parallel to and within tolerance of some wall face."""

    corners = footprint(obj)
    back_mid = ((corners[0][0] + corners[1][0]) / 2, (corners[0][1] + corners[1][1]) / 2)
    a = math.radians(obj.rotation_deg)
    front_dir = (-math.sin(a), math.cos(a))
    for i in range(len(room.polygon)):
        start, (ux, uy), (nx, ny), length = edge_frame(room, i)
        if length == 0:
            continue
        rel = (back_mid[0] - start[0], back_mid[1] - start[1])
        along = rel[0] * ux + rel[1] * uy
        dist = rel[0] * nx + rel[1] * ny
        facing = front_dir[0] * nx + front_dir[1] * ny
        half = obj.size.w / 2
        if abs(dist) <= WALL_MOUNT_TOL and facing > 0.98 and half - 1e-6 <= along <= length - half + 1e-6:
            return True
    return False


# ============================================================ walkway


@dataclass
class WalkwayResult:
    room_id: str
    clearance_m: float
    entrance_id: str | None
    reachable: list[list[list[list[float]]]]
    unreachable: list[list[list[list[float]]]]
    unreached_objects: list[str]
    unreached_doors: list[str]
    issues: list[Issue]

    def as_dict(self) -> dict[str, Any]:
        return {
            "room_id": self.room_id,
            "clearance_m": self.clearance_m,
            "entrance_id": self.entrance_id,
            "reachable": self.reachable,
            "unreachable": self.unreachable,
            "unreached_objects": self.unreached_objects,
            "unreached_doors": self.unreached_doors,
        }


def access_zone(obj: SceneObject, reach: float) -> Polygon | None:
    """Region where a walker's centre must be able to stand to use the item."""

    spec = CATALOG[obj.category]
    if spec.access_mode == "none" or collision_kind(obj.category, obj.variant) != "floor":
        return None
    depth = spec.access_depth_m + reach
    w, d = obj.size.w, obj.size.d
    # Front/back zones extend sideways by ``reach`` so a seat can be approached from the
    # side of its front edge, as people do in conversation groups.
    if spec.access_mode == "front":
        return Polygon(rect_corners(obj.position, obj.rotation_deg, w + 2 * reach, d, d / 2, d / 2 + depth))
    if spec.access_mode == "back":
        return Polygon(rect_corners(obj.position, obj.rotation_deg, w + 2 * reach, d, -d / 2 - depth, -d / 2))
    base = footprint_polygon(obj)
    return base.buffer(depth, quad_segs=ARC_QUAD_SEGS).difference(base)


def _free_pieces(rpoly: Polygon, blockers: list[Polygon], r: float) -> list[Polygon]:
    free = rpoly.buffer(-r, quad_segs=ARC_QUAD_SEGS)
    if blockers:
        free = free.difference(unary_union(blockers).buffer(r, quad_segs=ARC_QUAD_SEGS))
    return _polys(free)


def _piece_for(pieces: list[Polygon], pt: tuple[float, float]) -> int | None:
    p = SPoint(pt)
    for idx, piece in enumerate(pieces):
        if piece.buffer(0.01).contains(p):
            return idx
    return None


def walkway_check(
    room: Room,
    objects: list[SceneObject],
    polys: dict[str, Polygon],
    clearance: float,
    access_clearance: float | None = None,
) -> WalkwayResult:
    """Approximate connectivity for walkers of two widths.

    Free space for a walker's centre = room interior eroded by r and minus
    floor-blocking footprints dilated by r. Two places are connected when they
    lie in the same connected piece of that free space.

    - Main walkway (r = clearance / 2): the entrance must connect to every other door.
    - Furniture access (r = access_clearance / 2): the entrance must connect to each
      item's access zone. Defaults to the main clearance when not given.
    """

    access = clearance if access_clearance is None else min(access_clearance, clearance)
    r = clearance / 2
    ra = access / 2
    issues: list[Issue] = []
    rpoly = room_polygon(room)
    blockers = [polys[o.id] for o in objects if collision_kind(o.category, o.variant) == "floor"]
    pieces = _free_pieces(rpoly, blockers, r)
    access_pieces = pieces if ra == r else _free_pieces(rpoly, blockers, ra)
    doors = [op for op in room.openings if op.kind in ("door", "opening") and op.wall_index < len(room.polygon)]
    accessible = [o for o in objects if access_zone(o, ra) is not None]
    if not access_pieces:
        issues.append(Issue("no_free_floor", "error", f"{room.name}: no floor area is {access:.2f} m wide."))
        return WalkwayResult(room.id, clearance, None, [], [], [o.id for o in accessible], [], issues)
    if not doors:
        issues.append(Issue("no_entrance", "warning", f"{room.name}: add a door to check the walkway."))
        return WalkwayResult(room.id, clearance, None, [_rings(p) for p in pieces], [], [], [], issues)
    entrance = next((d for d in doors if d.is_entrance), doors[0])

    start = _piece_for(pieces, opening_entry_point(room, entrance, r + 0.02)) if pieces else None
    unreached_doors: list[str] = []
    if start is None:
        issues.append(
            Issue(
                "entrance_blocked",
                "error",
                f"{room.name}: no {clearance:.2f} m clear space inside entrance '{entrance.id}'.",
            )
        )
    else:
        unreached_doors = [
            d.id
            for d in doors
            if d.id != entrance.id and _piece_for(pieces, opening_entry_point(room, d, r + 0.02)) != start
        ]
        if unreached_doors:
            issues.append(
                Issue(
                    "door_unreachable",
                    "error",
                    f"{room.name}: no {clearance:.2f} m route from '{entrance.id}' to {', '.join(unreached_doors)}.",
                )
            )

    astart = _piece_for(access_pieces, opening_entry_point(room, entrance, ra + 0.02))
    unreached: list[str] = []
    if astart is None:
        unreached = [o.id for o in accessible]
    else:
        reach_piece = access_pieces[astart].buffer(0.005)
        for obj in accessible:
            zone = access_zone(obj, ra)
            if zone is not None and zone.intersection(reach_piece).area < 0.01:
                unreached.append(obj.id)
    if unreached:
        issues.append(
            Issue(
                "furniture_unreachable",
                "error",
                f"{room.name}: {', '.join(unreached)} cannot be reached from the entrance "
                f"on a {access:.2f} m access path.",
                unreached,
            )
        )
    return WalkwayResult(
        room.id,
        clearance,
        entrance.id,
        [_rings(pieces[start])] if start is not None else [],
        [_rings(p) for i, p in enumerate(pieces) if i != start],
        unreached,
        unreached_doors,
        issues,
    )


def _fmt(d: tuple[float, float, float]) -> str:
    return " × ".join(f"{v:.2f}" for v in d) + " m"


def _r(p: tuple[float, float]) -> list[float]:
    return [round(p[0], 4), round(p[1], 4)]


def _label(kind: str) -> str:
    return "Door" if kind == "door" else "Opening"
