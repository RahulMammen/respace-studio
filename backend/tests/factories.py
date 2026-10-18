"""Small builders for synthetic test geometry and scenes."""

from __future__ import annotations

from app.scene import (
    Finish,
    FurnitureRequirement,
    Geometry,
    Inventory,
    Opening,
    Point,
    Room,
    RoomFinish,
    Scene,
    SceneObject,
    Size,
)


def rect_room(
    w: float = 5.0,
    d: float = 4.0,
    room_id: str = "living",
    openings: list[Opening] | None = None,
    x0: float = 0.0,
    y0: float = 0.0,
) -> Room:
    pts = [Point(x=x0, y=y0), Point(x=x0 + w, y=y0), Point(x=x0 + w, y=y0 + d), Point(x=x0, y=y0 + d)]
    return Room(id=room_id, name=room_id.title(), polygon=pts, openings=openings or [])


def door(
    wall: int = 0,
    offset: float = 1.0,
    width: float = 0.9,
    entrance: bool = True,
    oid: str = "door-1",
    hinge: str = "start",
    swing: str = "in",
) -> Opening:
    return Opening(
        id=oid,
        kind="door",
        wall_index=wall,
        offset_m=offset,
        width_m=width,
        height_m=2.1,
        is_entrance=entrance,
        hinge=hinge,  # type: ignore[arg-type]
        swing=swing,  # type: ignore[arg-type]
    )


def window(wall: int = 2, offset: float = 2.5, width: float = 1.4, sill: float = 0.9, oid: str = "win-1") -> Opening:
    return Opening(id=oid, kind="window", wall_index=wall, offset_m=offset, width_m=width, height_m=1.2, sill_m=sill)


def obj(
    oid: str,
    category: str,
    x: float,
    y: float,
    w: float,
    d: float,
    h: float = 0.8,
    rot: float = 0.0,
    variant: str | None = None,
    room: str = "living",
    req: str | None = None,
    locks: list[str] | None = None,
    material: str = "oak",
    elevation: float = 0.0,
) -> SceneObject:
    from app.catalog import CATALOG

    return SceneObject(
        id=oid,
        category=category,  # type: ignore[arg-type]
        variant=variant or CATALOG[category].variants[0].id,
        room_id=room,
        requirement_id=req,
        position=Point(x=x, y=y),
        rotation_deg=rot,
        size=Size(w=w, d=d, h=h),
        finish=Finish(material=material, color="#c9a27a"),
        locks=locks or [],  # type: ignore[arg-type]
        elevation_m=elevation,
    )


def geometry(*rooms: Room) -> Geometry:
    return Geometry(rooms=list(rooms) or [rect_room(openings=[door()])], confirmed=True)


def scene(*objects: SceneObject, rooms: tuple[str, ...] = ("living",)) -> Scene:
    return Scene(
        objects=list(objects),
        finishes=[
            RoomFinish(
                room_id=r,
                floor=Finish(material="oak", color="#c9a27a"),
                walls=Finish(material="plaster", color="#efe9df"),
            )
            for r in rooms
        ],
    )


def inventory(*items: FurnitureRequirement, clearance: float = 0.9) -> Inventory:
    return Inventory(items=list(items), walkway_clearance_m=clearance)


def req(rid: str, category: str, count: int = 1, required: bool = True, **kw: object) -> FurnitureRequirement:
    return FurnitureRequirement(id=rid, category=category, count=count, required=required, **kw)  # type: ignore[arg-type]
