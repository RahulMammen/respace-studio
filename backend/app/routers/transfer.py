"""Versioned project JSON export/import."""

from __future__ import annotations

import base64
import binascii
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import Alternative, Asset, Project, Revision, User, get_db, new_id
from ..deps import current_user, owned_project
from ..scene import SCHEMA_VERSION, Brief, Geometry, Inventory, Scene
from ..services import project_alternatives, validate_for
from .projects import _sanitise_image, project_detail

router = APIRouter(prefix="/api", tags=["transfer"])
FORMAT = "respace-project"
FORMAT_VERSION = 1
MAX_IMPORT_BYTES = 30 * 1024 * 1024


@router.get("/projects/{project_id}/export")
def export_project(
    include_plan: bool = True, project: Project = Depends(owned_project), db: Session = Depends(get_db)
) -> JSONResponse:
    settings = get_settings()
    plans = []
    if include_plan:
        for a in project.assets:
            path = settings.upload_dir / a.filename
            if a.kind == "plan" and path.is_file():
                plans.append(
                    {
                        "id": a.id,
                        "original_name": a.original_name,
                        "mime_type": a.mime_type,
                        "source": a.source,
                        "data_base64": base64.b64encode(path.read_bytes()).decode(),
                    }
                )
    doc = {
        "format": FORMAT,
        "format_version": FORMAT_VERSION,
        "schema_version": SCHEMA_VERSION,
        "exported_at": datetime.now(UTC).isoformat(),
        "project": {
            "name": project.name,
            "geometry": project.geometry,
            "inventory": project.inventory,
            "brief": {**(project.brief or {}), "reference_asset_ids": []},
        },
        "plans": plans,
        "alternatives": [
            {
                "name": a.name,
                "origin": a.origin,
                "scene": a.scene,
                "revisions": [
                    {"number": r.number, "label": r.label, "source": r.source, "summary": r.summary}
                    for r in a.revisions
                    if r.label
                ],
            }
            for a in project_alternatives(db, project)
        ],
    }
    safe = "".join(c for c in project.name if c.isalnum() or c in " -_").strip() or "project"
    return JSONResponse(doc, headers={"Content-Disposition": f'attachment; filename="{safe}.respace.json"'})


class ImportBody(BaseModel):
    document: dict[str, Any]
    name: str | None = Field(None, max_length=120)


@router.post("/projects/import", status_code=201)
def import_project(body: ImportBody, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    doc = body.document
    if doc.get("format") != FORMAT:
        raise HTTPException(status_code=422, detail="This is not a ReSpace project file.")
    if not isinstance(doc.get("format_version"), int) or doc["format_version"] > FORMAT_VERSION:
        raise HTTPException(status_code=422, detail="This project file was made by a newer version.")
    src = doc.get("project") or {}
    try:
        geometry = Geometry.model_validate(src.get("geometry") or {})
        inventory = Inventory.model_validate(src.get("inventory") or {})
        brief = Brief.model_validate({**(src.get("brief") or {}), "reference_asset_ids": []})
        scenes = [
            (a.get("name", "Imported"), Scene.model_validate(a.get("scene") or {})) for a in doc.get("alternatives", [])
        ][:24]
    except ValidationError as exc:
        raise HTTPException(
            status_code=422, detail=[{"loc": list(e["loc"]), "msg": e["msg"]} for e in exc.errors()[:10]]
        ) from None
    project = Project(
        owner_id=user.id,
        name=(body.name or src.get("name") or "Imported project")[:120],
        inventory=inventory.model_dump(mode="json"),
        brief=brief.model_dump(mode="json"),
        geometry={},
    )
    db.add(project)
    db.flush()
    settings = get_settings()
    id_map: dict[str, str] = {}
    for plan in (doc.get("plans") or [])[:5]:
        try:
            raw = base64.b64decode(plan.get("data_base64", ""), validate=True)
        except (binascii.Error, ValueError):
            raise HTTPException(status_code=422, detail="Embedded plan image is corrupt.") from None
        if len(raw) > settings.max_upload_bytes:
            raise HTTPException(status_code=413, detail="Embedded plan image is too large.")
        clean, mime, w, h = _sanitise_image(raw)
        settings.upload_dir.mkdir(parents=True, exist_ok=True)
        storage = f"{new_id()}{'.png' if mime == 'image/png' else '.jpg'}"
        (settings.upload_dir / storage).write_bytes(clean)
        asset = Asset(
            project_id=project.id,
            kind="plan",
            filename=storage,
            original_name=str(plan.get("original_name", "plan"))[:200],
            mime_type=mime,
            width_px=w,
            height_px=h,
            source=str(plan.get("source", ""))[:80],
            size_bytes=len(clean),
        )
        db.add(asset)
        db.flush()
        id_map[str(plan.get("id"))] = asset.id
    if geometry.plan_asset_id:
        geometry.plan_asset_id = id_map.get(geometry.plan_asset_id)
        if geometry.plan_asset_id is None:
            geometry.calibration = None
    project.geometry = geometry.model_dump(mode="json")
    for name, scene in scenes:
        report = validate_for(project, scene)
        alt = Alternative(
            project_id=project.id,
            name=str(name)[:80],
            origin="import",
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
                source="import",
                summary="Imported",
                scene=alt.scene,
                validation_status=report.status,
            )
        )
    db.commit()
    db.refresh(project)
    return project_detail(db, project)
