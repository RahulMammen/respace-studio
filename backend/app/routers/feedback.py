from __future__ import annotations

import csv
import io
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import Feedback, Project, User, get_db
from ..deps import current_user, owned_project

router = APIRouter(prefix="/api", tags=["feedback"])


class FeedbackCreate(BaseModel):
    alternative_id: str | None = None
    revision: int | None = Field(None, ge=1)
    task: str = Field("", max_length=80)
    rating: int | None = Field(None, ge=1, le=5)
    text: str = Field(min_length=1, max_length=4000)


def _payload(f: Feedback) -> dict[str, Any]:
    return {
        "id": f.id,
        "alternative_id": f.alternative_id,
        "revision": f.revision,
        "task": f.task,
        "rating": f.rating,
        "text": f.text,
        "created_at": f.created_at.isoformat(),
    }


@router.post("/projects/{project_id}/feedback", status_code=201)
def create_feedback(
    body: FeedbackCreate,
    project: Project = Depends(owned_project),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    if body.alternative_id:
        alt = next((a for a in project.alternatives if a.id == body.alternative_id), None)
        if alt is None:
            raise HTTPException(status_code=404, detail="Design alternative not found.")
        if body.revision is not None and not any(r.number == body.revision for r in alt.revisions):
            raise HTTPException(status_code=422, detail="Revision not found.")
    fb = Feedback(project_id=project.id, author_id=user.id, **body.model_dump())
    db.add(fb)
    db.commit()
    return _payload(fb)


@router.get("/projects/{project_id}/feedback")
def list_feedback(project: Project = Depends(owned_project), db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    rows = db.scalars(select(Feedback).where(Feedback.project_id == project.id).order_by(Feedback.created_at.desc()))
    return [_payload(f) for f in rows]


@router.get("/feedback/export.csv")
def export_feedback(user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    rows = db.execute(
        select(Feedback, Project.name)
        .join(Project, Project.id == Feedback.project_id)
        .where(Project.owner_id == user.id)
        .order_by(Feedback.created_at)
    ).all()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["created_at", "project", "alternative_id", "revision", "task", "rating", "text"])
    for f, name in rows:
        w.writerow(
            [f.created_at.isoformat(), name, f.alternative_id or "", f.revision or "", f.task, f.rating or "", f.text]
        )
    return Response(
        buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="respace-feedback.csv"'},
    )
