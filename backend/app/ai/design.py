"""AI design generation and conversational editing with validation and bounded repair."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel, ValidationError

from ..catalog import CATALOG
from ..config import get_settings
from ..edits import Operation, apply_operations, diff_scenes, restore_locked
from ..geometry.validate import ValidationReport, validate_scene
from ..scene import (
    Brief,
    Finish,
    Geometry,
    Inventory,
    Lighting,
    Point,
    RoomFinish,
    Scene,
    SceneObject,
    Size,
)
from .context import (
    SYSTEM_BASE,
    brief_block,
    catalog_context,
    dumps,
    geometry_context,
    inventory_context,
    scene_context,
)
from .provider import AIInvalidOutput, DesignModelProvider, ImagePart, StructuredRequest, inline_json_schema
from .schemas import AIEditPlan, AIProposal, AIProposalSet

log = logging.getLogger("respace.ai")
MAX_ISSUES_IN_REPAIR = 12


@dataclass
class ProposalResult:
    name: str
    concept: str
    scene: Scene
    report: ValidationReport
    repair_rounds: int
    notes: list[str] = field(default_factory=list)
    conversion_errors: list[str] = field(default_factory=list)


@dataclass
class GenerationResult:
    proposals: list[ProposalResult]
    conflicts: list[str]
    model: str
    calls: int


# ------------------------------------------------------------------ conversion


def _clean_id(raw: str, fallback: str, taken: set[str]) -> str:
    base = "".join(c if c.isalnum() or c in "-_" else "-" for c in raw.lower()).strip("-_")[:40] or fallback
    if not base[0].isalnum():
        base = f"o{base}"
    candidate, n = base, 2
    while candidate in taken:
        candidate, n = f"{base}-{n}", n + 1
    taken.add(candidate)
    return candidate


def _hex(color: str, fallback: str) -> str:
    c = color.strip()
    if len(c) == 7 and c.startswith("#") and all(ch in "0123456789abcdefABCDEF" for ch in c[1:]):
        return c.lower()
    return fallback


def proposal_to_scene(p: AIProposal, geometry: Geometry) -> tuple[Scene, list[str]]:
    """Convert model output to a Scene. Unparseable objects are reported, not guessed."""

    errors: list[str] = []
    taken: set[str] = set()
    objects: list[SceneObject] = []
    room_ids = {r.id for r in geometry.rooms}
    default_room = geometry.rooms[0].id
    for i, o in enumerate(p.objects):
        spec = CATALOG.get(o.category)
        if spec is None:
            errors.append(f"object {i}: unknown category")
            continue
        try:
            objects.append(
                SceneObject(
                    id=_clean_id(o.id, f"{o.category}-{i + 1}", taken),
                    category=o.category,
                    variant=o.variant,
                    room_id=o.room_id if o.room_id in room_ids else default_room,
                    requirement_id=o.requirement_id or None,
                    label=o.label[:60],
                    position=Point(x=o.x, y=o.y),
                    rotation_deg=o.rotation_deg,
                    size=Size(w=o.w, d=o.d, h=o.h),
                    finish=Finish(material=o.material, color=_hex(o.color, spec.default_color)),
                    elevation_m=max(0.0, o.elevation_m),
                )
            )
        except (ValidationError, ValueError) as exc:
            errors.append(f"object '{o.id}': {str(exc).splitlines()[0][:120]}")
    finishes = []
    for f in p.finishes:
        if f.room_id not in room_ids:
            continue
        try:
            finishes.append(
                RoomFinish(
                    room_id=f.room_id,
                    floor=Finish(material=f.floor_material, color=_hex(f.floor_color, "#c9a27a")),
                    walls=Finish(material=f.wall_material, color=_hex(f.wall_color, "#efe9df")),
                )
            )
        except (ValidationError, ValueError) as exc:
            errors.append(f"finish '{f.room_id}': {str(exc).splitlines()[0][:120]}")
    have = {f.room_id for f in finishes}
    for rid in room_ids - have:
        finishes.append(
            RoomFinish(
                room_id=rid,
                floor=Finish(material="oak", color="#c9a27a"),
                walls=Finish(material="plaster", color="#efe9df"),
            )
        )
    try:
        lighting = Lighting(
            mood=p.lighting.mood,
            color_temperature_k=min(6500, max(1800, p.lighting.color_temperature_k)),
            intensity=min(2.0, max(0.1, p.lighting.intensity)),
            accent_lights=p.lighting.accent_lights,
        )
    except (ValidationError, ValueError):
        lighting = Lighting()
        errors.append("lighting values were invalid; defaults used")
    scene = Scene(
        objects=objects,
        finishes=finishes,
        lighting=lighting,
        rationale=p.rationale[:1500],
        tradeoffs=[t[:200] for t in p.tradeoffs[:10]],
        unresolved=[u[:200] for u in p.unresolved[:10]],
    )
    return scene, errors


def _issue_lines(report: ValidationReport, conversion_errors: list[str]) -> list[str]:
    lines = [f"- [{i.code}] {i.message}" for i in report.errors][:MAX_ISSUES_IN_REPAIR]
    lines += [f"- [conversion] {e}" for e in conversion_errors[:4]]
    return lines


# ------------------------------------------------------------------ generation


async def generate_proposals(
    provider: DesignModelProvider,
    geometry: Geometry,
    inventory: Inventory,
    brief: Brief,
    *,
    base_scene: Scene | None = None,
    count: int = 3,
    request_text: str = "",
    reference_images: list[ImagePart] | None = None,
) -> GenerationResult:
    settings = get_settings()
    categories = {i.category for i in inventory.items} | {"rug", "lamp", "wall_art"}
    if base_scene:
        categories |= {o.category for o in base_scene.objects}
    context = {
        "rooms": geometry_context(geometry),
        "inventory": inventory_context(inventory),
        "catalog": catalog_context(categories),
    }
    if base_scene is not None:
        context["current_scene"] = scene_context(base_scene)
    distinct = (
        f"Produce {count} clearly distinct proposals (different arrangement strategy, not just colours)."
        if count > 1
        else "Produce exactly 1 proposal."
    )
    text = "\n".join(
        [
            "Task: propose furnished layouts for the confirmed rooms.",
            distinct,
            "Every required inventory item must appear exactly `count` times with its requirement_id.",
            "Optional items may be omitted. Extra decorative items (rug, lamp, wall_art) are allowed only with "
            "requirement_id '' and should be few.",
            "Keep doors' swing areas and a clear zone in front of each door free. Keep a continuous walkway of "
            "walkway_clearance_m from the entrance door to the usable side of every seat, table, bed, desk and "
            "storage front.",
            "If locked objects exist in current_scene, copy them with identical locked properties.",
            "Context JSON:",
            dumps(context),
            brief_block(brief),
            f"<request>\n{request_text}\n</request>" if request_text else "",
        ]
    )
    schema = inline_json_schema(AIProposalSet.model_json_schema())
    calls = 0
    response = await provider.generate_structured(
        StructuredRequest(
            task="generate",
            system=SYSTEM_BASE,
            text=text,
            schema=schema,
            images=reference_images or [],
            max_output_tokens=16000,
            temperature=0.9,
        )
    )
    calls += 1
    parsed = _parse(AIProposalSet, response.text)
    conflicts = [c[:300] for c in parsed.conflicts[:8]]
    results: list[ProposalResult] = []
    for p in parsed.proposals[:count]:
        scene, conv = proposal_to_scene(p, geometry)
        notes: list[str] = []
        if base_scene is not None:
            scene, notes = restore_locked(base_scene, scene)
        report = validate_scene(geometry, inventory, scene)
        results.append(ProposalResult(p.name[:80] or "Proposal", p.concept[:300], scene, report, 0, notes, conv))

    # Bounded repair: one batched call per round for all failing proposals.
    for round_no in range(1, settings.ai_max_repair_rounds + 1):
        failing = [r for r in results if r.report.errors or r.conversion_errors]
        if not failing:
            break
        payload = []
        for idx, r in enumerate(failing):
            payload.append(
                f"Proposal {idx + 1} '{r.name}':\n{dumps(scene_context(r.scene))}\nProblems:\n"
                + "\n".join(_issue_lines(r.report, r.conversion_errors))
            )
        repair_text = "\n".join(
            [
                f"Task: repair {len(failing)} proposal(s) so they pass the listed checks.",
                "Return them in the same order,",
                "keeping each concept, ids and any locked properties. Move or resize only what is needed.",
                "Context JSON:",
                dumps({"rooms": context["rooms"], "inventory": context["inventory"], "catalog": context["catalog"]}),
                "\n\n".join(payload),
            ]
        )
        try:
            response = await provider.generate_structured(
                StructuredRequest(
                    task="repair",
                    system=SYSTEM_BASE,
                    text=repair_text,
                    schema=schema,
                    max_output_tokens=16000,
                    temperature=0.3,
                )
            )
            calls += 1
            repaired = _parse(AIProposalSet, response.text).proposals
        except AIInvalidOutput:
            break
        for r, p in zip(failing, repaired, strict=False):
            scene, conv = proposal_to_scene(p, geometry)
            notes = list(r.notes)
            if base_scene is not None:
                scene, more = restore_locked(base_scene, scene)
                notes += more
            report = validate_scene(geometry, inventory, scene)
            # Keep the repaired version only if it is not worse.
            if len(report.errors) <= len(r.report.errors):
                r.scene, r.report, r.conversion_errors, r.notes = scene, report, conv, notes
            r.repair_rounds = round_no
    return GenerationResult(results, conflicts, response.model, calls)


def _parse(model: type[BaseModel], text: str) -> Any:
    try:
        return model.model_validate_json(text)
    except ValidationError as exc:
        raise AIInvalidOutput(f"{exc.error_count()} schema errors") from None


# ------------------------------------------------------------------ conversational edits


@dataclass
class EditResult:
    intent: str
    reply: str
    conflicts: list[str]
    scene: Scene | None
    report: ValidationReport | None
    operations: list[dict[str, Any]]
    rejected: list[dict[str, Any]]
    affected_ids: list[str]
    diff: dict[str, Any] | None
    repair_rounds: int
    calls: int
    model: str


async def plan_edit(
    provider: DesignModelProvider,
    geometry: Geometry,
    inventory: Inventory,
    brief: Brief,
    scene: Scene,
    message: str,
    *,
    selected_ids: list[str],
    history: list[tuple[str, str]],
    summary: str,
) -> EditResult:
    settings = get_settings()
    before_report = validate_scene(geometry, inventory, scene, include_derived=False)
    before_codes = {(i.code, tuple(i.object_ids)) for i in before_report.errors}
    context = {
        "rooms": geometry_context(geometry),
        "inventory": inventory_context(inventory),
        "catalog": catalog_context({o.category for o in scene.objects} | {i.category for i in inventory.items}),
        "scene": scene_context(scene),
        "selected_ids": selected_ids,
    }
    convo = "\n".join(f"{role}: {text[:400]}" for role, text in history[-6:])
    text = "\n".join(
        [
            "Task: turn the architect's request into typed edit operations on the current scene.",
            "Change only what the request asks for; every other property must stay as it is.",
            "Never change locked properties; list such requests in conflicts instead.",
            "Walls, doors and windows cannot be changed with operations. If asked, set intent geometry_change.",
            "If the architect asks for a different arrangement of the same furniture, set intent rearrange and "
            "return no operations.",
            "'Selected' objects are what the architect is pointing at when they say 'this'.",
            "Use set_room_finish with surface floor|walls for flooring/wall finishes, set_lighting for mood.",
            "Context JSON:",
            dumps(context),
            brief_block(brief),
            f"Earlier decisions: {summary[:600]}" if summary else "",
            f"Recent conversation:\n{convo}" if convo else "",
            f"<request>\n{message}\n</request>",
        ]
    )
    schema = inline_json_schema(AIEditPlan.model_json_schema())
    response = await provider.generate_structured(
        StructuredRequest(
            task="edit", system=SYSTEM_BASE, text=text, schema=schema, max_output_tokens=4000, temperature=0.3
        )
    )
    calls = 1
    plan = _parse(AIEditPlan, response.text)
    if plan.intent in ("question", "geometry_change") or (plan.intent == "rearrange" and not plan.operations):
        return EditResult(
            plan.intent, plan.reply[:1200], plan.conflicts[:8], None, None, [], [], [], None, 0, calls, response.model
        )

    ops = [Operation.model_validate(o.model_dump(exclude_none=True)) for o in plan.operations[:40]]
    result = apply_operations(scene, ops)
    report = validate_scene(geometry, inventory, result.scene)
    rounds = 0
    new_errors = [i for i in report.errors if (i.code, tuple(i.object_ids)) not in before_codes]
    while new_errors and rounds < settings.ai_max_repair_rounds:
        rounds += 1
        repair = "\n".join(
            [
                "Task: your operations produced a scene with new problems. Return corrected operations for the",
                "original request, starting again from the original scene. Keep everything else unchanged.",
                "Problems:",
                *[f"- [{i.code}] {i.message}" for i in new_errors[:MAX_ISSUES_IN_REPAIR]],
                "Previous operations:",
                dumps([o.model_dump(exclude_none=True) for o in plan.operations[:40]]),
                text,
            ]
        )
        try:
            response = await provider.generate_structured(
                StructuredRequest(
                    task="edit_repair",
                    system=SYSTEM_BASE,
                    text=repair,
                    schema=schema,
                    max_output_tokens=4000,
                    temperature=0.2,
                )
            )
            calls += 1
            plan = _parse(AIEditPlan, response.text)
        except AIInvalidOutput:
            break
        ops = [Operation.model_validate(o.model_dump(exclude_none=True)) for o in plan.operations[:40]]
        result = apply_operations(scene, ops)
        report = validate_scene(geometry, inventory, result.scene)
        new_errors = [i for i in report.errors if (i.code, tuple(i.object_ids)) not in before_codes]
    return EditResult(
        intent=plan.intent,
        reply=plan.reply[:1200],
        conflicts=plan.conflicts[:8],
        scene=result.scene,
        report=report,
        operations=[o.model_dump(exclude_none=True) for o in ops],
        rejected=[r.model_dump() for r in result.rejected],
        affected_ids=result.affected_ids,
        diff=diff_scenes(scene, result.scene),
        repair_rounds=rounds,
        calls=calls,
        model=response.model,
    )
