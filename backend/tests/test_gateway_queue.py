import asyncio

import pytest
from fastapi.testclient import TestClient

import backend.app.agent as agent_module
import backend.app.agent_api as agent_api_module
from backend.app.agent import run_turn
from backend.app.cloud import TurnStopped
from backend.app.gateway_queue import MemoryGateway, ModelGate, execute_chat_job
from backend.app.main import app
from backend.app.models import empty_course


def test_queue_shows_place_and_cancel() -> None:
    store = MemoryGateway()
    first = store.enqueue()
    second = store.enqueue()
    assert store.snapshot(first)["position"] == 1
    assert store.snapshot(second)["position"] == 2
    assert store.cancel(first)["status"] == "cancelled"
    assert store.snapshot(second)["position"] == 1


def test_one_slot_and_one_token_budget() -> None:
    store = MemoryGateway()
    assert store.acquire_slot(1, 0)
    assert store.acquire_slot(1, 0) is False
    store.release_slot()
    store.charge(10)
    assert store.budget_allows(10) is False
    job_id = store.enqueue()
    store.cancel(job_id)
    assert store.budget_allows(10) is True


def test_gate_stops_a_cancelled_turn() -> None:
    store = MemoryGateway()
    job_id = store.enqueue()
    assert store.begin(job_id)
    store.cancel(job_id)
    with pytest.raises(TurnStopped):
        ModelGate(store, job_id, 100, timeout=0).enter()


def test_gate_refuses_a_second_model_call(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("backend.app.gateway_queue.concurrency_limit", lambda: 1)
    store = MemoryGateway()
    job_id = store.enqueue()
    store.begin(job_id)
    gate = ModelGate(store, job_id, 100, timeout=0)
    gate.enter()
    with pytest.raises(RuntimeError, match="Очередь к шлюзу занята"):
        ModelGate(store, job_id, 100, timeout=0).enter()
    gate.leave()


def test_worker_stores_the_turn(monkeypatch: pytest.MonkeyPatch) -> None:
    store = MemoryGateway()
    job_id = store.enqueue()
    course = empty_course()

    async def fake_run(course, **_kwargs):
        return {
            "course": course,
            "assistant": "готово",
            "mode": "ask",
            "steps": [],
            "patches": [],
            "calls": [],
            "modelMessages": [],
            "usage": None,
            "gatewayRetries": [],
        }

    monkeypatch.setattr(agent_module, "run_turn", fake_run)
    execute_chat_job(
        job_id,
        {"course": course.as_api(), "userTexts": ["привет"], "messages": []},
        store,
    )
    done = store.snapshot(job_id)
    assert done is not None
    assert done["status"] == "done"
    assert done["result"]["assistant"] == "готово"
    assert done["result"]["course"]["id"] == course.id


def test_stopped_turn_is_not_replaced_by_a_local_answer() -> None:
    class Boom:
        async def complete(self, **_kwargs):
            raise TurnStopped("Ход остановлен.")

    with pytest.raises(TurnStopped):
        asyncio.run(
            run_turn(
                empty_course(),
                user_texts=["Курс по Python на 16 часов для школьников"],
                model_messages=[
                    {"role": "user", "content": "Курс по Python на 16 часов для школьников"}
                ],
                client=Boom(),
            )
        )


def test_chat_turn_returns_a_queue_ticket(monkeypatch: pytest.MonkeyPatch) -> None:
    store = MemoryGateway()

    def submit(payload):
        assert payload["userTexts"] == ["привет"]
        job_id = store.enqueue()
        return store.snapshot(job_id, with_result=False)

    monkeypatch.setattr(agent_api_module, "submit_chat_job", submit)
    monkeypatch.setattr(agent_api_module, "job_snapshot", store.snapshot)
    monkeypatch.setattr(agent_api_module, "cancel_queued_job", store.cancel)
    course = empty_course()
    with TestClient(app) as client:
        response = client.post(
            "/api/chat/turn",
            json={"course": course.as_api(), "userTexts": ["привет"], "messages": []},
        )
        assert response.status_code == 202
        body = response.json()
        assert body["status"] == "queued"
        assert body["position"] == 1
        job_id = body["jobId"]
        assert client.get(f"/api/chat/jobs/{job_id}").json()["status"] == "queued"
        assert client.post(f"/api/chat/jobs/{job_id}/cancel").json()["status"] == "cancelled"


def test_model_gate_budget_is_per_turn() -> None:
    """Each job/turn has its own spent counter; prior turns do not block the next."""
    store = MemoryGateway()
    job1 = store.enqueue()
    assert store.begin(job1)
    gate1 = ModelGate(store, job1, budget=10, timeout=0)
    gate1.charge(10)
    assert gate1.spent == 10
    with pytest.raises(RuntimeError, match="лимит токенов"):
        gate1.enter()
    store.finish(job1, {"ok": True})

    job2 = store.enqueue()
    assert store.begin(job2)
    gate2 = ModelGate(store, job2, budget=10, timeout=0)
    # Fresh turn — must enter even if store.spent still high from job1 metrics.
    gate2.enter()
    gate2.leave()
