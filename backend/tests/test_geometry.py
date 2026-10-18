import math

import pytest
from factories import door, geometry, inventory, obj, rect_room, req, scene, window
from pydantic import ValidationError

from app.geometry.shapes import (
    door_swing_polygon,
    edge_frame,
    footprint,
    opening_segment,
    plan_to_world,
    rotation_to_three_y,
    world_to_plan,
    world_to_three,
)
from app.geometry.validate import validate_geometry, validate_scene
from app.scene import Calibration, Geometry, PlanPoint, Point, Room, SceneObject, Size, SizeRange


def codes(report):
    return {i.code for i in report.issues}


# ---------------------------------------------------------------- units and conversions


def test_calibration_scale_and_round_trip():
    cal = Calibration(a=PlanPoint(u=100, v=100), b=PlanPoint(u=500, v=100), length_m=4.0)
    assert cal.metres_per_pixel == pytest.approx(0.01)
    p = plan_to_world(PlanPoint(u=350, v=220), cal)
    assert (p.x, p.y) == pytest.approx((3.5, 2.2))
    back = world_to_plan(p, cal)
    assert (back.u, back.v) == pytest.approx((350, 220))


def test_calibration_diagonal_segment():
    cal = Calibration(a=PlanPoint(u=0, v=0), b=PlanPoint(u=300, v=400), length_m=10.0)
    assert cal.metres_per_pixel == pytest.approx(0.02)


def test_calibration_rejects_degenerate_segment():
    cal = Calibration(a=PlanPoint(u=5, v=5), b=PlanPoint(u=5.2, v=5), length_m=1.0)
    with pytest.raises(ValueError):
        _ = cal.metres_per_pixel


def test_world_to_three_axes_and_rotation_sign():
    assert world_to_three(1.5, 2.5, 0.4) == (1.5, 0.4, 2.5)
    # Plan rotation +90 (clockwise seen from above, Y down) maps local +X to world +Y.
    # Three.js rotation about +Y by theta maps (1, 0, 0) to (cos t, 0, -sin t).
    t = rotation_to_three_y(90)
    assert (math.cos(t), -math.sin(t)) == pytest.approx((0.0, 1.0))  # world +Y lives in three z


def test_nan_and_negative_dimensions_rejected():
    with pytest.raises(ValidationError):
        obj("a", "sofa", float("nan"), 1, 2, 1)
    with pytest.raises(ValidationError):
        obj("a", "sofa", 1, 1, -2, 1)
    with pytest.raises(ValidationError):
        obj("a", "sofa", 1, 1, 2, float("inf"))


def test_bad_ids_and_colours_rejected():
    with pytest.raises(ValidationError):
        obj("Sofa One", "sofa", 1, 1, 2, 1)
    data = obj("a", "sofa", 1, 1, 2, 1).model_dump()
    data["finish"] = {"material": "oak", "color": "red"}
    with pytest.raises(ValidationError):
        SceneObject.model_validate(data)


# ---------------------------------------------------------------- footprints


def test_footprint_unrotated_and_rotated():
    o = obj("s", "sofa", 2, 1, 2.0, 1.0)
    assert footprint(o) == pytest.approx([(1, 0.5), (3, 0.5), (3, 1.5), (1, 1.5)])
    r = obj("s", "sofa", 2, 1, 2.0, 1.0, rot=90)
    pts = footprint(r)
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    assert (min(xs), max(xs), min(ys), max(ys)) == pytest.approx((1.5, 2.5, 0.0, 2.0))
    # the front edge (+Y local) of a 90-degree rotated object faces world -X
    assert pts[2][0] < 2 and pts[3][0] < 2


def test_rotation_normalised():
    assert obj("s", "sofa", 2, 2, 2, 1, rot=-90).rotation_deg == 270
    assert obj("s", "sofa", 2, 2, 2, 1, rot=450).rotation_deg == 90


# ---------------------------------------------------------------- building geometry


def test_valid_rectangle_room():
    assert validate_geometry(geometry(rect_room(openings=[door()]))) == []


def test_self_intersecting_room_rejected():
    bow = Room(id="bow", name="Bow", polygon=[Point(x=0, y=0), Point(x=4, y=4), Point(x=4, y=0), Point(x=0, y=4)])
    assert "self_intersecting" in {i.code for i in validate_geometry(Geometry(rooms=[bow]))}


def test_tiny_room_and_short_wall_rejected():
    found = {i.code for i in validate_geometry(Geometry(rooms=[rect_room(0.8, 0.8)]))}
    assert "room_too_small" in found
    sliver = Room(
        id="s",
        name="S",
        polygon=[Point(x=0, y=0), Point(x=4, y=0), Point(x=4, y=3), Point(x=3.9, y=3), Point(x=0, y=3)],
    )
    assert "short_wall" in {i.code for i in validate_geometry(Geometry(rooms=[sliver]))}


def test_opening_outside_wall_and_overlap():
    room = rect_room(openings=[door(offset=4.8, width=0.9)])
    assert "opening_outside_wall" in {i.code for i in validate_geometry(geometry(room))}
    room2 = rect_room(openings=[door(offset=1.0), window(wall=0, offset=1.5, oid="w")])
    assert "openings_overlap" in {i.code for i in validate_geometry(geometry(room2))}


def test_overlapping_rooms_rejected():
    a = rect_room(4, 4, "a")
    b = rect_room(4, 4, "b", x0=2)
    assert "rooms_overlap" in {i.code for i in validate_geometry(Geometry(rooms=[a, b]))}
    c = rect_room(4, 4, "c", x0=4)  # shares a wall only
    assert validate_geometry(Geometry(rooms=[a, c])) == []


def test_inward_normal_independent_of_winding():
    cw = rect_room()
    ccw = Room(id="r", name="R", polygon=list(reversed(cw.polygon)))
    for room in (cw, ccw):
        for i in range(4):
            (sx, sy), (ux, uy), (nx, ny), length = edge_frame(room, i)
            mid = (sx + ux * length / 2 + nx * 0.1, sy + uy * length / 2 + ny * 0.1)
            assert 0 < mid[0] < 5 and 0 < mid[1] < 4


def test_opening_segment_and_door_swing_inside_room():
    room = rect_room(openings=[door(wall=0, offset=1.0, width=0.9)])
    a, b = opening_segment(room, room.openings[0])
    assert a == pytest.approx((0.55, 0.0)) and b == pytest.approx((1.45, 0.0))
    swing = door_swing_polygon(room, room.openings[0])
    assert swing is not None
    assert swing.area == pytest.approx(math.pi * 0.9**2 / 4, rel=0.01)
    minx, miny, maxx, maxy = swing.bounds
    assert miny >= -1e-9 and maxy == pytest.approx(0.9, abs=1e-6)  # swings into the room (+Y)
    assert minx == pytest.approx(0.55) and maxx == pytest.approx(1.45)


def test_door_swing_hinge_end_mirrors():
    room = rect_room(openings=[door(wall=0, offset=1.0, width=0.9, hinge="end")])
    swing = door_swing_polygon(room, room.openings[0])
    assert swing is not None
    assert swing.bounds == pytest.approx((0.55, 0.0, 1.45, 0.9), abs=1e-6)
    hinge_corner = (1.45, 0.0)
    assert any(abs(x - hinge_corner[0]) < 1e-9 and abs(y) < 1e-9 for x, y in swing.exterior.coords)


# ---------------------------------------------------------------- scene checks


def base_inv():
    return inventory(req("sofa", "sofa"))


def test_valid_simple_scene():
    g = geometry(rect_room(openings=[door(wall=0, offset=1.0)]))
    s = scene(obj("sofa", "sofa", 2.5, 3.5, 2.2, 0.9, rot=180, req="sofa", material="linen"))
    report = validate_scene(g, base_inv(), s)
    assert report.status == "valid", report.as_dict()["issues"]


def test_outside_room_and_collision():
    g = geometry(rect_room(openings=[door(wall=0, offset=1.0)]))
    s = scene(
        obj("sofa", "sofa", 4.5, 3.5, 2.2, 0.9, req="sofa", material="linen"),
        obj("table-1", "table", 4.0, 3.4, 1.1, 0.6, h=0.4, variant="coffee"),
    )
    found = codes(validate_scene(g, base_inv(), s))
    assert "outside_room" in found and "overlap" in found


def test_rotated_object_containment_uses_rotated_footprint():
    g = geometry(rect_room(openings=[door(wall=0, offset=1.0)]))
    ok = scene(obj("sofa", "sofa", 0.5, 2.2, 2.2, 0.9, rot=90, req="sofa", material="linen"))
    assert "outside_room" not in codes(validate_scene(g, base_inv(), ok))
    bad = scene(obj("sofa", "sofa", 0.5, 2.2, 2.2, 0.9, rot=0, req="sofa", material="linen"))
    assert "outside_room" in codes(validate_scene(g, base_inv(), bad))


def test_rug_does_not_collide_and_lamp_semantics():
    g = geometry(rect_room(openings=[door(wall=0, offset=1.0)]))
    s = scene(
        obj("sofa", "sofa", 2.5, 3.5, 2.2, 0.9, rot=180, req="sofa", material="linen"),
        obj("rug-1", "rug", 2.5, 3.0, 2.4, 1.7, h=0.012, material="wool"),
        obj("pendant", "lamp", 2.5, 3.5, 0.5, 0.5, h=0.4, variant="pendant", material="brass", elevation=1.8),
    )
    assert codes(validate_scene(g, base_inv(), s)) == set()


def test_door_swing_blocked():
    g = geometry(rect_room(openings=[door(wall=0, offset=1.0)]))
    s = scene(
        obj("sofa", "sofa", 2.5, 3.5, 2.2, 0.9, rot=180, req="sofa", material="linen"),
        obj("shelf", "bookshelf", 1.0, 0.4, 1.0, 0.35, h=1.9),
    )
    assert "door_blocked" in codes(validate_scene(g, base_inv(), s))


def test_counts_and_dimension_ranges():
    inv = inventory(
        req("sofa", "sofa", size=SizeRange(min=Size(w=1.8, d=0.8, h=0.7), max=Size(w=2.0, d=1.0, h=0.9))),
        req("chairs", "armchair", count=2),
    )
    g = geometry(rect_room(6, 5, openings=[door(wall=0, offset=1.0)]))
    s = scene(
        obj("sofa", "sofa", 3, 4.4, 2.2, 0.9, rot=180, req="sofa", material="linen"),
        obj("chair-1", "armchair", 1.0, 2.5, 0.8, 0.8, req="chairs", rot=90, material="linen"),
    )
    found = codes(validate_scene(g, inv, s))
    assert "size_out_of_requirement" in found and "missing_required" in found


def test_too_many_and_wrong_category():
    inv = inventory(req("chairs", "armchair", count=1))
    g = geometry(rect_room(6, 5, openings=[door(wall=0, offset=1.0)]))
    s = scene(
        obj("chair-1", "armchair", 2.0, 3.0, 0.8, 0.8, req="chairs", material="linen"),
        obj("chair-2", "armchair", 4.0, 3.0, 0.8, 0.8, req="chairs", material="linen"),
        obj("sofa", "sofa", 3.0, 4.4, 2.0, 0.9, req="chairs", material="linen", rot=180),
    )
    found = codes(validate_scene(g, inv, s))
    assert "too_many" in found and "requirement_category" in found


def test_catalogue_size_limit_unknown_variant_and_material():
    g = geometry()
    s = scene(obj("sofa", "sofa", 2.5, 2, 4.0, 0.9, req="sofa", material="linen"))
    assert "size_out_of_catalog" in codes(validate_scene(g, base_inv(), s))
    bad = obj("sofa", "sofa", 2.5, 2, 2.0, 0.9, req="sofa", material="linen").model_copy(
        update={"variant": "spaceship"}
    )
    assert "unknown_variant" in codes(validate_scene(g, base_inv(), scene(bad)))
    odd = obj("sofa", "sofa", 2.5, 2, 2.0, 0.9, req="sofa", material="unobtainium")
    assert "unknown_material" in codes(validate_scene(g, base_inv(), scene(odd)))


def test_wall_art_must_be_on_wall_and_not_over_window():
    room = rect_room(openings=[door(wall=0, offset=1.0), window(wall=2, offset=2.5)])
    g = geometry(room)
    # wall 2 runs from (5,4) to (0,4); its inward normal is -Y, so art faces -Y (rotation 180)
    on_wall = obj("art", "wall_art", 1.0, 4 - 0.02, 0.9, 0.04, h=0.6, rot=180, material="painted", elevation=1.2)
    off_wall = obj("art", "wall_art", 1.0, 3.0, 0.9, 0.04, h=0.6, rot=180, material="painted", elevation=1.2)
    over_window = obj("art", "wall_art", 2.5, 4 - 0.02, 0.9, 0.04, h=0.6, rot=180, material="painted", elevation=1.2)
    inv = inventory()
    assert "not_on_wall" not in codes(validate_scene(g, inv, scene(on_wall)))
    assert "not_on_wall" in codes(validate_scene(g, inv, scene(off_wall)))
    assert "art_over_opening" in codes(validate_scene(g, inv, scene(over_window)))


def test_tall_furniture_in_front_of_window_warns():
    room = rect_room(openings=[door(wall=0, offset=1.0), window(wall=2, offset=2.5, sill=0.9)])
    s = scene(obj("shelf", "bookshelf", 2.5, 3.8, 1.0, 0.35, h=1.9, rot=180))
    report = validate_scene(geometry(room), inventory(), s)
    assert "window_obstructed" in codes(report)
    assert report.status == "warnings"


def test_dining_chair_may_tuck_under_table():
    room = rect_room(5, 5, openings=[door(wall=0, offset=1.0)])
    table = obj("table-1", "table", 2.5, 3.0, 1.8, 0.9, h=0.75, variant="dining")
    chair = obj("chair-1", "dining_chair", 2.5, 3.0 + 0.45 + 0.26 - 0.15, 0.48, 0.52, rot=180)
    assert "overlap" not in codes(validate_scene(geometry(room), inventory(), scene(table, chair)))
    deep = obj("chair-1", "dining_chair", 2.5, 3.2, 0.48, 0.52, rot=180)
    assert "overlap" in codes(validate_scene(geometry(room), inventory(), scene(table, deep)))
