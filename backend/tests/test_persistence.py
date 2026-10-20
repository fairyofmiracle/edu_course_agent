import json
from pathlib import Path

import pytest

pytest.importorskip("sqlalchemy")

from fastapi.testclient import TestClient

from backend.app.main import app

FIXTURE = Path(__file__).parents[2] / "fixtures" / "course-contract.json"


def test_course_versions_and_messages_are_persisted() -> None:
    course = json.loads(FIXTURE.read_text(encoding="utf-8"))
    client = TestClient(app)
    saved = client.put(
        f"/api/courses/{course['id']}",
        json={
            "course": course,
            "messages": [{"role": "user", "parts": [{"type": "text", "text": "Курс"}]}],
            "reason": "contract-test",
        },
    )
    assert saved.status_code == 200
    loaded = client.get(f"/api/courses/{course['id']}")
    assert loaded.status_code == 200
    assert loaded.json()["course"]["brief"]["durationHours"] == 16
    assert loaded.json()["messages"][0]["role"] == "user"

    listed = client.get("/api/courses")
    assert listed.status_code == 200
    listed_course = next(item for item in listed.json()["courses"] if item["id"] == course["id"])
    assert listed_course["durationHours"] == 16
    assert listed_course["audience"] == course["brief"]["audience"]

    copied = client.post(f"/api/courses/{course['id']}/copy")
    assert copied.status_code == 200
    copy_body = copied.json()
    assert copy_body["course"]["id"] != course["id"]
    assert copy_body["course"]["brief"]["title"].endswith("— копия")
    assert copy_body["course"]["brief"]["audience"] == course["brief"]["audience"]
    assert copy_body["course"]["brief"]["durationHours"] == 16

    original = client.get(f"/api/courses/{course['id']}")
    assert original.json()["course"]["brief"]["title"] == course["brief"]["title"]
    assert original.json()["messages"][0]["role"] == "user"
    assert original.json()["course"]["id"] == course["id"]


def test_delete_course_removes_one_and_keeps_the_other() -> None:
    course = json.loads(FIXTURE.read_text(encoding="utf-8"))
    other = json.loads(FIXTURE.read_text(encoding="utf-8"))
    course["id"] = "delete-me-test"
    other["id"] = "keep-me-test"
    client = TestClient(app)
    for item in (course, other):
        saved = client.put(
            f"/api/courses/{item['id']}",
            json={"course": item, "messages": [{"role": "user", "parts": []}], "reason": "delete-test"},
        )
        assert saved.status_code == 200

    missing = client.delete("/api/courses/missing-course")
    assert missing.status_code == 404

    deleted = client.delete(f"/api/courses/{course['id']}")
    assert deleted.status_code == 200
    assert deleted.json()["id"] == course["id"]
    assert client.get(f"/api/courses/{course['id']}").status_code == 404

    listed = {item["id"] for item in client.get("/api/courses").json()["courses"]}
    assert course["id"] not in listed
    assert other["id"] in listed
    client.delete(f"/api/courses/{other['id']}")


def test_save_rejects_mismatched_id_and_missing_course() -> None:
    course = json.loads(FIXTURE.read_text(encoding="utf-8"))
    client = TestClient(app)
    mismatched = client.put("/api/courses/other-id", json={"course": course})
    assert mismatched.status_code == 400
    assert client.get("/api/courses/missing-course").status_code == 404
    assert client.get("/api/courses/missing-course/versions").status_code == 404
    assert client.post("/api/courses/missing-course/copy").status_code == 404
    assert client.post(
        "/api/courses/missing-course/messages",
        json={"role": "user", "payload": {"text": "привет"}},
    ).status_code == 404


def test_versions_and_appended_message() -> None:
    course = json.loads(FIXTURE.read_text(encoding="utf-8"))
    course["id"] = "versioned-course"
    client = TestClient(app)
    first = client.put(
        f"/api/courses/{course['id']}",
        json={"course": course, "reason": "first"},
    )
    assert first.status_code == 200
    course["brief"]["title"] = ""
    second = client.put(
        f"/api/courses/{course['id']}",
        json={"course": course, "reason": "retitle"},
    )
    assert second.status_code == 200
    versions = client.get(f"/api/courses/{course['id']}/versions")
    assert versions.status_code == 200
    assert [item["reason"] for item in versions.json()["versions"]] == ["retitle", "first"]
    added = client.post(
        f"/api/courses/{course['id']}/messages",
        json={"role": "assistant", "payload": {"text": "каркас готов"}},
    )
    assert added.status_code == 200
    assert added.json()["id"]
    copied = client.post(f"/api/courses/{course['id']}/copy")
    assert copied.status_code == 200
    assert copied.json()["course"]["brief"]["title"].endswith("— копия")
    client.delete(f"/api/courses/{course['id']}")
    client.delete(f"/api/courses/{copied.json()['id']}")


def test_save_rejects_stale_expected_version() -> None:
    course = json.loads(FIXTURE.read_text(encoding="utf-8"))
    course["id"] = "locked-course"
    client = TestClient(app)
    first = client.put(
        f"/api/courses/{course['id']}",
        json={"course": course, "reason": "first", "expectedVersion": 0},
    )
    assert first.status_code == 200
    assert first.json()["version"] == 1
    stale = client.put(
        f"/api/courses/{course['id']}",
        json={"course": course, "reason": "stale", "expectedVersion": 0},
    )
    assert stale.status_code == 409
    fresh = client.put(
        f"/api/courses/{course['id']}",
        json={"course": course, "reason": "fresh", "expectedVersion": 1},
    )
    assert fresh.status_code == 200
    assert fresh.json()["version"] == 2
    client.delete(f"/api/courses/{course['id']}")


def test_save_with_messages_moves_past_an_existing_version() -> None:
    from sqlalchemy.orm import Session

    from backend.app.database import CourseRecord, engine

    course = json.loads(FIXTURE.read_text(encoding="utf-8"))
    course["id"] = "version-gap-course"
    client = TestClient(app)
    first = client.put(
        f"/api/courses/{course['id']}",
        json={
            "course": course,
            "messages": [{"role": "user", "parts": []}],
            "reason": "first",
        },
    )
    assert first.status_code == 200
    with Session(engine) as session:
        record = session.get(CourseRecord, course["id"])
        assert record is not None
        record.current_version = 0
        session.commit()
    second = client.put(
        f"/api/courses/{course['id']}",
        json={
            "course": course,
            "messages": [{"role": "user", "parts": []}],
            "reason": "again",
        },
    )
    assert second.status_code == 200
    assert second.json()["version"] == first.json()["version"] + 1
    client.delete(f"/api/courses/{course['id']}")


def test_old_versions_are_pruned_to_twenty() -> None:
    course = json.loads(FIXTURE.read_text(encoding="utf-8"))
    course["id"] = "prune-course"
    client = TestClient(app)
    for index in range(21):
        course["brief"]["title"] = f"Версия {index}"
        saved = client.put(
            f"/api/courses/{course['id']}",
            json={"course": course, "reason": f"v{index}"},
        )
        assert saved.status_code == 200
    reasons = [
        item["reason"] for item in client.get(f"/api/courses/{course['id']}/versions").json()["versions"]
    ]
    assert len(reasons) == 20
    assert reasons[0] == "v20"
    assert "v0" not in reasons
    client.delete(f"/api/courses/{course['id']}")
