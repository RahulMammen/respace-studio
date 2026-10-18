"""Shared persistence helpers for projects, alternatives and revisions."""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import Alternative, Project, Revision
from .edits import diff_scenes, lock_violations, summarize_diff
from .geometry.validate import ValidationReport, validate_scene
from .scene import Brief, Geometry, Inventory, Scene


def load_geometry(project: Project) -> Geometry:
    return Geometry.model_validate(project.geometry or {})


def load_inventory(project: Project) -> Inventory:
    return Inventory.model_validate(project.inventory or {})


def load_brief(project: Project) -> Brief:
    return Brief.model_validate(project.brief or {})


def load_scene(alt: Alternative) -> Scene:
    return Scene.model_validate(alt.scene or {})


def parse_scene(data: Any) -> Scene:
    try:
        return Scene.model_validate(data)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=_pydantic_messages(exc)) from None


def _pydantic_messages(exc: ValidationError) -> list[dict[str, Any]]:
    return [{"loc": list(e["loc"]), "msg": e["msg"]} for e in exc.errors()[:20]]


def require_confirmed(project: Project) -> Geometry:
    geometry = load_geometry(project)
    if not geometry.confirmed or not geometry.rooms:
        raise HTTPException(status_code=409, detail="Confirm the room geometry first.")
    return geometry


def validate_for(project: Project, scene: Scene) -> ValidationReport:
    return validate_scene(load_geometry(project), load_inventory(project), scene)


def create_alternative(
    db: Session, project: Project, name: str, origin: str, scene: Scene, summary: str, source: str
) -> tuple[Alternative, ValidationReport]:
    report = validate_for(project, scene)
    alt = Alternative(
        project_id=project.id,
        name=name[:80],
        origin=origin,
        revision=1,
        scene=scene.model_dump(mode="json"),
        validation_status=report.status,
    )
    db.add(alt)
    db.flush()
    db.add(
        Revision(
            alternative_id=alt.id,
            number=1,
            source=source,
            summary=summary[:300],
            scene=alt.scene,
            validation_status=report.status,
        )
    )
    return alt, report


def commit_revision(
    db: Session,
    alt: Alternative,
    project: Project,
    new_scene: Scene,
    *,
    base_revision: int,
    source: str,
    summary: str = "",
    enforce_locks: bool = True,
    require_valid: bool = False,
) -> tuple[Revision, ValidationReport]:
    """Store ``new_scene`` as the next revision if ``base_revision`` is current.

    Rejects stale writes (HTTP 409) so an older AI response or a second tab can
    never overwrite newer edits.
    """

    if base_revision != alt.revision:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "stale_revision",
                "message": "The design changed since this edit started. Review the latest version and try again.",
                "current_revision": alt.revision,
            },
        )
    old_scene = load_scene(alt)
    if enforce_locks:
        problems = lock_violations(old_scene, new_scene)
        if problems:
            raise HTTPException(status_code=409, detail={"code": "locked", "message": "; ".join(problems)})
    report = validate_for(project, new_scene)
    if require_valid and report.errors:
        raise HTTPException(
            status_code=422,
            detail={"code": "invalid_scene", "message": "The result fails validation.", "report": report.as_dict()},
        )
    alt.revision += 1
    alt.scene = new_scene.model_dump(mode="json")
    alt.validation_status = report.status
    rev = Revision(
        alternative_id=alt.id,
        number=alt.revision,
        source=source,
        summary=(summary or summarize_diff(diff_scenes(old_scene, new_scene)))[:300],
        scene=alt.scene,
        validation_status=report.status,
    )
    db.add(rev)
    return rev, report


def alternative_payload(alt: Alternative, report: ValidationReport | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": alt.id,
        "name": alt.name,
        "origin": alt.origin,
        "revision": alt.revision,
        "scene": alt.scene,
        "validation_status": alt.validation_status,
        "updated_at": alt.updated_at.isoformat() if alt.updated_at else None,
    }
    if report is not None:
        payload["validation"] = report.as_dict()
    return payload


def project_alternatives(db: Session, project: Project) -> list[Alternative]:
    return list(
        db.scalars(select(Alternative).where(Alternative.project_id == project.id).order_by(Alternative.created_at))
    )
