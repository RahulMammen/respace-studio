"""Database engine, session factory and ORM models.

Every user-owned record reaches its owner through ``Project.owner_id``; the
API resolves projects only via ``deps.owned_project`` so ownership is checked
in one place.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import JSON, ForeignKey, Integer, String, Text, create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    Session,
    mapped_column,
    relationship,
    sessionmaker,
)

from .config import get_settings


def new_id() -> str:
    return uuid.uuid4().hex


def utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


class Base(DeclarativeBase):
    type_annotation_map = {dict[str, Any]: JSON, list[Any]: JSON}


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(80))
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class AuthSession(Base):
    __tablename__ = "auth_sessions"
    # SHA-256 of the random cookie token; the raw token is never stored.
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    csrf_token: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    expires_at: Mapped[datetime] = mapped_column()


class Project(Base):
    __tablename__ = "projects"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    is_sample: Mapped[bool] = mapped_column(default=False)
    geometry: Mapped[dict[str, Any]] = mapped_column(default=dict)
    inventory: Mapped[dict[str, Any]] = mapped_column(default=dict)
    brief: Mapped[dict[str, Any]] = mapped_column(default=dict)
    # Short running summary of older conversation turns, bounded in length.
    conversation_summary: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)

    assets: Mapped[list[Asset]] = relationship(cascade="all, delete-orphan", back_populates="project")
    alternatives: Mapped[list[Alternative]] = relationship(
        cascade="all, delete-orphan", back_populates="project", order_by="Alternative.created_at"
    )


class Asset(Base):
    """Uploaded plan pages and reference images, stored under data/uploads."""

    __tablename__ = "assets"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(16))  # plan | reference
    filename: Mapped[str] = mapped_column(String(64))  # storage name, never user supplied
    original_name: Mapped[str] = mapped_column(String(200))
    mime_type: Mapped[str] = mapped_column(String(32))
    width_px: Mapped[int] = mapped_column(Integer)
    height_px: Mapped[int] = mapped_column(Integer)
    source: Mapped[str] = mapped_column(String(80), default="")  # e.g. "pdf page 2"
    size_bytes: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    project: Mapped[Project] = relationship(back_populates="assets")


class Alternative(Base):
    """A named design alternative. ``scene`` is its current state."""

    __tablename__ = "alternatives"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    origin: Mapped[str] = mapped_column(String(16))  # ai | sample | manual | import
    revision: Mapped[int] = mapped_column(Integer, default=1)
    scene: Mapped[dict[str, Any]] = mapped_column(default=dict)
    validation_status: Mapped[str] = mapped_column(String(16), default="unchecked")
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)
    project: Mapped[Project] = relationship(back_populates="alternatives")
    revisions: Mapped[list[Revision]] = relationship(
        cascade="all, delete-orphan", order_by="Revision.number", back_populates="alternative"
    )


class Revision(Base):
    __tablename__ = "revisions"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    alternative_id: Mapped[str] = mapped_column(ForeignKey("alternatives.id", ondelete="CASCADE"), index=True)
    number: Mapped[int] = mapped_column(Integer)
    label: Mapped[str] = mapped_column(String(80), default="")
    source: Mapped[str] = mapped_column(String(16))  # manual | ai_edit | ai_generate | undo | import | sample
    summary: Mapped[str] = mapped_column(String(300), default="")
    scene: Mapped[dict[str, Any]] = mapped_column(default=dict)
    validation_status: Mapped[str] = mapped_column(String(16), default="unchecked")
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    alternative: Mapped[Alternative] = relationship(back_populates="revisions")


class ChangeProposal(Base):
    """AI-proposed edit awaiting Apply or Discard."""

    __tablename__ = "change_proposals"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    alternative_id: Mapped[str] = mapped_column(ForeignKey("alternatives.id", ondelete="CASCADE"), index=True)
    base_revision: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16), default="pending")  # pending | applied | discarded | stale
    source: Mapped[str] = mapped_column(String(16), default="ai_edit")  # ai_edit | ai_review
    operations: Mapped[list[Any]] = mapped_column(default=list)
    scene: Mapped[dict[str, Any]] = mapped_column(default=dict)
    report: Mapped[dict[str, Any]] = mapped_column(default=dict)
    summary: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    alternative_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    role: Mapped[str] = mapped_column(String(16))  # user | assistant | system
    text: Mapped[str] = mapped_column(Text)
    proposal_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class Feedback(Base):
    __tablename__ = "feedback"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    alternative_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    revision: Mapped[int | None] = mapped_column(Integer, nullable=True)
    task: Mapped[str] = mapped_column(String(80), default="")
    rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


_engine: Engine | None = None
_factory: sessionmaker[Session] | None = None


def _sqlite_pragmas(dbapi_conn: Any, _record: Any) -> None:
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA foreign_keys=ON")
    cur.execute("PRAGMA journal_mode=WAL")
    cur.close()


def get_engine() -> Engine:
    global _engine, _factory
    if _engine is None:
        settings = get_settings()
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        url = settings.resolved_database_url
        _engine = create_engine(url, connect_args={"check_same_thread": False} if url.startswith("sqlite") else {})
        if url.startswith("sqlite"):
            event.listen(_engine, "connect", _sqlite_pragmas)
        _factory = sessionmaker(bind=_engine, expire_on_commit=False)
    return _engine


def reset_engine() -> None:
    global _engine, _factory
    if _engine is not None:
        _engine.dispose()
    _engine, _factory = None, None


def get_db() -> Iterator[Session]:
    get_engine()
    assert _factory is not None
    db = _factory()
    try:
        yield db
    finally:
        db.close()
