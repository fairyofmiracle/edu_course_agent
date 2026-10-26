"""Архив сохранённой версии: файл на диске, в базе имя, путь и сумма."""

from __future__ import annotations

import hashlib
from pathlib import Path

from sqlalchemy import select

from .database import CourseArtifact, CourseRecord, Session, engine
from .models import CourseDocument

DATA_ROOT = Path(__file__).parents[1] / "data"


def remember_zip(course: CourseDocument, payload: bytes, filename: str) -> str | None:
    if not course.id:
        return None
    digest = hashlib.sha256(payload).hexdigest()
    with Session(engine) as session:
        record = session.get(CourseRecord, course.id)
        if record is None or record.current_version < 1:
            return None
        version = record.current_version
        folder = DATA_ROOT / "artifacts" / course.id / str(version)
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / filename
        path.write_bytes(payload)
        relative = path.relative_to(DATA_ROOT).as_posix()
        row = session.scalar(
            select(CourseArtifact).where(
                CourseArtifact.course_id == course.id,
                CourseArtifact.version == version,
                CourseArtifact.kind == "zip",
            )
        )
        if row is None:
            session.add(
                CourseArtifact(
                    course_id=course.id,
                    version=version,
                    kind="zip",
                    filename=filename,
                    sha256=digest,
                    path=relative,
                    byte_size=len(payload),
                )
            )
        else:
            row.filename = filename
            row.sha256 = digest
            row.path = relative
            row.byte_size = len(payload)
        session.commit()
    return digest
