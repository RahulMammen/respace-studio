from __future__ import annotations

import asyncio
import base64
import binascii
import logging
from collections.abc import Awaitable
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..ai.design import generate_proposals, plan_edit
from ..ai.provider import AIError, ImagePart
from ..ai.registry import get_provider, provider_status
from ..ai.vision import extract_geometry, review_scene
from ..config import get_settings
from ..db import Alternative, ChangeProposal, ChatMessage, Project, get_db
from ..deps import current_user, owned_alternative, owned_project
from ..edits import Operation, apply_operations, diff_scenes
from ..scene import Calibration, Geometry
from ..services import (
    alternative_payload,
    commit_revision,
    create_alternative,
    load_brief,
    load_inventory,
    load_scene,
    project_alternatives,
    require_confirmed,
    validate_for,
)

router = APIRouter(prefix="/api", tags=["ai"])
log = logging.getLogger("respace.ai")


async def run_cancellable[R](request: Request, work: Awaitable[R]) -> R:
    """Run provider work but stop it if the browser cancels or disconnects."""

    task = asyncio.ensure_future(work)
    try:
        while not task.done():
            done, _ = await asyncio.wait({task}, timeout=0.5)
            if done:
                break
            if await request.is_disconnected():
                task.cancel()
                raise HTTPException(status_code=499, detail="Request cancelled.")
        return task.result()
    except AIError as err:
        raise HTTPException(
            status_code=err.http_status, detail={"code": err.code, "message": err.user_message}
        ) from None
    finally:
        if not task.done():
            task.cancel()


def _provider():
    try:
        return get_provider()
    except AIError as err:
        raise HTTPException(
            status_code=err.http_status, detail={"code": err.code, "message": err.user_message}
        ) from None


@router.get("/ai/status")
def ai_status(_: Any = Depends(current_user)) -> dict[str, Any]:
    return provider_status()


# ------------------------------------------------------------------ generation


class GenerateRequest(BaseModel):
    count: int = Field(3, ge=1, le=3)
    use_reference_images: bool = True


@router.post("/projects/{project_id}/ai/generate")
async def generate(
    body: GenerateRequest, request: Request, project: Project = Depends(owned_project), db: Session = Depends(get_db)
) -> dict[str, Any]:
    geometry = require_confirmed(project)
    inventory = load_inventory(project)
    if not inventory.items:
        raise HTTPException(status_code=422, detail="Add furniture requirements first.")
    brief = load_brief(project)
    images: list[ImagePart] = []
    if body.use_reference_images:
        settings = get_settings()
        for asset in project.assets:
            if asset.kind == "reference" and asset.id in brief.reference_asset_ids:
                path = settings.upload_dir / asset.filename
                if path.is_file():
                    from ..ai.vision import downscale

                    images.append(ImagePart(downscale(path.read_bytes(), 1024)[0], "image/jpeg"))
    provider = _provider()
    result = await run_cancellable(
        request, generate_proposals(provider, geometry, inventory, brief, count=body.count, reference_images=images)
    )
    created = []
    for p in result.proposals:
        status_note = "validated" if not p.report.errors else "needs attention"
        alt, report = create_alternative(
            db,
            project,
            p.name,
            "ai",
            p.scene,
            f"AI proposal ({status_note}); repair rounds {p.repair_rounds}",
            "ai_generate",
        )
        created.append(
            {
                **alternative_payload(alt, report),
                "concept": p.concept,
                "repair_rounds": p.repair_rounds,
                "notes": p.notes,
                "conversion_errors": p.conversion_errors,
            }
        )
    db.add(
        ChatMessage(
            project_id=project.id, role="system", text=f"Generated {len(created)} proposal(s) with {result.model}."
        )
    )
    db.commit()
    return {
        "alternatives": created,
        "conflicts": result.conflicts,
        "model": result.model,
        "calls": result.calls,
        "test_double": provider.is_test_double,
    }


# ------------------------------------------------------------------ plan extraction


class ExtractRequest(BaseModel):
    asset_id: str
    calibration: dict[str, Any]


@router.post("/projects/{project_id}/ai/extract-geometry")
async def extract(body: ExtractRequest, request: Request, project: Project = Depends(owned_project)) -> dict:
    asset = next((a for a in project.assets if a.id == body.asset_id and a.kind == "plan"), None)
    if asset is None:
        raise HTTPException(status_code=404, detail="Plan not found.")
    try:
        cal = Calibration.model_validate(body.calibration)
        _ = cal.metres_per_pixel
    except ValueError:
        raise HTTPException(status_code=422, detail="Calibrate the plan before using AI tracing.") from None
    path = get_settings().upload_dir / asset.filename
    provider = _provider()
    result = await run_cancellable(request, extract_geometry(provider, path.read_bytes(), cal, cache_key=asset.id))
    # Proposed rooms are validated as a draft so the UI can flag problems; never confirmed here.
    from ..geometry.validate import validate_geometry

    try:
        draft = Geometry.model_validate(
            {
                "rooms": [
                    {k: v for k, v in r.items() if k != "confidence"}
                    | {"openings": [{k2: v2 for k2, v2 in o.items() if k2 != "confidence"} for o in r["openings"]]}
                    for r in result["rooms"]
                ]
            }
        )
        result["issues"] = [i.as_dict() for i in validate_geometry(draft)]
    except ValueError as exc:
        result["issues"] = [{"code": "invalid_draft", "severity": "error", "message": str(exc).splitlines()[0]}]
    result["test_double"] = provider.is_test_double
    return result


# ------------------------------------------------------------------ conversation


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=1500)
    base_revision: int
    selected_ids: list[str] = Field(default_factory=list, max_length=20)


def _history(db: Session, project: Project) -> list[ChatMessage]:
    return list(
        db.scalars(select(ChatMessage).where(ChatMessage.project_id == project.id).order_by(ChatMessage.created_at))
    )


def _compact_history(db: Session, project: Project) -> None:
    """Keep the newest 30 messages; fold older user requests into a bounded summary."""

    msgs = _history(db, project)
    if len(msgs) <= 30:
        return
    old = msgs[:-30]
    requests = [m.text[:120] for m in old if m.role == "user"]
    summary = (project.conversation_summary + " | " if project.conversation_summary else "") + " | ".join(requests)
    project.conversation_summary = summary[-1200:]
    for m in old:
        db.delete(m)


@router.get("/projects/{project_id}/chat")
def chat_history(project: Project = Depends(owned_project), db: Session = Depends(get_db)) -> dict[str, Any]:
    msgs = _history(db, project)
    proposals = {
        p.id: p
        for p in db.scalars(
            select(ChangeProposal).where(ChangeProposal.id.in_([m.proposal_id for m in msgs if m.proposal_id]))
        )
    }
    return {
        "summary": project.conversation_summary,
        "messages": [
            {
                "id": m.id,
                "role": m.role,
                "text": m.text,
                "alternative_id": m.alternative_id,
                "proposal_id": m.proposal_id,
                "proposal_status": proposals[m.proposal_id].status if m.proposal_id in proposals else None,
                "created_at": m.created_at.isoformat(),
            }
            for m in msgs
        ],
    }


def _proposal_payload(p: ChangeProposal) -> dict[str, Any]:
    return {
        "id": p.id,
        "status": p.status,
        "source": p.source,
        "base_revision": p.base_revision,
        "operations": p.operations,
        "scene": p.scene,
        "report": p.report,
        "summary": p.summary,
    }


@router.post("/projects/{project_id}/alternatives/{alternative_id}/chat")
async def chat(
    body: ChatRequest,
    request: Request,
    alt: Alternative = Depends(owned_alternative),
    project: Project = Depends(owned_project),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    geometry = require_confirmed(project)
    if body.base_revision != alt.revision:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "stale_revision",
                "message": "The design changed. Your request was not sent.",
                "current_revision": alt.revision,
            },
        )
    scene = load_scene(alt)
    inventory = load_inventory(project)
    brief = load_brief(project)
    history = [(m.role, m.text) for m in _history(db, project) if m.role in ("user", "assistant")]
    provider = _provider()
    db.add(ChatMessage(project_id=project.id, alternative_id=alt.id, role="user", text=body.message))
    db.commit()
    result = await run_cancellable(
        request,
        plan_edit(
            provider,
            geometry,
            inventory,
            brief,
            scene,
            body.message,
            selected_ids=body.selected_ids,
            history=history,
            summary=project.conversation_summary,
        ),
    )
    # Re-read: a manual edit may have landed while the model was thinking.
    db.refresh(alt)
    proposal_scene, report, operations = result.scene, result.report, result.operations
    reply = result.reply
    if result.intent == "rearrange":
        gen = await run_cancellable(
            request,
            generate_proposals(
                provider, geometry, inventory, brief, base_scene=scene, count=1, request_text=body.message
            ),
        )
        if gen.proposals:
            p = gen.proposals[0]
            proposal_scene, report, operations = p.scene, p.report, []
            reply = (reply + " " if reply else "") + f"New arrangement: {p.concept}"
    proposal_payload: dict[str, Any] | None = None
    if proposal_scene is not None and report is not None:
        diff = diff_scenes(scene, proposal_scene)
        affected = sorted(set(diff["added"]) | set(diff["removed"]) | set(diff["changed"]))
        status = "pending" if body.base_revision == alt.revision else "stale"
        cp = ChangeProposal(
            alternative_id=alt.id,
            base_revision=body.base_revision,
            status=status,
            source="ai_edit",
            operations=operations,
            scene=proposal_scene.model_dump(mode="json"),
            report={
                **report.as_dict(),
                "diff": diff,
                "affected_ids": affected,
                "rejected": result.rejected,
                "conflicts": result.conflicts,
                "repair_rounds": result.repair_rounds,
            },
            summary=reply[:1000],
        )
        db.add(cp)
        db.flush()
        proposal_payload = _proposal_payload(cp)
        msg = ChatMessage(
            project_id=project.id,
            alternative_id=alt.id,
            role="assistant",
            text=reply or "Proposed changes.",
            proposal_id=cp.id,
        )
    else:
        extra = ""
        if result.intent == "geometry_change":
            extra = " Room geometry is changed in the Plan step, then re-confirmed."
        msg = ChatMessage(project_id=project.id, alternative_id=alt.id, role="assistant", text=(reply + extra).strip())
    db.add(msg)
    _compact_history(db, project)
    db.commit()
    return {
        "intent": result.intent,
        "reply": msg.text,
        "conflicts": result.conflicts,
        "proposal": proposal_payload,
        "model": result.model,
        "test_double": provider.is_test_double,
    }


@router.post("/projects/{project_id}/proposals/{proposal_id}/apply")
def apply_proposal(proposal_id: str, project: Project = Depends(owned_project), db: Session = Depends(get_db)) -> dict:
    cp, alt = _owned_proposal(db, project, proposal_id)
    if cp.status != "pending":
        raise HTTPException(status_code=409, detail={"code": cp.status, "message": f"This proposal is {cp.status}."})
    from ..scene import Scene

    new_scene = Scene.model_validate(cp.scene)
    if cp.base_revision != alt.revision:
        cp.status = "stale"
        db.commit()
        raise HTTPException(
            status_code=409,
            detail={
                "code": "stale_revision",
                "message": "The design changed after this proposal was made. Ask again to get a fresh proposal.",
                "current_revision": alt.revision,
            },
        )
    # The complete resulting scene is validated; a patch may not introduce new errors.
    before = validate_for(project, load_scene(alt))
    after = validate_for(project, new_scene)
    new_err = {(i.code, tuple(i.object_ids)) for i in after.errors} - {
        (i.code, tuple(i.object_ids)) for i in before.errors
    }
    if new_err:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "invalid_scene",
                "message": "These changes would introduce validation errors.",
                "report": after.as_dict(),
            },
        )
    _, report = commit_revision(
        db,
        alt,
        project,
        new_scene,
        base_revision=cp.base_revision,
        source="ai_edit" if cp.source == "ai_edit" else "ai_review",
        summary=f"AI: {cp.summary[:200]}",
    )
    cp.status = "applied"
    db.commit()
    return alternative_payload(alt, report)


@router.post("/projects/{project_id}/proposals/{proposal_id}/discard")
def discard_proposal(
    proposal_id: str, project: Project = Depends(owned_project), db: Session = Depends(get_db)
) -> dict:
    cp, _ = _owned_proposal(db, project, proposal_id)
    if cp.status == "pending":
        cp.status = "discarded"
        db.commit()
    return {"id": cp.id, "status": cp.status}


def _owned_proposal(db: Session, project: Project, proposal_id: str) -> tuple[ChangeProposal, Alternative]:
    cp = db.get(ChangeProposal, proposal_id)
    alt = db.get(Alternative, cp.alternative_id) if cp else None
    if cp is None or alt is None or alt.project_id != project.id:
        raise HTTPException(status_code=404, detail="Proposal not found.")
    return cp, alt


# ------------------------------------------------------------------ visual review


class ReviewRequest(BaseModel):
    base_revision: int
    image_png_base64: str = Field(max_length=8_000_000)


@router.post("/projects/{project_id}/alternatives/{alternative_id}/review")
async def review(
    body: ReviewRequest,
    request: Request,
    alt: Alternative = Depends(owned_alternative),
    project: Project = Depends(owned_project),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    require_confirmed(project)
    if body.base_revision != alt.revision:
        raise HTTPException(status_code=409, detail={"code": "stale_revision", "message": "The design changed."})
    raw = body.image_png_base64.split(",", 1)[-1]
    try:
        png = base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=422, detail="Screenshot is not valid base64.") from None
    if not png.startswith(b"\x89PNG"):
        raise HTTPException(status_code=422, detail="Screenshot must be a PNG captured from the canvas.")
    scene = load_scene(alt)
    report = validate_for(project, scene)
    provider = _provider()
    result = await run_cancellable(request, review_scene(provider, png, scene, report, load_brief(project).text))
    db.refresh(alt)
    proposal = None
    if result["operations"]:
        ops = [Operation.model_validate(o) for o in result["operations"]]
        applied = apply_operations(scene, ops)
        rep = validate_for(project, applied.scene)
        diff = diff_scenes(scene, applied.scene)
        cp = ChangeProposal(
            alternative_id=alt.id,
            base_revision=body.base_revision,
            status="pending" if alt.revision == body.base_revision else "stale",
            source="ai_review",
            operations=[o.model_dump(exclude_none=True) for o in ops],
            scene=applied.scene.model_dump(mode="json"),
            report={
                **rep.as_dict(),
                "diff": diff,
                "affected_ids": applied.affected_ids,
                "rejected": [r.model_dump() for r in applied.rejected],
                "conflicts": [],
            },
            summary=result["summary"][:1000],
        )
        db.add(cp)
        db.flush()
        proposal = _proposal_payload(cp)
    db.add(
        ChatMessage(
            project_id=project.id,
            alternative_id=alt.id,
            role="assistant",
            text=f"Review: {result['summary']}",
            proposal_id=proposal["id"] if proposal else None,
        )
    )
    db.commit()
    return {**result, "proposal": proposal, "test_double": provider.is_test_double}


__all__ = ["router", "project_alternatives"]
