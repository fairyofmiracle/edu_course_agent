from __future__ import annotations

from pathlib import Path

from backend.app.artifacts import (
    ARTIFACTS_ROOT,
    DATA_ROOT,
    _safe_artifact_folder,
    remember_zip,
)
from backend.app.database import CourseRecord, Session, engine
from backend.app.models import CourseDocument


def test_safe_artifact_folder_rejects_traversal() -> None:
    assert _safe_artifact_folder("..", 1) is None
    assert _safe_artifact_folder("../evil", 1) is None
    assert _safe_artifact_folder("..\\evil", 1) is None
    assert _safe_artifact_folder("a/b", 1) is None
    assert _safe_artifact_folder("a\\b", 1) is None
    assert _safe_artifact_folder("", 1) is None
    good = _safe_artifact_folder("course-safe-1", 2)
    assert good is not None
    assert good.is_relative_to(ARTIFACTS_ROOT.resolve())


def test_remember_zip_rejects_traversal_course_id(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr("backend.app.artifacts.DATA_ROOT", tmp_path)
    monkeypatch.setattr("backend.app.artifacts.ARTIFACTS_ROOT", tmp_path / "artifacts")
    outside = tmp_path / "outside.txt"
    course = CourseDocument(id="../outside-course", updatedAt="2020-01-01T00:00:00Z")
    assert remember_zip(course, b"zip-bytes", "pack.zip") is None
    assert not outside.exists()
    leaked = list(tmp_path.rglob("pack.zip"))
    assert leaked == []


def test_remember_zip_writes_inside_artifacts_root(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr("backend.app.artifacts.DATA_ROOT", tmp_path)
    monkeypatch.setattr("backend.app.artifacts.ARTIFACTS_ROOT", tmp_path / "artifacts")
    course_id = "course-safe-zip"
    with Session(engine) as session:
        existing = session.get(CourseRecord, course_id)
        if existing is None:
            session.add(CourseRecord(id=course_id, title="t", current_version=1))
        else:
            existing.current_version = 1
        session.commit()
    course = CourseDocument(id=course_id, updatedAt="2020-01-01T00:00:00Z")
    digest = remember_zip(course, b"hello-zip", "pack.zip")
    assert digest is not None
    target = (tmp_path / "artifacts" / course_id / "1" / "pack.zip").resolve()
    assert target.is_file()
    assert target.read_bytes() == b"hello-zip"
    assert target.is_relative_to((tmp_path / "artifacts").resolve())
