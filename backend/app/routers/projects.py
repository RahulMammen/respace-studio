from __future__ import annotations

import io
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import Asset, Project, User, get_db, new_id
from ..deps import current_user, owned_project
from ..geometry.validate import validate_geometry
from ..scene import Brief, Geometry, Inventory
from ..services import project_alternatives

router = APIRouter(prefix="/api/projects", tags=["projects"])

ALLOWED_FORMATS = {"PNG": "image/png", "JPEG": "image/jpeg"}


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class ProjectRename(BaseModel):
    name: str = Field(min_length=1, max_length=120)


def project_summary(p: Project) -> dict[str, Any]:
    geometry = p.geometry or {}
    return {
        "id": p.id,
        "name": p.name,
        "is_sample": p.is_sample,
        "rooms": len(geometry.get("rooms", [])),
        "confirmed": bool(geometry.get("confirmed")),
        "alternatives": len(p.alternatives),
        "created_at": p.created_at.isoformat(),
        "updated_at": p.updated_at.isoformat(),
    }


def project_detail(db: Session, p: Project) -> dict[str, Any]:
    return {
        **project_summary(p),
        "geometry": Geometry.model_validate(p.geometry or {}).model_dump(mode="json"),
        "inventory": Inventory.model_validate(p.inventory or {}).model_dump(mode="json"),
        "brief": Brief.model_validate(p.brief or {}).model_dump(mode="json"),
        "assets": [asset_payload(a) for a in p.assets],
        "alternatives": [
            {
                "id": a.id,
                "name": a.name,
                "origin": a.origin,
                "revision": a.revision,
                "validation_status": a.validation_status,
            }
            for a in project_alternatives(db, p)
        ],
    }


def asset_payload(a: Asset) -> dict[str, Any]:
    return {
        "id": a.id,
        "kind": a.kind,
        "original_name": a.original_name,
        "mime_type": a.mime_type,
        "width_px": a.width_px,
        "height_px": a.height_px,
        "source": a.source,
        "url": f"/api/projects/{a.project_id}/assets/{a.id}/file",
    }


@router.get("")
def list_projects(user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    rows = db.scalars(select(Project).where(Project.owner_id == user.id).order_by(Project.updated_at.desc()))
    return [project_summary(p) for p in rows]


@router.post("", status_code=201)
def create_project(body: ProjectCreate, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    project = Project(
        owner_id=user.id,
        name=body.name.strip(),
        geometry=Geometry().model_dump(mode="json"),
        inventory=Inventory().model_dump(mode="json"),
        brief=Brief().model_dump(mode="json"),
    )
    db.add(project)
    db.commit()
    return project_detail(db, project)


@router.get("/{project_id}")
def get_project(project: Project = Depends(owned_project), db: Session = Depends(get_db)) -> dict[str, Any]:
    return project_detail(db, project)


@router.patch("/{project_id}")
def rename_project(body: ProjectRename, project: Project = Depends(owned_project), db: Session = Depends(get_db)):
    project.name = body.name.strip()
    db.commit()
    return project_summary(project)


@router.delete("/{project_id}", status_code=204)
def delete_project(project: Project = Depends(owned_project), db: Session = Depends(get_db)) -> None:
    files = [get_settings().upload_dir / a.filename for a in project.assets]
    db.delete(project)
    db.commit()
    for f in files:
        f.unlink(missing_ok=True)


# ------------------------------------------------------------------ geometry


class GeometrySave(BaseModel):
    geometry: dict[str, Any]
    confirm: bool = False


@router.put("/{project_id}/geometry")
def save_geometry(body: GeometrySave, project: Project = Depends(owned_project), db: Session = Depends(get_db)):
    try:
        geometry = Geometry.model_validate(body.geometry)
    except ValidationError as exc:
        raise HTTPException(
            status_code=422, detail=[{"loc": list(e["loc"]), "msg": e["msg"]} for e in exc.errors()[:20]]
        ) from None
    if geometry.plan_asset_id and not any(a.id == geometry.plan_asset_id for a in project.assets):
        raise HTTPException(status_code=422, detail="Plan image does not belong to this project.")
    issues = validate_geometry(geometry)
    errors = [i for i in issues if i.severity == "error"]
    if body.confirm and errors:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "invalid_geometry",
                "message": "Fix the highlighted geometry before confirming.",
                "issues": [i.as_dict() for i in issues],
            },
        )
    # Any edit un-confirms the geometry until the architect confirms again.
    geometry.confirmed = bool(body.confirm)
    project.geometry = geometry.model_dump(mode="json")
    db.commit()
    return {"geometry": project.geometry, "issues": [i.as_dict() for i in issues]}


@router.put("/{project_id}/inventory")
def save_inventory(body: dict[str, Any], project: Project = Depends(owned_project), db: Session = Depends(get_db)):
    try:
        inventory = Inventory.model_validate(body)
    except ValidationError as exc:
        raise HTTPException(
            status_code=422, detail=[{"loc": list(e["loc"]), "msg": e["msg"]} for e in exc.errors()[:20]]
        ) from None
    ids = [i.id for i in inventory.items]
    if len(ids) != len(set(ids)):
        raise HTTPException(status_code=422, detail="Each furniture item needs a unique id.")
    for item in inventory.items:
        if item.size and any(getattr(item.size.min, k) > getattr(item.size.max, k) for k in ("w", "d", "h")):
            raise HTTPException(status_code=422, detail=f"'{item.id}': minimum size exceeds maximum.")
    project.inventory = inventory.model_dump(mode="json")
    db.commit()
    return project.inventory


@router.put("/{project_id}/brief")
def save_brief(body: dict[str, Any], project: Project = Depends(owned_project), db: Session = Depends(get_db)):
    try:
        brief = Brief.model_validate(body)
    except ValidationError as exc:
        raise HTTPException(
            status_code=422, detail=[{"loc": list(e["loc"]), "msg": e["msg"]} for e in exc.errors()[:20]]
        ) from None
    known = {a.id for a in project.assets if a.kind == "reference"}
    if any(r not in known for r in brief.reference_asset_ids):
        raise HTTPException(status_code=422, detail="Reference image does not belong to this project.")
    project.brief = brief.model_dump(mode="json")
    db.commit()
    return project.brief


# ------------------------------------------------------------------ uploads


def _sanitise_image(data: bytes) -> tuple[bytes, str, int, int]:
    """Decode, check, and re-encode an image; strips metadata such as EXIF location."""

    settings = get_settings()
    Image.MAX_IMAGE_PIXELS = settings.max_upload_pixels
    try:
        with Image.open(io.BytesIO(data)) as probe:
            fmt = probe.format or ""
            probe.verify()
        if fmt not in ALLOWED_FORMATS:
            raise HTTPException(status_code=415, detail="Upload a PNG or JPEG image. For PDFs, choose a page first.")
        with Image.open(io.BytesIO(data)) as img:
            img.load()
            w, h = img.size
            if w * h > settings.max_upload_pixels:
                raise HTTPException(status_code=413, detail="Image has too many pixels (limit 40 megapixels).")
            if w < 64 or h < 64:
                raise HTTPException(status_code=422, detail="Image is too small to trace.")
            out = io.BytesIO()
            if fmt == "PNG":
                if img.mode not in ("RGB", "RGBA", "L", "LA", "P"):
                    img.convert("RGBA").save(out, format="PNG", optimize=True)
                else:
                    img.save(out, format="PNG", optimize=True)
            else:
                img.convert("RGB").save(out, format="JPEG", quality=90)
            return out.getvalue(), ALLOWED_FORMATS[fmt], w, h
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, SyntaxError):
        raise HTTPException(status_code=415, detail="The file is not a readable PNG or JPEG image.") from None


@router.post("/{project_id}/assets", status_code=201)
async def upload_asset(
    file: UploadFile = File(...),
    kind: str = Form("plan"),
    source: str = Form(""),
    project: Project = Depends(owned_project),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    settings = get_settings()
    if kind not in ("plan", "reference"):
        raise HTTPException(status_code=422, detail="Unknown upload kind.")
    count = sum(1 for a in project.assets if a.kind == kind)
    if count >= (20 if kind == "plan" else 6):
        raise HTTPException(status_code=422, detail="Upload limit for this project reached.")
    data = await file.read(settings.max_upload_bytes + 1)
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail="File is larger than 15 MB.")
    clean, mime, w, h = _sanitise_image(data)
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    storage = f"{new_id()}{'.png' if mime == 'image/png' else '.jpg'}"
    (settings.upload_dir / storage).write_bytes(clean)
    asset = Asset(
        project_id=project.id,
        kind=kind,
        filename=storage,
        original_name=Path(file.filename or "upload").name[:200],
        mime_type=mime,
        width_px=w,
        height_px=h,
        source=source[:80],
        size_bytes=len(clean),
    )
    db.add(asset)
    db.commit()
    return asset_payload(asset)


@router.get("/{project_id}/assets/{asset_id}/file")
def asset_file(asset_id: str, project: Project = Depends(owned_project)) -> FileResponse:
    asset = next((a for a in project.assets if a.id == asset_id), None)
    if asset is None:
        raise HTTPException(status_code=404, detail="File not found.")
    path = get_settings().upload_dir / asset.filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="File not found.")
    return FileResponse(path, media_type=asset.mime_type, headers={"Cache-Control": "private, max-age=3600"})


@router.delete("/{project_id}/assets/{asset_id}", status_code=204)
def delete_asset(asset_id: str, project: Project = Depends(owned_project), db: Session = Depends(get_db)) -> None:
    asset = next((a for a in project.assets if a.id == asset_id), None)
    if asset is None:
        raise HTTPException(status_code=404, detail="File not found.")
    geometry = project.geometry or {}
    if geometry.get("plan_asset_id") == asset_id:
        raise HTTPException(status_code=409, detail="This plan is in use by the room geometry.")
    path = get_settings().upload_dir / asset.filename
    db.delete(asset)
    brief = dict(project.brief or {})
    if asset_id in brief.get("reference_asset_ids", []):
        brief["reference_asset_ids"] = [r for r in brief["reference_asset_ids"] if r != asset_id]
        project.brief = brief
    db.commit()
    path.unlink(missing_ok=True)
