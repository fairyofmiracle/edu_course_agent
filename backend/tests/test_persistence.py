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
