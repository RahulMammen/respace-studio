"""Password hashing, server-side sessions, CSRF and origin checks."""

from __future__ import annotations

import hashlib
import hmac
import secrets
import time
from collections import defaultdict, deque
from datetime import timedelta
from urllib.parse import urlsplit

from fastapi import HTTPException, Request, Response
from pwdlib import PasswordHash
from sqlalchemy.orm import Session

from .config import get_settings
from .db import AuthSession, User, utcnow

SESSION_COOKIE = "respace_session"
CSRF_COOKIE = "respace_csrf"
CSRF_HEADER = "x-csrf-token"
UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

_hasher = PasswordHash.recommended()  # Argon2id via argon2-cffi


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    try:
        return _hasher.verify(password, hashed)
    except Exception:  # noqa: BLE001 - malformed hash counts as failure
        return False


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(db: Session, user: User, response: Response) -> AuthSession:
    settings = get_settings()
    token = secrets.token_urlsafe(32)
    session = AuthSession(
        token_hash=_token_hash(token),
        user_id=user.id,
        csrf_token=secrets.token_urlsafe(24),
        expires_at=utcnow() + timedelta(days=settings.session_days),
    )
    db.add(session)
    db.commit()
    max_age = settings.session_days * 86400
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=max_age,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )
    response.set_cookie(
        CSRF_COOKIE,
        session.csrf_token,
        max_age=max_age,
        httponly=False,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )
    return session


def load_session(db: Session, request: Request) -> AuthSession | None:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    session = db.get(AuthSession, _token_hash(token))
    if session is None:
        return None
    if session.expires_at < utcnow():
        db.delete(session)
        db.commit()
        return None
    return session


def end_session(db: Session, request: Request, response: Response) -> None:
    session = load_session(db, request)
    if session is not None:
        db.delete(session)
        db.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")
    response.delete_cookie(CSRF_COOKIE, path="/")


def check_csrf(request: Request, session: AuthSession) -> None:
    if request.method not in UNSAFE_METHODS:
        return
    sent = request.headers.get(CSRF_HEADER, "")
    if not sent or not hmac.compare_digest(sent, session.csrf_token):
        raise HTTPException(status_code=403, detail="Missing or invalid CSRF token.")


def origin_allowed(request: Request) -> bool:
    """Reject cross-site unsafe requests. Same origin is always allowed."""

    if request.method not in UNSAFE_METHODS:
        return True
    origin = request.headers.get("origin")
    if origin is None:
        referer = request.headers.get("referer")
        if referer is None:
            return True  # non-browser client; CSRF token still required for sessions
        parts = urlsplit(referer)
        origin = f"{parts.scheme}://{parts.netloc}"
    origin = origin.rstrip("/")
    if origin == "null":
        return False
    host = request.headers.get("host", "")
    own = {f"http://{host}", f"https://{host}"}
    return origin in own or origin in get_settings().extra_origins


class LoginLimiter:
    """Small in-memory limiter: 10 failed sign-ins per key per 10 minutes."""

    def __init__(self, limit: int = 10, window: float = 600.0) -> None:
        self.limit, self.window = limit, window
        self._fails: dict[str, deque[float]] = defaultdict(deque)

    def _trim(self, key: str) -> deque[float]:
        q = self._fails[key]
        now = time.monotonic()
        while q and now - q[0] > self.window:
            q.popleft()
        return q

    def blocked(self, key: str) -> bool:
        return len(self._trim(key)) >= self.limit

    def fail(self, key: str) -> None:
        self._trim(key).append(time.monotonic())

    def reset(self, key: str) -> None:
        self._fails.pop(key, None)


login_limiter = LoginLimiter()
