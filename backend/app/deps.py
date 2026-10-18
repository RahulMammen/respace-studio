"""Request dependencies: authenticated user and owner-checked project access."""

from __future__ import annotations

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import Alternative, AuthSession, Project, User, get_db
from .security import check_csrf, load_session


def current_session(request: Request, db: Session = Depends(get_db)) -> AuthSession:
    session = load_session(db, request)
    if session is None:
        raise HTTPException(status_code=401, detail="Sign in to continue.")
    check_csrf(request, session)
    return session


def current_user(session: AuthSession = Depends(current_session), db: Session = Depends(get_db)) -> User:
    user = db.get(User, session.user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="Sign in to continue.")
    return user


def owned_project(project_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> Project:
    """The only way routes obtain a project. Other users' projects look missing (404)."""

    project = db.scalar(select(Project).where(Project.id == project_id, Project.owner_id == user.id))
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    return project


def owned_alternative(
    alternative_id: str, project: Project = Depends(owned_project), db: Session = Depends(get_db)
) -> Alternative:
    alt = db.scalar(select(Alternative).where(Alternative.id == alternative_id, Alternative.project_id == project.id))
    if alt is None:
        raise HTTPException(status_code=404, detail="Design alternative not found.")
    return alt
