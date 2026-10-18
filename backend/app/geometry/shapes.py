"""Derived 2D shapes shared by validation and rendering.

These functions define what a footprint, opening, or door swing *is*. The
frontend implements the same formulas in ``frontend/src/geometry/shapes.ts``;
``shared/geometry_fixtures.json`` pins both implementations to identical numbers.
"""

from __future__ import annotations

import math
from collections.abc import Sequence

from shapely.geometry import Polygon

from ..scene import Calibration, Opening, PlanPoint, Point, Room, SceneObject

Vec = tuple[float, float]


# ------------------------------------------------------------------ conversions


def plan_to_world(p: PlanPoint, cal: Calibration) -> Point:
    """Plan pixels to world metres: uniform scale, shared origin, shared axes."""

    s = cal.metres_per_pixel
    return Point(x=p.u * s, y=p.v * s)


def world_to_plan(p: Point, cal: Calibration) -> PlanPoint:
    s = cal.metres_per_pixel
    return PlanPoint(u=p.x / s, v=p.y / s)


def world_to_three(x: float, y: float, elevation: float = 0.0) -> tuple[float, float, float]:
    """World (X right, Y down-plan, metres) to Three.js (x, y up, z)."""

    return (x, elevation, y)


def rotation_to_three_y(rotation_deg: float) -> float:
    """Clockwise-from-above plan rotation to Three.js rotation about +Y (radians).

    Three.js rotates counter-clockwise about +Y when seen from above in its
    right-handed frame with z = world Y, so the sign flips.
    """

    return -math.radians(rotation_deg)


# ------------------------------------------------------------------ footprints


def rotate(v: Vec, rotation_deg: float) -> Vec:
    a = math.radians(rotation_deg)
    c, s = math.cos(a), math.sin(a)
    return (v[0] * c - v[1] * s, v[0] * s + v[1] * c)


def local_to_world(obj_pos: Point, rotation_deg: float, local: Vec) -> Vec:
    rx, ry = rotate(local, rotation_deg)
    return (obj_pos.x + rx, obj_pos.y + ry)


def rect_corners(
    pos: Point, rotation_deg: float, w: float, d: float, y0: float | None = None, y1: float | None = None
) -> list[Vec]:
    """Corners of a local rectangle x in [-w/2, w/2], y in [y0, y1] (default +-d/2).

    Order: back-left, back-right, front-right, front-left (front = +Y local).
    """

    lo = -d / 2 if y0 is None else y0
    hi = d / 2 if y1 is None else y1
    local = [(-w / 2, lo), (w / 2, lo), (w / 2, hi), (-w / 2, hi)]
    return [local_to_world(pos, rotation_deg, p) for p in local]


def footprint(obj: SceneObject) -> list[Vec]:
    return rect_corners(obj.position, obj.rotation_deg, obj.size.w, obj.size.d)


def footprint_polygon(obj: SceneObject) -> Polygon:
    if obj.category == "rug" and obj.variant == "round":
        from shapely.affinity import rotate as srotate
        from shapely.affinity import scale as sscale
        from shapely.geometry import Point as SPoint

        circle = SPoint(obj.position.x, obj.position.y).buffer(0.5, quad_segs=16)
        ellipse = sscale(circle, obj.size.w, obj.size.d)
        return srotate(ellipse, obj.rotation_deg, origin=(obj.position.x, obj.position.y))
    return Polygon(footprint(obj))


def room_polygon(room: Room) -> Polygon:
    return Polygon([(p.x, p.y) for p in room.polygon])


def signed_area(points: Sequence[Point]) -> float:
    total = 0.0
    n = len(points)
    for i in range(n):
        a, b = points[i], points[(i + 1) % n]
        total += a.x * b.y - b.x * a.y
    return total / 2


# ------------------------------------------------------------------ openings


def edge(room: Room, index: int) -> tuple[Vec, Vec]:
    pts = room.polygon
    a, b = pts[index % len(pts)], pts[(index + 1) % len(pts)]
    return (a.x, a.y), (b.x, b.y)


def edge_frame(room: Room, index: int) -> tuple[Vec, Vec, Vec, float]:
    """Return (start, unit direction, unit inward normal, length) for an edge."""

    (ax, ay), (bx, by) = edge(room, index)
    dx, dy = bx - ax, by - ay
    length = math.hypot(dx, dy)
    if length == 0:
        return (ax, ay), (1.0, 0.0), (0.0, 1.0), 0.0
    ux, uy = dx / length, dy / length
    if signed_area(room.polygon) > 0:
        inward = (-uy, ux)
    else:
        inward = (uy, -ux)
    return (ax, ay), (ux, uy), inward, length


def opening_segment(room: Room, opening: Opening) -> tuple[Vec, Vec]:
    (sx, sy), (ux, uy), _, _ = edge_frame(room, opening.wall_index)
    c0 = opening.offset_m - opening.width_m / 2
    c1 = opening.offset_m + opening.width_m / 2
    return (sx + ux * c0, sy + uy * c0), (sx + ux * c1, sy + uy * c1)


def door_swing_polygon(room: Room, opening: Opening, segments: int = 16) -> Polygon | None:
    """Quarter-circle sector swept by an inward-swinging door leaf."""

    if opening.kind != "door" or opening.swing != "in":
        return None
    (p0, p1) = opening_segment(room, opening)
    _, (ux, uy), (nx, ny), _ = edge_frame(room, opening.wall_index)
    hinge, free_end = (p0, p1) if opening.hinge == "start" else (p1, p0)
    r = opening.width_m
    # Closed leaf points from hinge toward the free jamb; open leaf points inward.
    start = (free_end[0] - hinge[0], free_end[1] - hinge[1])
    start_angle = math.atan2(start[1], start[0])
    end_angle = math.atan2(ny, nx)
    delta = (end_angle - start_angle + math.pi) % (2 * math.pi) - math.pi
    pts: list[Vec] = [hinge]
    for i in range(segments + 1):
        ang = start_angle + delta * i / segments
        pts.append((hinge[0] + r * math.cos(ang), hinge[1] + r * math.sin(ang)))
    del ux, uy
    return Polygon(pts)


def opening_clear_zone(room: Room, opening: Opening, depth: float) -> Polygon:
    """Rectangle inside the room in front of an opening, ``depth`` metres deep."""

    p0, p1 = opening_segment(room, opening)
    _, _, (nx, ny), _ = edge_frame(room, opening.wall_index)
    return Polygon(
        [
            p0,
            p1,
            (p1[0] + nx * depth, p1[1] + ny * depth),
            (p0[0] + nx * depth, p0[1] + ny * depth),
        ]
    )


def opening_entry_point(room: Room, opening: Opening, inset: float) -> Vec:
    p0, p1 = opening_segment(room, opening)
    _, _, (nx, ny), _ = edge_frame(room, opening.wall_index)
    cx, cy = (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2
    return (cx + nx * inset, cy + ny * inset)
