"""Typed scene-edit operations, lock enforcement and scene diffs.

Both manual edits and AI edits go through :func:`apply_operations`, so locks
and preservation of unrelated properties are enforced in one place.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from .catalog import CATALOG, MATERIALS, default_size
from .scene import Finish, Lighting, Point, RoomFinish, Scene, SceneObject, Size

OpName = Literal[
    "move",
    "rotate",
    "resize",
    "set_finish",
    "set_accent",
    "set_lighting",
    "set_room_finish",
    "add",
    "remove",
    "lock",
    "unlock",
]

# Which lockable property each operation changes.
LOCK_FOR_OP: dict[str, str] = {
    "move": "position",
    "rotate": "rotation",
    "resize": "size",
    "set_finish": "material",
    "set_accent": "material",
    "remove": "presence",
}


class Operation(BaseModel):
    """Flat operation record. Only fields relevant to ``op`` are read."""

    model_config = ConfigDict(extra="ignore")

    op: OpName
    target_id: str = ""
    x: float | None = None
    y: float | None = None
    dx: float | None = None
    dy: float | None = None
    rotation_deg: float | None = None
    w: float | None = None
    d: float | None = None
    h: float | None = None
    material: str | None = None
    color: str | None = None
    mood: Literal["daylight", "overcast", "evening", "night"] | None = None
    color_temperature_k: int | None = None
    intensity: float | None = None
    accent_lights: bool | None = None
    surface: Literal["floor", "walls"] | None = None
    category: str | None = None
    variant: str | None = None
    room_id: str | None = None
    requirement_id: str | None = None
    label: str | None = None
    properties: list[str] = Field(default_factory=list)  # for lock / unlock


class Rejected(BaseModel):
    index: int
    op: str
    target_id: str
    reason: str


class ApplyResult(BaseModel):
    scene: Scene
    applied: list[int]
    rejected: list[Rejected]
    affected_ids: list[str]


def _new_id(scene: Scene, category: str) -> str:
    existing = {o.id for o in scene.objects}
    n = 1
    while f"{category.replace('_', '-')}-{n}" in existing:
        n += 1
    return f"{category.replace('_', '-')}-{n}"


def apply_operations(scene: Scene, operations: list[Operation], *, allow_lock_changes: bool = False) -> ApplyResult:
    """Apply operations to a copy of ``scene``.

    An operation that would change a locked property, refers to a missing
    object, or carries invalid values is rejected and reported; it never
    partially applies. Everything not addressed by an applied operation is
    preserved exactly.
    """

    work = scene.model_copy(deep=True)
    applied: list[int] = []
    rejected: list[Rejected] = []
    affected: list[str] = []

    def reject(i: int, op: Operation, reason: str) -> None:
        rejected.append(Rejected(index=i, op=op.op, target_id=op.target_id, reason=reason))

    for i, op in enumerate(operations):
        try:
            if op.op == "set_lighting":
                data = work.lighting.model_dump()
                for key in ("mood", "color_temperature_k", "intensity", "accent_lights"):
                    value = getattr(op, key)
                    if value is not None:
                        data[key] = value
                work.lighting = Lighting.model_validate(data)
                applied.append(i)
                continue
            if op.op == "set_room_finish":
                room_id = op.room_id or op.target_id
                if not op.surface or not op.material:
                    reject(i, op, "surface and material are required")
                    continue
                if op.material not in MATERIALS:
                    reject(i, op, f"unknown material '{op.material}'")
                    continue
                current = next((f for f in work.finishes if f.room_id == room_id), None)
                if current is None:
                    reject(i, op, f"no finishes for room '{room_id}'")
                    continue
                old = getattr(current, op.surface)
                setattr(current, op.surface, Finish(material=op.material, color=op.color or old.color))
                RoomFinish.model_validate(current.model_dump())
                applied.append(i)
                continue
            if op.op == "add":
                obj = _build_added(work, op)
                work.objects.append(obj)
                applied.append(i)
                affected.append(obj.id)
                continue

            target = work.object_by_id(op.target_id)
            if target is None:
                reject(i, op, "object not found")
                continue
            if op.op in ("lock", "unlock"):
                if not allow_lock_changes:
                    reject(i, op, "locks can only be changed by the architect")
                    continue
                props: set[str] = set(target.locks)
                wanted = set(op.properties or ["position", "rotation", "size", "material", "presence"])
                props = props | wanted if op.op == "lock" else props - wanted
                checked = SceneObject.model_validate({**target.model_dump(), "locks": sorted(props)})
                target.locks = checked.locks
                applied.append(i)
                affected.append(target.id)
                continue
            needed = LOCK_FOR_OP.get(op.op)
            if needed and needed in target.locks:
                reject(i, op, f"{needed} is locked")
                continue
            if op.op == "remove":
                if target.existing:
                    reject(i, op, "existing furniture must be retained")
                    continue
                work.objects = [o for o in work.objects if o.id != target.id]
                applied.append(i)
                affected.append(target.id)
                continue
            updated = target.model_dump()
            if op.op == "move":
                if op.x is not None and op.y is not None:
                    updated["position"] = {"x": op.x, "y": op.y}
                elif op.dx is not None or op.dy is not None:
                    updated["position"] = {"x": target.position.x + (op.dx or 0), "y": target.position.y + (op.dy or 0)}
                else:
                    reject(i, op, "move needs x and y or dx/dy")
                    continue
            elif op.op == "rotate":
                if op.rotation_deg is None:
                    reject(i, op, "rotate needs rotation_deg")
                    continue
                updated["rotation_deg"] = op.rotation_deg
            elif op.op == "resize":
                size = target.size.model_dump()
                for key in ("w", "d", "h"):
                    value = getattr(op, key)
                    if value is not None:
                        size[key] = value
                updated["size"] = size
            elif op.op in ("set_finish", "set_accent"):
                if op.material is not None and op.material not in MATERIALS:
                    reject(i, op, f"unknown material '{op.material}'")
                    continue
                key = "finish" if op.op == "set_finish" else "accent"
                base = getattr(target, key) or target.finish
                updated[key] = {"material": op.material or base.material, "color": op.color or base.color}
            new_obj = SceneObject.model_validate(updated)
            work.objects = [new_obj if o.id == target.id else o for o in work.objects]
            applied.append(i)
            affected.append(target.id)
        except (ValueError, TypeError) as exc:
            reject(i, op, _short_error(exc))
    return ApplyResult(scene=work, applied=applied, rejected=rejected, affected_ids=sorted(set(affected)))


def _build_added(scene: Scene, op: Operation) -> SceneObject:
    if not op.category or op.category not in CATALOG:
        raise ValueError("add needs a supported category")
    spec = CATALOG[op.category]
    variant = op.variant if op.variant and spec.variant(op.variant) else spec.variants[0].id
    if op.x is None or op.y is None or not op.room_id:
        raise ValueError("add needs room_id, x and y")
    w0, d0, h0 = default_size(op.category, variant)
    return SceneObject(
        id=_new_id(scene, op.category),
        category=op.category,
        variant=variant,
        room_id=op.room_id,
        requirement_id=op.requirement_id or None,
        label=op.label or "",
        position=Point(x=op.x, y=op.y),
        rotation_deg=op.rotation_deg or 0.0,
        size=Size(w=op.w or w0, d=op.d or d0, h=op.h or h0),
        finish=Finish(material=op.material or spec.default_material, color=op.color or spec.default_color),
    )


def _short_error(exc: Exception) -> str:
    text = str(exc).splitlines()
    return text[0][:160] if text else type(exc).__name__


# ------------------------------------------------------------------ locks on full-scene saves


def lock_violations(before: Scene, after: Scene) -> list[str]:
    """Properties locked in both versions must not change; locked objects must remain."""

    problems: list[str] = []
    after_by_id = {o.id: o for o in after.objects}
    for old in before.objects:
        new = after_by_id.get(old.id)
        if new is None:
            if "presence" in old.locks:
                problems.append(f"'{old.id}' is locked and cannot be removed")
            continue
        both = set(old.locks) & set(new.locks)
        if "position" in both and old.position != new.position:
            problems.append(f"'{old.id}' position is locked")
        if "rotation" in both and old.rotation_deg != new.rotation_deg:
            problems.append(f"'{old.id}' rotation is locked")
        if "size" in both and old.size != new.size:
            problems.append(f"'{old.id}' size is locked")
        if "material" in both and (old.finish != new.finish or old.accent != new.accent):
            problems.append(f"'{old.id}' material is locked")
    return problems


def restore_locked(base: Scene, proposal: Scene) -> tuple[Scene, list[str]]:
    """Force locked properties from ``base`` onto an AI proposal; report each restoration."""

    notes: list[str] = []
    result = proposal.model_copy(deep=True)
    by_id = {o.id: o for o in result.objects}
    for old in base.objects:
        if not old.locks:
            continue
        new = by_id.get(old.id)
        if new is None:
            if "presence" in old.locks:
                result.objects.append(old.model_copy(deep=True))
                notes.append(f"Kept locked '{old.id}', which the proposal removed.")
            continue
        changed = False
        if "position" in old.locks and new.position != old.position:
            new.position, changed = old.position, True
        if "rotation" in old.locks and new.rotation_deg != old.rotation_deg:
            new.rotation_deg, changed = old.rotation_deg, True
        if "size" in old.locks and new.size != old.size:
            new.size, changed = old.size, True
        if "material" in old.locks and (new.finish != old.finish or new.accent != old.accent):
            new.finish, new.accent, changed = old.finish, old.accent, True
        if new.locks != old.locks:
            new.locks, changed = list(old.locks), True
        if changed:
            notes.append(f"Restored locked properties of '{old.id}'.")
    return result, notes


# ------------------------------------------------------------------ diffs


def diff_scenes(before: Scene, after: Scene) -> dict[str, Any]:
    b = {o.id: o for o in before.objects}
    a = {o.id: o for o in after.objects}
    changed: dict[str, list[str]] = {}
    for oid in b.keys() & a.keys():
        props = []
        ob, oa = b[oid], a[oid]
        if ob.position != oa.position:
            props.append("position")
        if ob.rotation_deg != oa.rotation_deg:
            props.append("rotation")
        if ob.size != oa.size:
            props.append("size")
        if ob.finish != oa.finish or ob.accent != oa.accent:
            props.append("material")
        if ob.locks != oa.locks:
            props.append("locks")
        if (ob.variant, ob.label, ob.room_id, ob.requirement_id, ob.elevation_m) != (
            oa.variant,
            oa.label,
            oa.room_id,
            oa.requirement_id,
            oa.elevation_m,
        ):
            props.append("other")
        if props:
            changed[oid] = props
    finishes = sorted(
        {f.room_id for f in after.finishes} ^ {f.room_id for f in before.finishes}
        | {f.room_id for f in after.finishes if next((g for g in before.finishes if g.room_id == f.room_id), None) != f}
    )
    return {
        "added": sorted(a.keys() - b.keys()),
        "removed": sorted(b.keys() - a.keys()),
        "changed": changed,
        "lighting_changed": before.lighting != after.lighting,
        "finishes_changed": finishes,
    }


def summarize_diff(diff: dict[str, Any]) -> str:
    parts = []
    if diff["added"]:
        parts.append(f"added {', '.join(diff['added'])}")
    if diff["removed"]:
        parts.append(f"removed {', '.join(diff['removed'])}")
    for oid, props in diff["changed"].items():
        parts.append(f"{oid}: {', '.join(props)}")
    if diff["lighting_changed"]:
        parts.append("lighting")
    if diff["finishes_changed"]:
        parts.append(f"finishes in {', '.join(diff['finishes_changed'])}")
    return "; ".join(parts)[:300] or "no changes"
