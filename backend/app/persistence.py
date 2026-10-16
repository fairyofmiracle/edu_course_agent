from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

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


def _copy_title(title: str) -> str:
    base = title.strip() or "Новая образовательная программа"
    return f"{base} — копия"[:180]


def _summary(record: CourseRecord, version: CourseVersion | None) -> dict[str, Any]:
    brief = (version.payload or {}).get("brief") if version else {}
    brief = brief if isinstance(brief, dict) else {}
    return {
        "id": record.id,
        "title": record.title or str(brief.get("title") or ""),
        "audience": str(brief.get("audience") or ""),
        "programKind": str(brief.get("programKind") or "unset"),
        "durationHours": brief.get("durationHours") or 0,
        "attestationHours": brief.get("attestationHours") or 0,
        "version": record.current_version,
        "updatedAt": record.updated_at.isoformat(),
    }


def _latest_version(session: Session, course_id: str) -> CourseVersion | None:
    return session.scalar(
        select(CourseVersion)
        .where(CourseVersion.course_id == course_id)
        .order_by(CourseVersion.version.desc())
        .limit(1)
    )


def _serialize(record: CourseRecord, version: CourseVersion) -> dict[str, Any]:
    return {
        "id": record.id,
        "version": version.version,
        "course": version.payload,
        "updatedAt": record.updated_at.isoformat(),
    }


@router.get(
    "",
    summary="Список сохранённых курсов",
    description="Курсы методиста в базе студии. Открытие и копия не удаляют остальные.",
    operation_id="listCourses",
)
def list_courses(session: Session = Depends(get_db)) -> dict[str, Any]:
    records = session.scalars(
        select(CourseRecord).order_by(CourseRecord.updated_at.desc())
    ).all()
    return {"courses": [_summary(record, _latest_version(session, record.id)) for record in records]}


@router.put(
    "/{course_id}",
    summary="Сохранить версию курса",
    description="Идентификатор в теле и в пути должны совпадать. Каждое сохранение увеличивает номер версии.",
    operation_id="saveCourse",
)
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


@router.get(
    "/{course_id}",
    summary="Загрузить последнюю версию курса",
    operation_id="loadCourse",
)
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


@router.get(
    "/{course_id}/versions",
    summary="Список версий курса",
    operation_id="listCourseVersions",
)
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


@router.post(
    "/{course_id}/copy",
    summary="Сделать копию курса",
    description="Новый курс с новым идентификатором. Исходный курс, его версии и диалог не меняются.",
    operation_id="copyCourse",
)
def copy_course(course_id: str, session: Session = Depends(get_db)) -> dict[str, Any]:
    record = session.get(CourseRecord, course_id)
    version = _latest_version(session, course_id) if record is not None else None
    if record is None or version is None:
        raise HTTPException(status_code=404, detail="course not found")
    original = CourseDocument.model_validate(version.payload)
    cloned = original.model_copy(
        update={
            "id": str(uuid4()),
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "brief": original.brief.model_copy(update={"title": _copy_title(original.brief.title)}),
        }
    )
    return save_course(
        cloned.id,
        SaveCourseRequest(course=cloned, messages=[], reason="copy"),
        session,
    )


@router.post(
    "/{course_id}/messages",
    summary="Добавить сообщение диалога",
    operation_id="appendCourseMessage",
)
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
