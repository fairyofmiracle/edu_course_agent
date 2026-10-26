from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship

from .cloud import setting

DEFAULT_DB = Path(__file__).parents[1] / "data" / "studio.db"
DATABASE_URL = setting("DATABASE_URL", f"sqlite:///{DEFAULT_DB.as_posix()}")
CONNECT_ARGS = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, connect_args=CONNECT_ARGS, pool_pre_ping=True)


class Base(DeclarativeBase):
    pass


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class CourseRecord(Base):
    __tablename__ = "courses"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    title: Mapped[str] = mapped_column(String(180), default="")
    current_version: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )
    versions: Mapped[list["CourseVersion"]] = relationship(
        back_populates="course", cascade="all, delete-orphan"
    )
    messages: Mapped[list["ChatMessageRecord"]] = relationship(
        back_populates="course", cascade="all, delete-orphan"
    )
    sources: Mapped[list["SourceRecord"]] = relationship(
        back_populates="course", cascade="all, delete-orphan"
    )


class CourseVersion(Base):
    __tablename__ = "course_versions"
    __table_args__ = (UniqueConstraint("course_id", "version", name="course_version_uniq"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    course_id: Mapped[str] = mapped_column(
        ForeignKey("courses.id", ondelete="CASCADE"), index=True
    )
    version: Mapped[int] = mapped_column(Integer)
    payload: Mapped[dict] = mapped_column(JSON)
    reason: Mapped[str] = mapped_column(String(200), default="autosave")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    course: Mapped[CourseRecord] = relationship(back_populates="versions")


class ChatMessageRecord(Base):
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    course_id: Mapped[str] = mapped_column(
        ForeignKey("courses.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(20))
    payload: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    course: Mapped[CourseRecord] = relationship(back_populates="messages")


class CourseArtifact(Base):
    """Готовый архив версии. Файл лежит на диске, в базе имя, путь и сумма."""

    __tablename__ = "course_artifacts"
    __table_args__ = (UniqueConstraint("course_id", "version", "kind", name="course_artifact_uniq"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    course_id: Mapped[str] = mapped_column(
        ForeignKey("courses.id", ondelete="CASCADE"), index=True
    )
    version: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(20))
    filename: Mapped[str] = mapped_column(String(180))
    sha256: Mapped[str] = mapped_column(String(64))
    path: Mapped[str] = mapped_column(String(500))
    byte_size: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SourceRecord(Base):
    __tablename__ = "sources"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    course_id: Mapped[str] = mapped_column(
        ForeignKey("courses.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(500))
    source: Mapped[str | None] = mapped_column(Text, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="unconfirmed")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    course: Mapped[CourseRecord] = relationship(back_populates="sources")


def init_database() -> None:
    DEFAULT_DB.parent.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(engine)


def get_db() -> Iterator[Session]:
    with Session(engine) as session:
        yield session
