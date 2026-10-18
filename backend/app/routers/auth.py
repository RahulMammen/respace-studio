from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import AuthSession, User, get_db
from ..deps import current_session, current_user
from ..security import create_session, end_session, hash_password, login_limiter, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_DUMMY_HASH = hash_password("timing-equaliser-not-a-password")


class Credentials(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(min_length=1, max_length=200)

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        v = v.strip().lower()
        if not EMAIL.match(v):
            raise ValueError("Enter a valid email address.")
        return v


class Registration(Credentials):
    display_name: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=10, max_length=200)


def _user_payload(user: User, session: AuthSession) -> dict[str, object]:
    return {
        "user": {"id": user.id, "email": user.email, "display_name": user.display_name},
        "csrf_token": session.csrf_token,
    }


@router.get("/config")
def auth_config() -> dict[str, object]:
    return {"allow_registration": get_settings().allow_registration}


@router.post("/register", status_code=201)
def register(body: Registration, response: Response, db: Session = Depends(get_db)) -> dict[str, object]:
    if not get_settings().allow_registration:
        raise HTTPException(status_code=403, detail="Registration is disabled on this server.")
    if db.scalar(select(User).where(User.email == body.email)):
        raise HTTPException(status_code=409, detail="An account with this email already exists.")
    user = User(email=body.email, display_name=body.display_name.strip(), password_hash=hash_password(body.password))
    db.add(user)
    db.commit()
    session = create_session(db, user, response)
    return _user_payload(user, session)


@router.post("/login")
def login(body: Credentials, request: Request, response: Response, db: Session = Depends(get_db)) -> dict[str, object]:
    key = f"{request.client.host if request.client else '?'}:{body.email}"
    if login_limiter.blocked(key):
        raise HTTPException(status_code=429, detail="Too many attempts. Wait a few minutes and try again.")
    user = db.scalar(select(User).where(User.email == body.email))
    ok = verify_password(body.password, user.password_hash if user else _DUMMY_HASH)
    if not user or not ok:
        login_limiter.fail(key)
        raise HTTPException(status_code=401, detail="Email or password is incorrect.")
    login_limiter.reset(key)
    session = create_session(db, user, response)
    return _user_payload(user, session)


@router.post("/logout")
def logout(
    request: Request, response: Response, _: AuthSession = Depends(current_session), db: Session = Depends(get_db)
) -> dict[str, bool]:
    end_session(db, request, response)
    return {"ok": True}


@router.get("/me")
def me(session: AuthSession = Depends(current_session), user: User = Depends(current_user)) -> dict[str, object]:
    return _user_payload(user, session)
