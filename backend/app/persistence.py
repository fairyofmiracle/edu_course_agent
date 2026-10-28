from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .verbatim import effective_reference_status, stored_source_status
from .database import (
    ChatMessageRecord,
    CourseArtifact,
    CourseRecord,
    CourseVersion,
    SourceRecord,
    get_db,
)
from .export_api import file_response
from .models import CourseDocument

router = APIRouter(prefix="/api/courses", tags=["courses"])


class SaveCourseRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    course: CourseDocument
    messages: list[dict[str, Any]] = Field(default_factory=list, max_length=500)
    reason: str = Field(default="autosave", max_length=200)
    expected_version: int | None = Field(default=None, alias="expectedVersion")


class AddMessageRequest(BaseModel):
    role: str = Field(pattern="^(user|assistant|system|tool)$")
    payload: dict[str, Any]


def _copy_title(title: str) -> str:
    base = title.strip() or "Без названия"
    return f"{base} — копия"[:180]



def _kit_count(payload: dict[str, Any]) -> dict[str, Any]:
    modules = payload.get("modules") if isinstance(payload.get("modules"), list) else []
    lectures = payload.get("lectures") if isinstance(payload.get("lectures"), list) else []
    seminars = payload.get("seminars") if isinstance(payload.get("seminars"), list) else []
    assessments = payload.get("assessments") if isinstance(payload.get("assessments"), list) else []

    def mid(row: Any) -> str:
        return str(row.get("moduleId") or "") if isinstance(row, dict) else ""

    need_lecture = 0
    for module in modules:
        if not isinstance(module, dict):
            continue
        try:
            if float(module.get("lectureHours") or 0) > 0:
                need_lecture += 1
        except (TypeError, ValueError):
            pass
    need_seminar = len([m for m in modules if isinstance(m, dict)])
    need_test = need_seminar

    have_lecture = 0
    have_seminar = 0
    have_test = 0
    for module in modules:
        if not isinstance(module, dict):
            continue
        module_id = str(module.get("id") or "")
        if any(mid(row) == module_id and isinstance(row, dict) and row.get("slides") for row in lectures):
            have_lecture += 1
        if any(mid(row) == module_id and isinstance(row, dict) and row.get("tasks") for row in seminars):
            have_seminar += 1
        if any(mid(row) == module_id and isinstance(row, dict) and row.get("questions") for row in assessments):
            have_test += 1

    return {
        "lecture": {"have": have_lecture, "need": need_lecture},
        "seminar": {"have": have_seminar, "need": need_seminar},
        "test": {"have": have_test, "need": need_test},
    }


def _stage_from_kit(kit: dict[str, Any]) -> str:
    parts = [kit["lecture"], kit["seminar"], kit["test"]]
    need = sum(int(p["need"]) for p in parts)
    have = sum(int(p["have"]) for p in parts)
    if need <= 0 or have <= 0:
        return "empty"
    if have >= need:
        return "ready"
    return "partial"


def _readiness(payload: dict[str, Any]) -> dict[str, Any]:
    modules = payload.get("modules") if isinstance(payload.get("modules"), list) else []
    kit = _kit_count(payload)
    materials = _stage_from_kit(kit)
    approved = bool(payload.get("frameworkApproved"))
    if approved:
        framework = "ready"
    elif modules:
        framework = "partial"
    else:
        framework = "empty"
    if not modules:
        checks = "empty"
    elif materials == "ready" and approved:
        checks = "pass"
    elif materials == "empty":
        checks = "empty"
    elif materials == "partial":
        checks = "warning"
    else:
        checks = "warning"
    return {
        "framework": framework,
        "materials": materials,
        "checks": checks,
        "kit": kit,
    }


def _summary(record: CourseRecord, version: CourseVersion | None) -> dict[str, Any]:
    brief = (version.payload or {}).get("brief") if version else {}
    brief = brief if isinstance(brief, dict) else {}
    payload = version.payload if version and isinstance(version.payload, dict) else {}
    return {
        "id": record.id,
        "title": record.title or str(brief.get("title") or ""),
        "audience": str(brief.get("audience") or ""),
        "programKind": str(brief.get("programKind") or "unset"),
        "durationHours": brief.get("durationHours") or 0,
        "attestationHours": brief.get("attestationHours") or 0,
        "version": record.current_version,
        "updatedAt": record.updated_at.isoformat(),
        "readiness": _readiness(payload),
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
        raise HTTPException(status_code=400, detail="Идентификатор курса в пути и в теле не совпадает.")
    record = session.scalar(
        select(CourseRecord).where(CourseRecord.id == course_id).with_for_update()
    )
    if record is None:
        record = CourseRecord(id=course_id)
        session.add(record)
        session.flush()
    if (
        request.expected_version is not None
        and record.current_version != request.expected_version
    ):
        raise HTTPException(
            status_code=409,
            detail="Курс уже сохранила другая вкладка. Обновите программу и повторите.",
        )
    latest = session.scalar(
        select(func.max(CourseVersion.version)).where(CourseVersion.course_id == course_id)
    )
    next_version = max(record.current_version, int(latest or 0)) + 1
    try:
        record.title = request.course.brief.title
        record.current_version = next_version
        version = CourseVersion(
            course_id=course_id,
            version=next_version,
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
                status=effective_reference_status(reference),
            )
            for reference in request.course.brief.references
        )
        session.commit()
    except IntegrityError as error:
        session.rollback()
        raise HTTPException(
            status_code=409,
            detail="Курс уже сохранила другая вкладка. Обновите программу и повторите.",
        ) from error
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
        raise HTTPException(status_code=404, detail="Курс не найден.")
    version = session.scalar(
        select(CourseVersion)
        .where(CourseVersion.course_id == course_id)
        .order_by(CourseVersion.version.desc())
        .limit(1)
    )
    if version is None:
        raise HTTPException(status_code=404, detail="У курса ещё нет сохранённых версий.")
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
    "/{course_id}/export/{kind}",
    summary="Выгрузить сохранённую версию курса",
    description="Последняя версия из базы в json, docx или pptx.",
    operation_id="exportSavedCourse",
)
def export_saved_course(
    course_id: str,
    kind: str,
    session: Session = Depends(get_db),
) -> Any:
    if session.get(CourseRecord, course_id) is None:
        raise HTTPException(status_code=404, detail="Курс не найден.")
    version = _latest_version(session, course_id)
    if version is None:
        raise HTTPException(status_code=404, detail="У курса ещё нет сохранённых версий.")
    return file_response(kind, CourseDocument.model_validate(version.payload))


@router.get(
    "/{course_id}/versions",
    summary="Список версий курса",
    operation_id="listCourseVersions",
)
def list_versions(
    course_id: str, session: Session = Depends(get_db)
) -> dict[str, Any]:
    if session.get(CourseRecord, course_id) is None:
        raise HTTPException(status_code=404, detail="Курс не найден.")
    versions = session.scalars(
        select(CourseVersion)
        .where(CourseVersion.course_id == course_id)
        .order_by(CourseVersion.version.desc())
    ).all()
    artifacts = {
        (item.version, item.kind): item
        for item in session.scalars(
            select(CourseArtifact).where(CourseArtifact.course_id == course_id)
        ).all()
    }
    return {
        "versions": [
            {
                "version": version.version,
                "reason": version.reason,
                "createdAt": version.created_at.isoformat(),
                **(
                    {
                        "archive": artifacts[(version.version, "zip")].filename,
                        "sha256": artifacts[(version.version, "zip")].sha256,
                    }
                    if (version.version, "zip") in artifacts
                    else {}
                ),
            }
            for version in versions
        ]
    }


class ConfirmSourceRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    title: str | None = Field(default=None, max_length=200)
    source: str | None = Field(default=None, max_length=500)
    index: int | None = Field(default=None, ge=0, le=19)


@router.post(
    "/{course_id}/sources/confirm",
    summary="Подтвердить референс / ссылку на приказ",
    description=(
        "Методист принимает источник вручную. Статус confirmed пишется в payload курса "
        "и в таблицу sources. Автоподтверждение файла методиста и успешного probe "
        "делается при сохранении и в UI без этого метода."
    ),
    operation_id="confirmCourseSource",
)
def confirm_course_source(
    course_id: str,
    request: ConfirmSourceRequest,
    session: Session = Depends(get_db),
) -> dict[str, Any]:
    record = session.scalar(
        select(CourseRecord).where(CourseRecord.id == course_id).with_for_update()
    )
    if record is None:
        raise HTTPException(status_code=404, detail="Курс не найден.")
    version = _latest_version(session, course_id)
    if version is None or not isinstance(version.payload, dict):
        raise HTTPException(status_code=404, detail="У курса нет сохранённой версии.")
    payload = dict(version.payload)
    brief = dict(payload.get("brief") or {})
    references = list(brief.get("references") or [])
    if not references:
        raise HTTPException(status_code=404, detail="В курсе нет референсов.")

    match_index: int | None = None
    if request.index is not None:
        if request.index >= len(references):
            raise HTTPException(status_code=404, detail="Референс с таким индексом не найден.")
        match_index = request.index
    else:
        for idx, item in enumerate(references):
            if not isinstance(item, dict):
                continue
            title_ok = request.title is None or str(item.get("title") or "") == request.title
            source_ok = request.source is None or str(item.get("source") or "") == request.source
            if title_ok and source_ok and (request.title is not None or request.source is not None):
                match_index = idx
                break
    if match_index is None:
        raise HTTPException(
            status_code=400,
            detail="Укажите index или пару title/source референса для подтверждения.",
        )

    item = dict(references[match_index]) if isinstance(references[match_index], dict) else {}
    item["status"] = "confirmed"
    references[match_index] = item
    brief["references"] = references
    payload["brief"] = brief

    latest = session.scalar(
        select(func.max(CourseVersion.version)).where(CourseVersion.course_id == course_id)
    )
    next_version = max(record.current_version, int(latest or 0)) + 1
    record.current_version = next_version
    session.add(
        CourseVersion(
            course_id=course_id,
            version=next_version,
            payload=payload,
            reason="confirm-source",
        )
    )

    # refresh SourceRecord rows from payload
    session.execute(delete(SourceRecord).where(SourceRecord.course_id == course_id))
    session.add_all(
        SourceRecord(
            course_id=course_id,
            title=str(ref.get("title") or "Источник"),
            source=ref.get("source"),
            note=ref.get("note"),
            status=effective_reference_status(ref),
        )
        for ref in references
        if isinstance(ref, dict)
    )
    session.commit()
    return {
        "id": course_id,
        "version": next_version,
        "index": match_index,
        "status": "confirmed",
        "title": item.get("title"),
        "source": item.get("source"),
    }



@router.delete(
    "/{course_id}",
    summary="Удалить курс",
    description="Курс, его версии, диалог и источники удаляются. Остальные курсы остаются.",
    operation_id="deleteCourse",
)
def delete_course(course_id: str, session: Session = Depends(get_db)) -> dict[str, Any]:
    record = session.get(CourseRecord, course_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Курс не найден.")
    session.execute(delete(ChatMessageRecord).where(ChatMessageRecord.course_id == course_id))
    session.execute(delete(SourceRecord).where(SourceRecord.course_id == course_id))
    session.execute(delete(CourseVersion).where(CourseVersion.course_id == course_id))
    session.delete(record)
    session.commit()
    return {"id": course_id}


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
        raise HTTPException(status_code=404, detail="Курс не найден.")
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
        raise HTTPException(status_code=404, detail="Курс не найден.")
    message = ChatMessageRecord(
        course_id=course_id,
        role=request.role,
        payload=request.payload,
    )
    session.add(message)
    session.commit()
    return {"id": message.id}
