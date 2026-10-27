"""Архив сохранённой версии: файл на диске, в базе имя, путь и сумма."""

from __future__ import annotations

import hashlib
from pathlib import Path

from sqlalchemy import select

from .database import CourseArtifact, CourseRecord, Session, engine
from .models import CourseDocument

DATA_ROOT = Path(__file__).parents[1] / "data"
ARTIFACTS_ROOT = DATA_ROOT / "artifacts"


def _safe_artifact_folder(course_id: str, version: int) -> Path | None:
    """Каталог версии строго внутри ARTIFACTS_ROOT; course_id с ../ отклоняется."""
    if not course_id or course_id in {".", ".."}:
        return None
    if "/" in course_id or chr(92) in course_id or chr(0) in course_id or ".." in course_id:
        return None
    folder = (ARTIFACTS_ROOT / course_id / str(version)).resolve()
    root = ARTIFACTS_ROOT.resolve()
    if not folder.is_relative_to(root):
        return None
    return folder


def remember_zip(course: CourseDocument, payload: bytes, filename: str) -> str | None:
    if not course.id:
        return None
    safe_name = Path(filename).name
    if not safe_name or safe_name in {".", ".."}:
        return None
    if _safe_artifact_folder(course.id, 1) is None:
        return None
    digest = hashlib.sha256(payload).hexdigest()
    with Session(engine) as session:
        record = session.get(CourseRecord, course.id)
        if record is None or record.current_version < 1:
            return None
        version = record.current_version
        folder = _safe_artifact_folder(course.id, version)
        if folder is None:
            return None
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / safe_name
        path.write_bytes(payload)
        relative = path.relative_to(DATA_ROOT.resolve()).as_posix()
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
                    filename=safe_name,
                    sha256=digest,
                    path=relative,
                    byte_size=len(payload),
                )
            )
        else:
            row.filename = safe_name
            row.sha256 = digest
            row.path = relative
            row.byte_size = len(payload)
        session.commit()
    return digest
