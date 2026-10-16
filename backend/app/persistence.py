from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .database import (
    ChatMessageRecord,
    CourseRecord,
    CourseVersion,
    SourceRecord,
    get_db,
)
from .models import CourseDocument

router = APIRouter(prefix="/api/courses", tags=["courses"])


class SaveCourseRequest(BaseModel):
    course: CourseDocument
    messages: list[dict[str, Any]] = Field(default_factory=list, max_length=500)
    reason: str = Field(default="autosave", max_length=200)


class AddMessageRequest(BaseModel):
    role: str = Field(pattern="^(user|assistant|system|tool)$")
    payload: dict[str, Any]


def _serialize(record: CourseRecord, version: CourseVersion) -> dict[str, Any]:
    return {
        "id": record.id,
        "version": version.version,
        "course": version.payload,
        "updatedAt": record.updated_at.isoformat(),
    }


@router.put("/{course_id}")
def save_course(
    course_id: str,
    request: SaveCourseRequest,
    session: Session = Depends(get_db),
) -> dict[str, Any]:
    if request.course.id != course_id:
        raise HTTPException(status_code=400, detail="course id does not match path")
    record = session.get(CourseRecord, course_id)
    if record is None:
        record = CourseRecord(id=course_id)
        session.add(record)
        session.flush()
    record.title = request.course.brief.title
    record.current_version += 1
    version = CourseVersion(
        course_id=course_id,
        version=record.current_version,
        payload=request.course.as_api(),
        reason=request.reason,
    )
    session.add(version)

    if request.messages:
        session.execute(
            delete(ChatMessageRecord).where(ChatMessageRecord.course_id == course_id)
        )
        session.add_all(
            ChatMessageRecord(
                course_id=course_id,
                role=str(message.get("role") or "assistant"),
                payload=message,
            )
            for message in request.messages
        )

    session.execute(delete(SourceRecord).where(SourceRecord.course_id == course_id))
    session.add_all(
        SourceRecord(
            course_id=course_id,
            title=reference.title,
            source=reference.source,
            note=reference.note,
            status="source_attached" if reference.source else "unconfirmed",
        )
        for reference in request.course.brief.references
    )
    session.commit()
    session.refresh(record)
    return _serialize(record, version)


@router.get("/{course_id}")
def load_course(
    course_id: str, session: Session = Depends(get_db)
) -> dict[str, Any]:
    record = session.get(CourseRecord, course_id)
    if record is None:
        raise HTTPException(status_code=404, detail="course not found")
    version = session.scalar(
        select(CourseVersion)
        .where(CourseVersion.course_id == course_id)
        .order_by(CourseVersion.version.desc())
        .limit(1)
    )
    if version is None:
        raise HTTPException(status_code=404, detail="course has no versions")
    messages = session.scalars(
        select(ChatMessageRecord)
        .where(ChatMessageRecord.course_id == course_id)
        .order_by(ChatMessageRecord.id)
    ).all()
    sources = session.scalars(
        select(SourceRecord)
        .where(SourceRecord.course_id == course_id)
        .order_by(SourceRecord.id)
    ).all()
    return {
        **_serialize(record, version),
        "messages": [message.payload for message in messages],
        "sources": [
            {
                "title": source.title,
                "source": source.source,
                "note": source.note,
                "status": source.status,
            }
            for source in sources
        ],
    }


@router.get("/{course_id}/versions")
def list_versions(
    course_id: str, session: Session = Depends(get_db)
) -> dict[str, Any]:
    if session.get(CourseRecord, course_id) is None:
        raise HTTPException(status_code=404, detail="course not found")
    versions = session.scalars(
        select(CourseVersion)
        .where(CourseVersion.course_id == course_id)
        .order_by(CourseVersion.version.desc())
    ).all()
    return {
        "versions": [
            {
                "version": version.version,
                "reason": version.reason,
                "createdAt": version.created_at.isoformat(),
            }
            for version in versions
        ]
    }


@router.post("/{course_id}/messages")
def append_message(
    course_id: str,
    request: AddMessageRequest,
    session: Session = Depends(get_db),
) -> dict[str, Any]:
    if session.get(CourseRecord, course_id) is None:
        raise HTTPException(status_code=404, detail="course not found")
    message = ChatMessageRecord(
        course_id=course_id,
        role=request.role,
        payload=request.payload,
    )
    session.add(message)
    session.commit()
    return {"id": message.id}
