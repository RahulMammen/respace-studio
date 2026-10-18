"""Authoritative project geometry and scene schema.

Units and conventions (see docs/geometry.md):
- World lengths are metres. Angles are degrees.
- World X increases to the right of the plan image; world Y increases down the
  plan image. The origin is the plan image's top-left pixel after calibration.
- Rotation is about the vertical axis, positive = clockwise when the plan is
  viewed from above (screen convention with Y down).
- An unrotated object's width runs along +X, its depth along +Y, and its
  front faces +Y.
- Room polygons trace the interior finished face of walls; walls are drawn
  outside the polygon.
"""

from __future__ import annotations

import math
import re
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_validator

SCHEMA_VERSION = 1
ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]{0,47}$")
HEX_PATTERN = re.compile(r"^#[0-9a-fA-F]{6}$")


def _finite(value: float) -> float:
    if not math.isfinite(value):
        raise ValueError("must be a finite number")
    return value


def _check_id(value: str) -> str:
    if not ID_PATTERN.match(value):
        raise ValueError("ids are 1-48 chars: lowercase letters, digits, '-' or '_'")
    return value


def _check_hex(value: str) -> str:
    if not HEX_PATTERN.match(value):
        raise ValueError("colour must be #RRGGBB")
    return value.lower()


Finite = Annotated[float, AfterValidator(_finite)]
Metres = Annotated[float, AfterValidator(_finite), Field(gt=0, le=100)]
StableId = Annotated[str, AfterValidator(_check_id)]
HexColor = Annotated[str, AfterValidator(_check_hex)]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# --------------------------------------------------------------------------- geometry


class Point(Strict):
    x: Finite
    y: Finite


class PlanPoint(Strict):
    """Pixel coordinate in the source plan image (origin top-left, v down)."""

    u: Finite
    v: Finite


class Calibration(Strict):
    a: PlanPoint
    b: PlanPoint
    length_m: Metres

    @property
    def pixel_length(self) -> float:
        return math.hypot(self.b.u - self.a.u, self.b.v - self.a.v)

    @property
    def metres_per_pixel(self) -> float:
        px = self.pixel_length
        if px < 1:
            raise ValueError("calibration segment is too short")
        return self.length_m / px


OpeningKind = Literal["door", "window", "opening"]


class Opening(Strict):
    id: StableId
    kind: OpeningKind
    # Wall edge index: edge i runs from polygon vertex i to vertex i+1.
    wall_index: int = Field(ge=0)
    # Distance along the edge from vertex i to the opening centre.
    offset_m: Finite = Field(ge=0)
    width_m: Metres
    height_m: Metres = 2.1
    sill_m: Finite = Field(0.0, ge=0, le=5)
    # Doors only. "in" swings into this room; hinge is at the edge-start or edge-end side.
    swing: Literal["in", "out", "none"] = "in"
    hinge: Literal["start", "end"] = "start"
    is_entrance: bool = False


class Room(Strict):
    id: StableId
    name: str = Field(min_length=1, max_length=60)
    polygon: list[Point] = Field(min_length=3, max_length=64)
    wall_height_m: Metres = 2.7
    wall_thickness_m: Metres = 0.15
    openings: list[Opening] = Field(default_factory=list, max_length=40)


class Geometry(Strict):
    """Building geometry. Becomes authoritative only when ``confirmed`` is true."""

    schema_version: int = SCHEMA_VERSION
    plan_asset_id: str | None = None
    calibration: Calibration | None = None
    rooms: list[Room] = Field(default_factory=list, max_length=12)
    confirmed: bool = False


# --------------------------------------------------------------------------- furniture

Category = Literal[
    "sofa",
    "armchair",
    "table",
    "dining_chair",
    "desk",
    "bed",
    "wardrobe",
    "bookshelf",
    "rug",
    "lamp",
    "wall_art",
]

LockableProperty = Literal["position", "rotation", "size", "material", "presence"]
LOCKABLE: tuple[str, ...] = ("position", "rotation", "size", "material", "presence")


class Size(Strict):
    w: Metres
    d: Metres
    h: Metres


class SizeRange(Strict):
    min: Size
    max: Size


class Finish(Strict):
    material: str = Field(min_length=1, max_length=40)
    color: HexColor


class SceneObject(Strict):
    id: StableId
    category: Category
    variant: str = Field(min_length=1, max_length=30)
    room_id: StableId
    requirement_id: StableId | None = None  # None means an optional addition
    label: str = Field("", max_length=60)
    position: Point  # footprint centre in world metres
    rotation_deg: Finite = 0.0
    size: Size
    finish: Finish
    accent: Finish | None = None
    # For wall-mounted items: height of the item's bottom edge above the floor.
    elevation_m: Finite = Field(0.0, ge=0, le=5)
    locks: list[LockableProperty] = Field(default_factory=list)
    existing: bool = False  # retained existing furniture

    @field_validator("locks")
    @classmethod
    def _unique_locks(cls, value: list[str]) -> list[str]:
        return sorted(set(value), key=LOCKABLE.index)

    @field_validator("rotation_deg")
    @classmethod
    def _normalise_rotation(cls, value: float) -> float:
        return round(value % 360.0, 6)


class RoomFinish(Strict):
    room_id: StableId
    floor: Finish
    walls: Finish


class Lighting(Strict):
    mood: Literal["daylight", "overcast", "evening", "night"] = "daylight"
    color_temperature_k: int = Field(3500, ge=1800, le=6500)
    intensity: Finite = Field(1.0, ge=0.1, le=2.0)
    accent_lights: bool = False


class Scene(Strict):
    schema_version: int = SCHEMA_VERSION
    objects: list[SceneObject] = Field(default_factory=list, max_length=120)
    finishes: list[RoomFinish] = Field(default_factory=list, max_length=12)
    lighting: Lighting = Field(default_factory=Lighting)
    rationale: str = Field("", max_length=1500)
    tradeoffs: list[str] = Field(default_factory=list, max_length=10)
    unresolved: list[str] = Field(default_factory=list, max_length=10)

    def object_by_id(self, object_id: str) -> SceneObject | None:
        return next((o for o in self.objects if o.id == object_id), None)


# --------------------------------------------------------------------------- requirements


class FurnitureRequirement(Strict):
    id: StableId
    category: Category
    variant: str | None = None
    room_id: StableId | None = None
    count: int = Field(1, ge=1, le=24)
    required: bool = True
    existing: bool = False
    size: SizeRange | None = None  # None means catalogue defaults
    finish: Finish | None = None
    notes: str = Field("", max_length=200)


class Brief(Strict):
    text: str = Field("", max_length=2000)
    priorities: list[str] = Field(default_factory=list, max_length=8)
    reference_asset_ids: list[str] = Field(default_factory=list, max_length=3)


class Inventory(Strict):
    items: list[FurnitureRequirement] = Field(default_factory=list, max_length=40)
    walkway_clearance_m: Finite = Field(0.9, ge=0.5, le=1.8)
    # Narrower path needed to reach individual furniture (stepping in beside a seat).
    access_clearance_m: Finite = Field(0.6, ge=0.45, le=1.2)
