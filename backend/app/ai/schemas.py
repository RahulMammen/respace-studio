"""Response schemas requested from the model.

Flat, provider-friendly shapes. Model output is never trusted: it is parsed
here, converted to the authoritative :mod:`app.scene` types, and validated
geometrically before anything is shown as valid.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

CategoryName = Literal[
    "sofa", "armchair", "table", "dining_chair", "desk", "bed", "wardrobe", "bookshelf", "rug", "lamp", "wall_art"
]


class Lenient(BaseModel):
    model_config = ConfigDict(extra="ignore")


class AIObject(Lenient):
    id: str = Field(description="Stable id: lowercase letters, digits and hyphens. Reuse existing ids.")
    category: CategoryName
    variant: str = Field(description="One of the variant ids listed for the category")
    requirement_id: str = Field(description="Inventory requirement id, or empty string for an optional addition")
    room_id: str
    label: str = Field(description="Short display name")
    x: float = Field(description="Footprint centre x in metres")
    y: float = Field(description="Footprint centre y in metres")
    rotation_deg: float = Field(description="Clockwise degrees seen from above; 0 means the front faces +y")
    w: float = Field(description="Width in metres along the object's local x")
    d: float = Field(description="Depth in metres along the object's local y")
    h: float = Field(description="Height in metres")
    elevation_m: float = Field(description="Height of the bottom above the floor; 0 for floor items")
    material: str
    color: str = Field(description="#RRGGBB")


class AIFinish(Lenient):
    room_id: str
    floor_material: str
    floor_color: str
    wall_material: str
    wall_color: str


class AILighting(Lenient):
    mood: Literal["daylight", "overcast", "evening", "night"]
    color_temperature_k: int
    intensity: float
    accent_lights: bool


class AIProposal(Lenient):
    name: str = Field(description="Two to four word name for the concept")
    concept: str = Field(description="One sentence describing the idea")
    objects: list[AIObject]
    finishes: list[AIFinish]
    lighting: AILighting
    rationale: str = Field(description="Two or three sentences grounded in the room and brief")
    tradeoffs: list[str]
    unresolved: list[str] = Field(description="Constraints this proposal could not satisfy")


class AIProposalSet(Lenient):
    proposals: list[AIProposal]
    conflicts: list[str] = Field(description="Requirement conflicts the architect must resolve, if any")


class AIOperation(Lenient):
    op: Literal["move", "rotate", "resize", "set_finish", "set_lighting", "set_room_finish", "add", "remove"]
    target_id: str = Field(description="Object id, or room id for set_room_finish, or empty")
    x: float | None = None
    y: float | None = None
    rotation_deg: float | None = None
    w: float | None = None
    d: float | None = None
    h: float | None = None
    material: str | None = None
    color: str | None = None
    surface: Literal["floor", "walls"] | None = None
    mood: Literal["daylight", "overcast", "evening", "night"] | None = None
    color_temperature_k: int | None = None
    intensity: float | None = None
    accent_lights: bool | None = None
    category: CategoryName | None = None
    variant: str | None = None
    room_id: str | None = None
    requirement_id: str | None = None
    label: str | None = None


class AIEditPlan(Lenient):
    intent: Literal["edit", "rearrange", "geometry_change", "question"] = Field(
        description="edit: targeted operations; rearrange: new arrangement of the same inventory; "
        "geometry_change: user asked to change walls/doors/windows; question: answer only"
    )
    reply: str = Field(description="Short reply to the architect in plain language")
    operations: list[AIOperation]
    conflicts: list[str] = Field(description="Requested changes that conflict with locks or constraints")


class AIExtractedRoom(Lenient):
    name: str
    polygon: list[list[float]] = Field(description="Corner points [u, v] in image pixels, in drawing order")
    confidence: Literal["low", "medium", "high"]


class AIExtractedOpening(Lenient):
    room_index: int
    kind: Literal["door", "window", "opening"]
    a: list[float] = Field(description="[u, v] pixel at one end of the opening")
    b: list[float] = Field(description="[u, v] pixel at the other end")
    confidence: Literal["low", "medium", "high"]


class AIExtraction(Lenient):
    rooms: list[AIExtractedRoom]
    openings: list[AIExtractedOpening]
    dimension_labels: list[str] = Field(description="Dimension text read from the drawing, verbatim")
    uncertain: list[str] = Field(description="Features that are unclear or assumed")


class AIObservation(Lenient):
    text: str
    object_ids: list[str]
    kind: Literal["strength", "concern", "check"]


class AISuggestion(Lenient):
    title: str
    category: CategoryName | None = None
    dimensions: str = Field(description="Approximate size in metres, or empty")
    finish: str
    color: str
    rationale: str


class AIReview(Lenient):
    summary: str
    observations: list[AIObservation]
    suggestions: list[AISuggestion]
    operations: list[AIOperation]
