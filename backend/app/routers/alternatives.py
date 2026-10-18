from __future__ import annotations

import csv
import io
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..catalog import CATALOG, MATERIALS
from ..db import Alternative, ChangeProposal, Project, Revision, get_db
from ..deps import owned_alternative, owned_project
from ..edits import Operation, apply_operations, diff_scenes
from ..layout import rule_based_scene
from ..scene import Scene
from ..services import (
    alternative_payload,
    commit_revision,
    create_alternative,
    load_inventory,
    load_scene,
    parse_scene,
    project_alternatives,
    require_confirmed,
    validate_for,
)

router = APIRouter(prefix="/api/projects/{project_id}", tags=["alternatives"])


class AlternativeCreate(BaseModel):
    name: str = Field("Manual layout", min_length=1, max_length=80)
    mode: str = Field("empty", pattern="^(empty|rule_based|duplicate)$")
    source_alternative_id: str | None = None
    seed: int = 0


class SceneSave(BaseModel):
    base_revision: int
    scene: dict[str, Any]
    source: str = Field("manual", pattern="^(manual|undo|redo|restore)$")
    summary: str = Field("", max_length=300)


class OpsRequest(BaseModel):
    base_revision: int
    operations: list[Operation] = Field(max_length=40)


class RevisionLabel(BaseModel):
    label: str = Field(max_length=80)


@router.get("/alternatives")
def list_alternatives(project: Project = Depends(owned_project), db: Session = Depends(get_db)) -> list[dict]:
    return [alternative_payload(a) for a in project_alternatives(db, project)]


@router.post("/alternatives", status_code=201)
def create(body: AlternativeCreate, project: Project = Depends(owned_project), db: Session = Depends(get_db)) -> dict:
    geometry = require_confirmed(project)
    if len(project_alternatives(db, project)) >= 24:
        raise HTTPException(status_code=422, detail="Delete an alternative before adding more (limit 24).")
    if body.mode == "duplicate":
        src = next((a for a in project_alternatives(db, project) if a.id == body.source_alternative_id), None)
        if src is None:
            raise HTTPException(status_code=404, detail="Design alternative not found.")
        scene, origin, summary = load_scene(src), "manual", f"Duplicated from {src.name}"
    elif body.mode == "rule_based":
        scene = rule_based_scene(geometry, load_inventory(project), seed=body.seed)
        origin, summary = "sample", "Rule-based layout (not AI)"
    else:
        from ..layout import PALETTES
        from ..scene import Finish, RoomFinish

        pal = PALETTES[0]
        scene = Scene(
            finishes=[
                RoomFinish(
                    room_id=r.id,
                    floor=Finish(material=pal.floor[0], color=pal.floor[1]),
                    walls=Finish(material=pal.walls[0], color=pal.walls[1]),
                )
                for r in geometry.rooms
            ]
        )
        origin, summary = "manual", "Empty layout"
    alt, report = create_alternative(db, project, body.name, origin, scene, summary, "manual")
    db.commit()
    return alternative_payload(alt, report)


@router.get("/alternatives/{alternative_id}")
def get_alternative(alt: Alternative = Depends(owned_alternative), project: Project = Depends(owned_project)) -> dict:
    return alternative_payload(alt, validate_for(project, load_scene(alt)))


@router.patch("/alternatives/{alternative_id}")
def rename(body: RevisionLabel, alt: Alternative = Depends(owned_alternative), db: Session = Depends(get_db)) -> dict:
    if not body.label.strip():
        raise HTTPException(status_code=422, detail="Name cannot be empty.")
    alt.name = body.label.strip()
    db.commit()
    return alternative_payload(alt)


@router.delete("/alternatives/{alternative_id}", status_code=204)
def delete(alt: Alternative = Depends(owned_alternative), db: Session = Depends(get_db)) -> None:
    db.delete(alt)
    db.commit()


@router.put("/alternatives/{alternative_id}/scene")
def save_scene(
    body: SceneSave,
    alt: Alternative = Depends(owned_alternative),
    project: Project = Depends(owned_project),
    db: Session = Depends(get_db),
) -> dict:
    require_confirmed(project)
    scene = parse_scene(body.scene)
    rev, report = commit_revision(
        db, alt, project, scene, base_revision=body.base_revision, source=body.source, summary=body.summary
    )
    _mark_pending_stale(db, alt)
    db.commit()
    return {**alternative_payload(alt, report), "revision_id": rev.id}


@router.post("/alternatives/{alternative_id}/ops")
def apply_ops(
    body: OpsRequest,
    alt: Alternative = Depends(owned_alternative),
    project: Project = Depends(owned_project),
    db: Session = Depends(get_db),
) -> dict:
    """Manual typed edits (same lock rules as AI edits; architects may lock/unlock)."""

    require_confirmed(project)
    before = load_scene(alt)
    result = apply_operations(before, body.operations, allow_lock_changes=True)
    if result.rejected and not result.applied:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "rejected",
                "message": result.rejected[0].reason,
                "rejected": [r.model_dump() for r in result.rejected],
            },
        )
    _, report = commit_revision(
        db, alt, project, result.scene, base_revision=body.base_revision, source="manual", enforce_locks=False
    )
    _mark_pending_stale(db, alt)
    db.commit()
    return {
        **alternative_payload(alt, report),
        "rejected": [r.model_dump() for r in result.rejected],
        "affected_ids": result.affected_ids,
    }


@router.post("/validate")
def validate_any(body: dict[str, Any], project: Project = Depends(owned_project)) -> dict:
    """Validate an unsaved scene (live feedback while dragging)."""

    require_confirmed(project)
    return validate_for(project, parse_scene(body.get("scene", {}))).as_dict()


@router.get("/alternatives/{alternative_id}/revisions")
def revisions(alt: Alternative = Depends(owned_alternative)) -> list[dict]:
    return [
        {
            "id": r.id,
            "number": r.number,
            "label": r.label,
            "source": r.source,
            "summary": r.summary,
            "validation_status": r.validation_status,
            "created_at": r.created_at.isoformat(),
        }
        for r in reversed(alt.revisions)
    ]


@router.get("/alternatives/{alternative_id}/revisions/{number}")
def revision_scene(number: int, alt: Alternative = Depends(owned_alternative)) -> dict:
    rev = next((r for r in alt.revisions if r.number == number), None)
    if rev is None:
        raise HTTPException(status_code=404, detail="Revision not found.")
    return {"number": rev.number, "label": rev.label, "scene": rev.scene, "summary": rev.summary}


@router.put("/alternatives/{alternative_id}/revisions/{number}/label")
def label_revision(
    number: int, body: RevisionLabel, alt: Alternative = Depends(owned_alternative), db: Session = Depends(get_db)
) -> dict:
    rev = next((r for r in alt.revisions if r.number == number), None)
    if rev is None:
        raise HTTPException(status_code=404, detail="Revision not found.")
    rev.label = body.label.strip()
    db.commit()
    return {"number": rev.number, "label": rev.label}


@router.get("/compare")
def compare(a: str, b: str, project: Project = Depends(owned_project), db: Session = Depends(get_db)) -> dict:
    """Compare two snapshots, each 'alternativeId' or 'alternativeId@revision'."""

    def resolve(ref: str) -> tuple[str, Scene]:
        alt_id, _, num = ref.partition("@")
        alt = db.scalar(select(Alternative).where(Alternative.id == alt_id, Alternative.project_id == project.id))
        if alt is None:
            raise HTTPException(status_code=404, detail="Design alternative not found.")
        if not num:
            return f"{alt.name} (r{alt.revision})", load_scene(alt)
        rev = next((r for r in alt.revisions if str(r.number) == num), None)
        if rev is None:
            raise HTTPException(status_code=404, detail="Revision not found.")
        return f"{alt.name} (r{rev.number})", Scene.model_validate(rev.scene)

    la, sa = resolve(a)
    lb, sb = resolve(b)
    return {
        "a": {"label": la, "scene": sa.model_dump(mode="json"), "validation": validate_for(project, sa).as_dict()},
        "b": {"label": lb, "scene": sb.model_dump(mode="json"), "validation": validate_for(project, sb).as_dict()},
        "diff": diff_scenes(sa, sb),
    }


@router.get("/alternatives/{alternative_id}/schedule.csv")
def schedule_csv(alt: Alternative = Depends(owned_alternative), project: Project = Depends(owned_project)) -> Response:
    scene = load_scene(alt)
    inventory = {r.id: r for r in load_inventory(project).items}
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "ID",
            "Item",
            "Model",
            "Room",
            "Status",
            "Width m",
            "Depth m",
            "Height m",
            "Finish",
            "Colour",
            "Locked",
            "Note",
        ]
    )
    for o in sorted(scene.objects, key=lambda o: (o.room_id, o.category, o.id)):
        spec = CATALOG[o.category]
        variant = spec.variant(o.variant)
        req = inventory.get(o.requirement_id or "")
        status = (
            "Existing"
            if o.existing
            else ("Required" if req and req.required else "Optional" if req else "Suggested addition")
        )
        writer.writerow(
            [
                o.id,
                o.label or spec.label,
                variant.label if variant else o.variant,
                o.room_id,
                status,
                f"{o.size.w:.2f}",
                f"{o.size.d:.2f}",
                f"{o.size.h:.2f}",
                str(MATERIALS.get(o.finish.material, {}).get("label", o.finish.material)),
                o.finish.color,
                ", ".join(o.locks),
                "Approximate concept envelope",
            ]
        )
    safe = "".join(c for c in alt.name if c.isalnum() or c in " -_").strip() or "schedule"
    return Response(
        buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{safe} schedule.csv"'},
    )


def _mark_pending_stale(db: Session, alt: Alternative) -> None:
    for p in db.scalars(
        select(ChangeProposal).where(ChangeProposal.alternative_id == alt.id, ChangeProposal.status == "pending")
    ):
        if p.base_revision != alt.revision:
            p.status = "stale"


__all__ = ["router", "Revision"]
