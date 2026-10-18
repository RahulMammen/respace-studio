"""Furniture catalogue: supported categories, variants, sizes, collision semantics.

Procedural models in the frontend are built from this same table (served at
``GET /api/catalog``), so supported model references and size limits agree.
Sizes are approximate concept-design envelopes, not product reconstructions.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

# floor:   occupies floor area; blocks circulation; collides with other floor items.
# overlay: lies on the floor (rugs); must stay inside the room; never blocks or collides.
# surface: sits on another item (table lamps); no floor footprint.
# ceiling: hangs from the ceiling (pendants); must be inside the room; no floor footprint.
# wall:    mounted on a wall (art); must touch a wall and avoid openings; no floor footprint.
CollisionKind = Literal["floor", "overlay", "surface", "ceiling", "wall"]


@dataclass(frozen=True)
class Variant:
    id: str
    label: str
    default: tuple[float, float, float]  # w, d, h metres
    collision: CollisionKind = "floor"


@dataclass(frozen=True)
class CategorySpec:
    id: str
    label: str
    variants: tuple[Variant, ...]
    min_size: tuple[float, float, float]
    max_size: tuple[float, float, float]
    # Depth of the zone in front (+Y local) that a person must be able to reach.
    # "perimeter" means any side (tables, beds).
    access_depth_m: float = 0.0
    access_mode: Literal["front", "perimeter", "back", "none"] = "front"
    # Depth of the item's front that may tuck under a table or desk.
    tuck_m: float = 0.0
    default_material: str = "oak"
    default_color: str = "#c9a27a"
    materials: tuple[str, ...] = field(default_factory=tuple)

    def variant(self, variant_id: str) -> Variant | None:
        return next((v for v in self.variants if v.id == variant_id), None)


WOODS = ("oak", "pale_oak", "walnut", "ash", "painted")
FABRICS = ("linen", "boucle", "wool", "leather", "velvet")

CATALOG: dict[str, CategorySpec] = {
    spec.id: spec
    for spec in (
        CategorySpec(
            "sofa",
            "Sofa",
            (
                Variant("three_seat", "Three-seater", (2.2, 0.92, 0.8)),
                Variant("two_seat", "Two-seater", (1.7, 0.9, 0.8)),
                Variant("corner", "Corner", (2.6, 1.6, 0.8)),
            ),
            (1.2, 0.75, 0.6),
            (3.4, 2.2, 1.0),
            access_depth_m=0.45,
            default_material="linen",
            default_color="#d8d0c2",
            materials=FABRICS,
        ),
        CategorySpec(
            "armchair",
            "Armchair",
            (
                Variant("lounge", "Lounge chair", (0.82, 0.85, 0.78)),
                Variant("slim", "Slim accent chair", (0.66, 0.72, 0.8)),
            ),
            (0.5, 0.5, 0.6),
            (1.1, 1.1, 1.1),
            access_depth_m=0.45,
            default_material="boucle",
            default_color="#e7e1d6",
            materials=FABRICS + ("rattan",),
        ),
        CategorySpec(
            "table",
            "Table",
            (
                Variant("coffee", "Coffee table", (1.1, 0.6, 0.4)),
                Variant("dining", "Dining table", (1.8, 0.9, 0.75)),
                Variant("side", "Side table", (0.45, 0.45, 0.55)),
                Variant("round_dining", "Round dining table", (1.2, 1.2, 0.75)),
            ),
            (0.3, 0.3, 0.3),
            (3.0, 1.4, 0.8),
            access_depth_m=0.6,
            access_mode="perimeter",
            materials=WOODS + ("stone", "glass"),
        ),
        CategorySpec(
            "dining_chair",
            "Dining chair",
            (Variant("standard", "Dining chair", (0.48, 0.52, 0.82)),),
            (0.38, 0.4, 0.7),
            (0.65, 0.65, 1.0),
            access_depth_m=0.4,
            access_mode="back",
            tuck_m=0.22,
            materials=WOODS + FABRICS,
        ),
        CategorySpec(
            "desk",
            "Desk",
            (Variant("writing", "Writing desk", (1.4, 0.7, 0.75)),),
            (0.9, 0.5, 0.65),
            (2.2, 1.0, 0.8),
            access_depth_m=0.75,
            materials=WOODS,
        ),
        CategorySpec(
            "bed",
            "Bed",
            (
                Variant("double", "Double", (1.6, 2.1, 1.0)),
                Variant("king", "King", (1.9, 2.15, 1.05)),
                Variant("single", "Single", (1.0, 2.05, 0.95)),
            ),
            (0.9, 1.9, 0.4),
            (2.2, 2.3, 1.3),
            access_depth_m=0.6,
            access_mode="perimeter",
            default_material="linen",
            default_color="#ebe6dc",
            materials=FABRICS + WOODS,
        ),
        CategorySpec(
            "wardrobe",
            "Wardrobe",
            (Variant("double_door", "Two-door wardrobe", (1.2, 0.6, 2.1)),),
            (0.6, 0.45, 1.6),
            (3.0, 0.7, 2.6),
            access_depth_m=0.7,
            materials=WOODS,
        ),
        CategorySpec(
            "bookshelf",
            "Bookshelf",
            (
                Variant("tall", "Tall shelving", (1.0, 0.35, 1.9)),
                Variant("low", "Low shelving", (1.4, 0.4, 0.8)),
            ),
            (0.4, 0.25, 0.5),
            (3.0, 0.5, 2.6),
            access_depth_m=0.5,
            materials=WOODS,
        ),
        CategorySpec(
            "rug",
            "Rug",
            (
                Variant("rectangle", "Rectangular rug", (2.4, 1.7, 0.012), "overlay"),
                Variant("round", "Round rug", (1.8, 1.8, 0.012), "overlay"),
            ),
            (0.6, 0.6, 0.005),
            (5.0, 4.0, 0.03),
            access_mode="none",
            default_material="wool",
            default_color="#b9ae9c",
            materials=("wool", "jute", "linen"),
        ),
        CategorySpec(
            "lamp",
            "Lamp",
            (
                Variant("floor", "Floor lamp", (0.4, 0.4, 1.6)),
                Variant("table", "Table lamp", (0.3, 0.3, 0.5), "surface"),
                Variant("pendant", "Pendant", (0.5, 0.5, 0.4), "ceiling"),
            ),
            (0.15, 0.15, 0.2),
            (1.0, 1.0, 2.2),
            access_mode="none",
            default_material="brass",
            default_color="#b08d57",
            materials=("brass", "black_metal", "paper", "glass"),
        ),
        CategorySpec(
            "wall_art",
            "Wall art",
            (Variant("frame", "Framed artwork", (0.9, 0.04, 0.65), "wall"),),
            (0.2, 0.01, 0.2),
            (3.0, 0.1, 2.0),
            access_mode="none",
            default_material="painted",
            default_color="#7f8f7a",
            materials=("painted", "oak", "black_metal"),
        ),
    )
}

MATERIALS: dict[str, dict[str, object]] = {
    "oak": {"label": "Oak", "kind": "wood", "color": "#c9a27a", "roughness": 0.65},
    "pale_oak": {"label": "Pale oak", "kind": "wood", "color": "#dcc3a1", "roughness": 0.6},
    "walnut": {"label": "Walnut", "kind": "wood", "color": "#6f4e37", "roughness": 0.55},
    "ash": {"label": "Ash", "kind": "wood", "color": "#e3d5bd", "roughness": 0.6},
    "painted": {"label": "Painted", "kind": "paint", "color": "#e9e4da", "roughness": 0.8},
    "linen": {"label": "Linen", "kind": "fabric", "color": "#d8d0c2", "roughness": 0.95},
    "boucle": {"label": "Bouclé", "kind": "fabric", "color": "#ece6db", "roughness": 1.0},
    "wool": {"label": "Wool", "kind": "fabric", "color": "#b9ae9c", "roughness": 1.0},
    "leather": {"label": "Leather", "kind": "leather", "color": "#8a5a3c", "roughness": 0.5},
    "velvet": {"label": "Velvet", "kind": "fabric", "color": "#6b7c65", "roughness": 0.9},
    "rattan": {"label": "Rattan", "kind": "weave", "color": "#c8a46e", "roughness": 0.8},
    "jute": {"label": "Jute", "kind": "weave", "color": "#bfa47a", "roughness": 1.0},
    "stone": {"label": "Stone", "kind": "stone", "color": "#cfc8bc", "roughness": 0.4},
    "glass": {"label": "Glass", "kind": "glass", "color": "#d9e2e0", "roughness": 0.05},
    "brass": {"label": "Brass", "kind": "metal", "color": "#b08d57", "roughness": 0.35},
    "black_metal": {"label": "Black metal", "kind": "metal", "color": "#2b2a28", "roughness": 0.45},
    "paper": {"label": "Paper", "kind": "paper", "color": "#f1ebdf", "roughness": 0.9},
    "plaster": {"label": "Plaster", "kind": "paint", "color": "#efe9df", "roughness": 0.9},
    "microcement": {"label": "Microcement", "kind": "stone", "color": "#c9c3b8", "roughness": 0.7},
    "terrazzo": {"label": "Terrazzo", "kind": "stone", "color": "#e2ddd3", "roughness": 0.5},
}

FLOOR_MATERIALS = ("oak", "pale_oak", "walnut", "ash", "stone", "microcement", "terrazzo")
WALL_MATERIALS = ("plaster", "painted")


def collision_kind(category: str, variant: str) -> CollisionKind:
    spec = CATALOG[category]
    v = spec.variant(variant)
    return v.collision if v else spec.variants[0].collision


def default_size(category: str, variant: str) -> tuple[float, float, float]:
    spec = CATALOG[category]
    v = spec.variant(variant) or spec.variants[0]
    return v.default


def catalog_payload() -> dict[str, object]:
    return {
        "categories": [
            {
                "id": spec.id,
                "label": spec.label,
                "variants": [
                    {"id": v.id, "label": v.label, "default": list(v.default), "collision": v.collision}
                    for v in spec.variants
                ],
                "min_size": list(spec.min_size),
                "max_size": list(spec.max_size),
                "access_mode": spec.access_mode,
                "access_depth_m": spec.access_depth_m,
                "tuck_m": spec.tuck_m,
                "default_material": spec.default_material,
                "default_color": spec.default_color,
                "materials": list(spec.materials),
            }
            for spec in CATALOG.values()
        ],
        "materials": MATERIALS,
        "floor_materials": list(FLOOR_MATERIALS),
        "wall_materials": list(WALL_MATERIALS),
    }
