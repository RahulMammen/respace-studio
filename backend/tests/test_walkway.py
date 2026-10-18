"""Walkway connectivity: a route must exist, not just pairwise gaps."""

from factories import door, geometry, inventory, obj, rect_room, req, scene

from app.geometry.validate import validate_scene
from app.layout import rule_based_scene


def codes(report):
    return {i.code for i in report.issues}


def walkway(report, room="living"):
    return next(w for w in report.derived["walkway"] if w["room_id"] == room)


def test_open_room_reachable():
    g = geometry(rect_room(5, 4, openings=[door(wall=0, offset=1.0)]))
    s = scene(obj("sofa", "sofa", 2.5, 3.5, 2.2, 0.9, rot=180, req="sofa", material="linen"))
    report = validate_scene(g, inventory(req("sofa", "sofa")), s)
    w = walkway(report)
    assert w["entrance_id"] == "door-1" and w["unreached_objects"] == []
    assert len(w["reachable"]) == 1


def test_barrier_cuts_room_even_with_gaps_smaller_than_clearance():
    # Two shelves across the room leave a 0.6 m gap: each pairwise gap exists,
    # but a 0.9 m walkway cannot pass, so the desk behind them is unreachable.
    g = geometry(rect_room(5, 5, openings=[door(wall=0, offset=2.5)]))
    s = scene(
        obj("shelf-a", "bookshelf", 1.1, 2.5, 2.2, 0.4, h=1.9),
        obj("shelf-b", "bookshelf", 3.9, 2.5, 2.2, 0.4, h=1.9),
        obj("desk-1", "desk", 2.5, 4.6, 1.4, 0.7, h=0.75, rot=180),
    )
    report = validate_scene(g, inventory(), s)
    assert "furniture_unreachable" in codes(report)
    assert "desk-1" in walkway(report)["unreached_objects"]
    # The same layout passes with a narrower configured clearance.
    report2 = validate_scene(g, inventory(clearance=0.55), s)
    assert "furniture_unreachable" not in codes(report2)


def test_second_door_unreachable():
    room = rect_room(5, 4, openings=[door(wall=0, offset=1.0), door(wall=2, offset=1.0, entrance=False, oid="door-2")])
    # wardrobe wall across the full width separates the two doors
    s = scene(obj("wardrobe-1", "wardrobe", 2.5, 2.0, 4.9, 0.6, h=2.1))
    report = validate_scene(geometry(room), inventory(), s)
    assert "door_unreachable" in codes(report)


def test_entrance_blocked_inside():
    room = rect_room(5, 4, openings=[door(wall=0, offset=1.0, width=0.8)])
    s = scene(obj("shelf", "bookshelf", 1.0, 1.0, 2.0, 0.4, h=1.0))
    report = validate_scene(geometry(room), inventory(), s)
    assert "door_blocked" in codes(report)
    # Corridor 0.8 m between wall and shelf is narrower than 0.9 m: no route in.
    assert "entrance_blocked" in codes(report) or "furniture_unreachable" in codes(report)


def test_no_door_is_warning_not_pass():
    report = validate_scene(geometry(rect_room(5, 4)), inventory(), scene())
    assert "no_entrance" in codes(report)
    assert report.status == "warnings"


def test_perimeter_access_bed():
    # bed pushed into a corner remains reachable from its open side
    g = geometry(rect_room(4, 4, openings=[door(wall=0, offset=3.2)]))
    s = scene(obj("bed", "bed", 0.8, 2.95, 1.6, 2.1, h=1.0, rot=0, variant="double", material="linen"))
    report = validate_scene(g, inventory(), s)
    assert "furniture_unreachable" not in codes(report)


def test_rule_based_layout_is_valid_for_living_room():
    room = rect_room(5.2, 4.4, openings=[door(wall=0, offset=0.9)])
    inv = inventory(
        req("sofa", "sofa"),
        req("chairs", "armchair", count=2),
        req("bookshelf", "bookshelf"),
        req("coffee", "table", variant="coffee"),
    )
    g = geometry(room)
    for seed in range(3):
        s = rule_based_scene(g, inv, seed=seed)
        report = validate_scene(g, inv, s)
        assert report.errors == [], (seed, [i.message for i in report.errors], s.unresolved)
