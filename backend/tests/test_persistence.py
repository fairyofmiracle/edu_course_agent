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
