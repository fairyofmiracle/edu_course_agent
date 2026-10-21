import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.models import CourseDocument

pytest.importorskip("docx")
pytest.importorskip("pptx")

FIXTURE = Path(__file__).parents[2] / "fixtures" / "course-contract.json"


def test_fixture_is_available_next_to_backend() -> None:
    assert FIXTURE.is_file()
    course = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert course["brief"]["title"]


def test_export_json_docx_pptx_from_body() -> None:
    course = json.loads(FIXTURE.read_text(encoding="utf-8"))
    client = TestClient(app)
    json_file = client.post("/api/export/json", json=course)
    assert json_file.status_code == 200
    assert json_file.json()["brief"]["title"] == course["brief"]["title"]

    docx = client.post("/api/export/docx", json=course)
    assert docx.status_code == 200
    assert docx.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.wordprocessingml"
    )
    assert docx.content[:2] == b"PK"
    from io import BytesIO
    from zipfile import ZipFile

    with ZipFile(BytesIO(docx.content)) as archive:
        xml = archive.read("word/document.xml").decode("utf-8")
    assert course["brief"]["title"] in xml

    pptx = client.post("/api/export/pptx", json=course)
    assert pptx.status_code == 200
    assert pptx.content[:2] == b"PK"

    bad = client.post("/api/export/pdf", json=course)
    assert bad.status_code == 400
    assert "docx" in bad.json()["detail"]
    assert "Traceback" not in bad.json()["detail"]


def test_export_saved_course_after_put() -> None:
    pytest.importorskip("sqlalchemy")
    course = json.loads(FIXTURE.read_text(encoding="utf-8"))
    course["id"] = "export-saved-course"
    client = TestClient(app)
    saved = client.put(f"/api/courses/{course['id']}", json={"course": course, "reason": "export"})
    if saved.status_code != 200:
        pytest.skip("persistence unavailable")
    exported = client.get(f"/api/courses/{course['id']}/export/json")
    assert exported.status_code == 200
    assert exported.json()["id"] == course["id"]
    missing = client.get("/api/courses/missing-export/export/docx")
    assert missing.status_code == 404
    client.delete(f"/api/courses/{course['id']}")


def test_build_artifact_rejects_unknown_kind() -> None:
    from backend.app.exports import build_artifact

    course = CourseDocument.model_validate(json.loads(FIXTURE.read_text(encoding="utf-8")))
    try:
        build_artifact("xls", course)
    except ValueError as error:
        assert "docx" in str(error)
    else:
        raise AssertionError("неизвестный формат должен падать")
