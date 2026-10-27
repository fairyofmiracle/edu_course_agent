"""Очередь ходов к шлюзу. Без REDIS_URL ход остаётся в процессе API."""

from __future__ import annotations

import asyncio
import json
import logging
import threading
import time
import uuid
from typing import Any, Protocol

from celery import Celery
from celery.signals import worker_ready

from .cloud import CloudRuClient, TurnStopped, configured, setting
from .models import CourseDocument
from .public_errors import public_error_text

log = logging.getLogger("studio.queue")

WAIT_KEY = "studio:wait"
RUNNING_KEY = "studio:running"
SPENT_KEY = "studio:spent"
SLOTS_KEY = "studio:slots"
BEAT_KEY = "studio:worker:beat"
JOB_PREFIX = "studio:job:"
STALE_SECONDS = 16 * 60
BEAT_SECONDS = 20


class QueueFull(RuntimeError):
    """Очередь ходов переполнена — клиенту 429, без fallback в API."""


def queue_limit() -> int:
    raw = setting("GATEWAY_MAX_QUEUE") or "40"
    try:
        return max(1, int(raw))
    except ValueError:
        return 40


def concurrency_limit() -> int:
    raw = setting("GATEWAY_CONCURRENCY") or "2"
    try:
        return max(1, int(raw))
    except ValueError:
        return 2


def public_job(job: dict[str, Any], position: int, *, with_result: bool) -> dict[str, Any]:
    body: dict[str, Any] = {
        "jobId": job["id"],
        "status": job["status"],
        "position": position,
    }
    if job.get("error"):
        body["error"] = job["error"]
    if with_result and job["status"] == "done":
        body["result"] = job.get("result")
    return body


class GatewayState(Protocol):
    def enqueue(self) -> str: ...

    def snapshot(self, job_id: str, *, with_result: bool = True) -> dict[str, Any] | None: ...

    def begin(self, job_id: str) -> bool: ...

    def finish(self, job_id: str, result: dict[str, Any]) -> None: ...

    def fail(self, job_id: str, message: str) -> None: ...

    def cancel(self, job_id: str) -> dict[str, Any] | None: ...

    def cancelled(self, job_id: str) -> bool: ...

    def budget_allows(self, budget: int) -> bool: ...

    def charge(self, tokens: int) -> None: ...

    def acquire_slot(self, limit: int, timeout: float) -> bool: ...

    def release_slot(self) -> None: ...

    def worker_alive(self) -> bool: ...

    def touch_heartbeat(self) -> None: ...


class MemoryGateway:
    """Та же очередь в памяти процесса. Ей пользуются тесты, не Docker."""

    def __init__(self) -> None:
        self.jobs: dict[str, dict[str, Any]] = {}
        self.wait: list[str] = []
        self.running: set[str] = set()
        self.spent = 0
        self.slots = 0
        self.beat: float | None = None
        self._lock = threading.Lock()

    def enqueue(self) -> str:
        with self._lock:
            self._sweep()
            if len(self.wait) >= queue_limit():
                raise QueueFull(
                    f"Очередь к модели переполнена ({queue_limit()} ожидают). Подождите и повторите."
                )
            job_id = str(uuid.uuid4())
            self.jobs[job_id] = {"id": job_id, "status": "queued", "error": "", "result": None}
            self.wait.append(job_id)
            return job_id

    def snapshot(self, job_id: str, *, with_result: bool = True) -> dict[str, Any] | None:
        with self._lock:
            self._sweep()
            job = self.jobs.get(job_id)
            if job is None:
                return None
            position = self.wait.index(job_id) + 1 if job_id in self.wait else 0
            return public_job(job, position, with_result=with_result)

    def begin(self, job_id: str) -> bool:
        with self._lock:
            job = self.jobs.get(job_id)
            if job is None or job["status"] != "queued":
                return False
            job["status"] = "running"
            job["startedAt"] = time.time()
            if job_id in self.wait:
                self.wait.remove(job_id)
            self.running.add(job_id)
            return True

    def finish(self, job_id: str, result: dict[str, Any]) -> None:
        with self._lock:
            job = self.jobs.get(job_id)
            self.running.discard(job_id)
            if job is None or job["status"] in {"cancelled", "error"}:
                self._maybe_reset()
                return
            job["status"] = "done"
            job["result"] = result
            self._maybe_reset()

    def fail(self, job_id: str, message: str) -> None:
        with self._lock:
            job = self.jobs.get(job_id)
            self.running.discard(job_id)
            if job_id in self.wait:
                self.wait.remove(job_id)
            if job is None or job["status"] == "cancelled":
                self._maybe_reset()
                return
            job["status"] = "error"
            job["error"] = message
            self._maybe_reset()

    def cancel(self, job_id: str) -> dict[str, Any] | None:
        with self._lock:
            job = self.jobs.get(job_id)
            if job is None:
                return None
            if job["status"] in {"queued", "running"}:
                job["status"] = "cancelled"
                if job_id in self.wait:
                    self.wait.remove(job_id)
                self.running.discard(job_id)
                self._maybe_reset()
            position = self.wait.index(job_id) + 1 if job_id in self.wait else 0
            return public_job(job, position, with_result=False)

    def cancelled(self, job_id: str) -> bool:
        with self._lock:
            job = self.jobs.get(job_id)
            return job is None or job["status"] == "cancelled"

    def budget_allows(self, budget: int) -> bool:
        with self._lock:
            return self.spent < budget

    def charge(self, tokens: int) -> None:
        if tokens <= 0:
            return
        with self._lock:
            self.spent += tokens

    def acquire_slot(self, limit: int, timeout: float) -> bool:
        deadline = time.monotonic() + timeout
        while True:
            with self._lock:
                if self.slots < limit:
                    self.slots += 1
                    return True
            if time.monotonic() >= deadline:
                return False
            time.sleep(0.05)

    def release_slot(self) -> None:
        with self._lock:
            self.slots = max(0, self.slots - 1)

    def worker_alive(self) -> bool:
        with self._lock:
            return self.beat is not None and time.time() - self.beat < BEAT_SECONDS

    def touch_heartbeat(self) -> None:
        with self._lock:
            self.beat = time.time()

    def _sweep(self) -> None:
        now = time.time()
        for job_id in list(self.running):
            job = self.jobs.get(job_id)
            started = float(job.get("startedAt") or 0) if job else 0
            if job and job["status"] == "running" and now - started > STALE_SECONDS:
                job["status"] = "error"
                job["error"] = "Ход не завершился в воркере."
                self.running.discard(job_id)
        self._maybe_reset()

    def _maybe_reset(self) -> None:
        if not self.running and not self.wait and self.slots == 0:
            self.spent = 0


_ACQUIRE_SLOT = """
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if current >= tonumber(ARGV[1]) then
  return 0
end
redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], 600)
return 1
"""

_RELEASE_SLOT = """
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if current <= 0 then
  redis.call('SET', KEYS[1], 0)
  return 0
end
return redis.call('DECR', KEYS[1])
"""


class RedisGateway:
    def __init__(self, url: str) -> None:
        import redis

        self.url = url
        self.redis = redis.Redis.from_url(url, decode_responses=True)

    def enqueue(self) -> str:
        self._sweep()
        waiting = int(self.redis.llen(WAIT_KEY) or 0)
        if waiting >= queue_limit():
            raise QueueFull(
                f"Очередь к модели переполнена ({queue_limit()} ожидают). Подождите и повторите."
            )
        job_id = str(uuid.uuid4())
        self._write({"id": job_id, "status": "queued", "error": "", "result": None})
        self.redis.rpush(WAIT_KEY, job_id)
        return job_id

    def snapshot(self, job_id: str, *, with_result: bool = True) -> dict[str, Any] | None:
        self._sweep()
        job = self._read(job_id)
        if job is None:
            return None
        position = 0
        if job["status"] == "queued":
            wait = self.redis.lrange(WAIT_KEY, 0, -1)
            position = wait.index(job_id) + 1 if job_id in wait else 1
        return public_job(job, position, with_result=with_result)

    def begin(self, job_id: str) -> bool:
        job = self._read(job_id)
        if job is None or job["status"] != "queued":
            return False
        job["status"] = "running"
        job["startedAt"] = time.time()
        self._write(job)
        self.redis.lrem(WAIT_KEY, 0, job_id)
        self.redis.sadd(RUNNING_KEY, job_id)
        return True

    def finish(self, job_id: str, result: dict[str, Any]) -> None:
        job = self._read(job_id)
        self.redis.srem(RUNNING_KEY, job_id)
        if job is None or job["status"] in {"cancelled", "error"}:
            self._maybe_reset()
            return
        job["status"] = "done"
        job["result"] = result
        self._write(job)
        self._maybe_reset()

    def fail(self, job_id: str, message: str) -> None:
        job = self._read(job_id)
        self.redis.srem(RUNNING_KEY, job_id)
        self.redis.lrem(WAIT_KEY, 0, job_id)
        if job is None or job["status"] == "cancelled":
            self._maybe_reset()
            return
        job["status"] = "error"
        job["error"] = message
        self._write(job)
        self._maybe_reset()

    def cancel(self, job_id: str) -> dict[str, Any] | None:
        job = self._read(job_id)
        if job is None:
            return None
        if job["status"] in {"queued", "running"}:
            job["status"] = "cancelled"
            self._write(job)
            self.redis.lrem(WAIT_KEY, 0, job_id)
            self.redis.srem(RUNNING_KEY, job_id)
            self._maybe_reset()
        try:
            celery_app.control.revoke(job_id, terminate=False)
        except Exception:
            log.warning("не удалось снять задачу %s с брокера", job_id, exc_info=True)
        return self.snapshot(job_id, with_result=False)

    def cancelled(self, job_id: str) -> bool:
        job = self._read(job_id)
        return job is None or job["status"] == "cancelled"

    def budget_allows(self, budget: int) -> bool:
        spent = int(self.redis.get(SPENT_KEY) or 0)
        return spent < budget

    def charge(self, tokens: int) -> None:
        if tokens > 0:
            self.redis.incrby(SPENT_KEY, tokens)

    def acquire_slot(self, limit: int, timeout: float) -> bool:
        deadline = time.monotonic() + max(0, timeout)
        while True:
            if self.redis.eval(_ACQUIRE_SLOT, 1, SLOTS_KEY, limit):
                return True
            if time.monotonic() >= deadline:
                return False
            time.sleep(0.05)

    def release_slot(self) -> None:
        self.redis.eval(_RELEASE_SLOT, 1, SLOTS_KEY)

    def worker_alive(self) -> bool:
        return bool(self.redis.get(BEAT_KEY))

    def touch_heartbeat(self) -> None:
        self.redis.set(BEAT_KEY, "1", ex=BEAT_SECONDS)

    def _job_key(self, job_id: str) -> str:
        return f"{JOB_PREFIX}{job_id}"

    def _read(self, job_id: str) -> dict[str, Any] | None:
        raw = self.redis.get(self._job_key(job_id))
        if not raw:
            return None
        job = json.loads(raw)
        return job if isinstance(job, dict) else None

    def _write(self, job: dict[str, Any]) -> None:
        self.redis.set(self._job_key(job["id"]), json.dumps(job, ensure_ascii=False), ex=86_400)

    def _sweep(self) -> None:
        now = time.time()
        for job_id in self.redis.smembers(RUNNING_KEY):
            job = self._read(job_id)
            started = float(job.get("startedAt") or 0) if job else 0
            if job and job["status"] == "running" and now - started > STALE_SECONDS:
                job["status"] = "error"
                job["error"] = "Ход не завершился в воркере."
                self._write(job)
                self.redis.srem(RUNNING_KEY, job_id)
        self._maybe_reset()

    def _maybe_reset(self) -> None:
        running = int(self.redis.scard(RUNNING_KEY) or 0)
        waiting = int(self.redis.llen(WAIT_KEY) or 0)
        slots = int(self.redis.get(SLOTS_KEY) or 0)
        if running == 0 and waiting == 0 and slots == 0:
            self.redis.set(SPENT_KEY, 0)


_redis_gateway: RedisGateway | None = None


def get_store() -> RedisGateway:
    global _redis_gateway
    url = configured("REDIS_URL")
    if not url:
        raise RuntimeError("REDIS_URL не задан")
    if _redis_gateway is None or _redis_gateway.url != url:
        _redis_gateway = RedisGateway(url)
    return _redis_gateway


def _broker() -> str:
    return configured("REDIS_URL") or "redis://127.0.0.1:6379/0"


celery_app = Celery("studio", broker=_broker(), backend=_broker())
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    worker_prefetch_multiplier=1,
    task_acks_late=False,
    broker_connection_retry_on_startup=True,
)


class ModelGate:
    def __init__(self, store: GatewayState, job_id: str, budget: int, timeout: float) -> None:
        self.store = store
        self.job_id = job_id
        self.budget = budget
        self.timeout = timeout
        self.held = False
        # Per-turn (per-job) spend — do not share lifetime budget across demo turns.
        self.spent = 0

    def enter(self) -> None:
        if self.store.cancelled(self.job_id):
            raise TurnStopped("Ход остановлен.")
        if self.spent >= self.budget:
            raise RuntimeError(
                f"Достигнут лимит токенов на ход {self.budget}. Запрос к модели не отправлен."
            )
        if not self.store.acquire_slot(concurrency_limit(), self.timeout):
            raise RuntimeError("Очередь к шлюзу занята. Повторите ход.")
        self.held = True

    def charge(self, tokens: int) -> None:
        self.spent += max(0, int(tokens or 0))
        self.store.charge(tokens)

    def leave(self) -> None:
        if self.held:
            self.store.release_slot()
            self.held = False


def execute_chat_job(job_id: str, payload: dict[str, Any], store: GatewayState | None = None) -> None:
    from .agent import run_turn

    queue = store or get_store()
    if not queue.begin(job_id):
        return
    try:
        course = CourseDocument.model_validate(payload["course"])
        client = CloudRuClient()
        client.gate = ModelGate(queue, job_id, client.token_budget, timeout=180)
        result = asyncio.run(
            run_turn(
                course,
                user_texts=list(payload.get("userTexts") or []),
                model_messages=list(payload.get("messages") or []),
                references=payload.get("extraReferences"),
                form_brief=payload.get("formBrief"),
                client=client,
            )
        )
        result["course"] = result["course"].as_api()
        queue.finish(job_id, result)
    except TurnStopped:
        queue.cancel(job_id)
    except Exception as error:
        log.warning("ход %s не собран", job_id, exc_info=True)
        queue.fail(job_id, public_error_text(error))


@celery_app.task(name="studio.chat_turn")
def chat_turn_task(job_id: str, payload: dict[str, Any]) -> None:
    execute_chat_job(job_id, payload)


def submit_chat_job(payload: dict[str, Any]) -> dict[str, Any] | None:
    """Кладёт ход в Redis. None — очереди нет, API выполняет ход сам."""
    if not configured("REDIS_URL"):
        return None
    job_id = ""
    try:
        store = get_store()
        if not store.worker_alive():
            return None
        job_id = store.enqueue()
        chat_turn_task.apply_async(args=[job_id, payload], task_id=job_id)
        return store.snapshot(job_id, with_result=False)
    except QueueFull:
        raise
    except Exception:
        log.warning("ход остался в процессе API", exc_info=True)
        if job_id:
            try:
                get_store().fail(job_id, "Очередь не приняла ход.")
            except Exception:
                log.warning("не удалось закрыть ход %s", job_id, exc_info=True)
        return None


def job_snapshot(job_id: str) -> dict[str, Any] | None:
    if not configured("REDIS_URL"):
        return None
    return get_store().snapshot(job_id)


def cancel_queued_job(job_id: str) -> dict[str, Any] | None:
    if not configured("REDIS_URL"):
        return None
    return get_store().cancel(job_id)


@worker_ready.connect
def _beat_when_worker_is_up(**_kwargs: Any) -> None:
    def loop() -> None:
        while True:
            try:
                get_store().touch_heartbeat()
            except Exception:
                log.warning("воркер не записал пульс", exc_info=True)
            time.sleep(5)

    threading.Thread(target=loop, name="studio-queue-beat", daemon=True).start()
