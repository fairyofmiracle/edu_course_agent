from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .agent import approve_framework, course_report, run_turn, strengthen_framework
from .gateway_queue import QueueFull, cancel_queued_job, job_snapshot, submit_chat_job
from .audit import audit_course_document
from .catalog import is_incomplete_brief
from .cloud import CloudRuClient
from .models import CourseDocument, empty_course
from .public_errors import public_error_text
from .speech import MAX_AUDIO_BYTES, SpeechError, audio_kind, transcribe

router = APIRouter(prefix="/api", tags=["agent"])

FRAMEWORK_PROMPT = "Собери только каркас программы: бриф, компетенции и учебный план."


def _error_detail(error: Exception) -> str:
    return public_error_text(error)


class RunRequest(BaseModel):
    request: str = Field(min_length=1)
    answers: str | None = None
    references: str | None = None
    autoApprove: bool = False
    caseId: int | None = Field(default=None, ge=1, le=5)


class ChatTurnRequest(BaseModel):
    course: CourseDocument
    userTexts: list[str] = Field(min_length=1)
    messages: list[dict[str, Any]] = Field(default_factory=list)
    extraReferences: str | None = None
    formBrief: dict[str, Any] | None = None


def _job_id(value: str) -> str:
    try:
        return str(UUID(value))
    except ValueError as error:
        raise HTTPException(status_code=404, detail="Ход не найден.") from error


@router.get("/chat/jobs/{job_id}", summary="Статус хода в очереди")
def chat_job(job_id: str) -> dict[str, Any]:
    job = job_snapshot(_job_id(job_id))
    if job is None:
        raise HTTPException(status_code=404, detail="Ход не найден.")
    return job


@router.post("/chat/jobs/{job_id}/cancel", summary="Остановить ход в очереди")
def chat_job_cancel(job_id: str) -> dict[str, Any]:
    job = cancel_queued_job(_job_id(job_id))
    if job is None:
        raise HTTPException(status_code=404, detail="Ход не найден.")
    return job


@router.post(
    "/chat/turn",
    summary="Один ход диалога с методистом",
    description=(
        "Принимает текущий курс и реплики. Cloud.ru может предложить правку, "
        "но неподтверждённые часы и нормативные реквизиты отбрасывает код. "
        "Если жива очередь Redis, ответ 202 и ход забирает воркер Celery."
    ),
    operation_id="chatTurn",
)
async def chat_turn(request: ChatTurnRequest) -> dict[str, Any]:
    messages = list(request.messages)
    if not messages or messages[-1].get("role") != "user":
        messages.append({"role": "user", "content": request.userTexts[-1]})
    payload = request.model_dump(mode="json", by_alias=True)
    payload["messages"] = messages
    try:
        queued = submit_chat_job(payload)
    except QueueFull as error:
        raise HTTPException(status_code=429, detail=str(error)) from error
    if queued is not None:
        return JSONResponse(status_code=202, content=queued)
    try:
        result = await run_turn(
            request.course,
            user_texts=request.userTexts,
            model_messages=messages,
            references=request.extraReferences,
            form_brief=request.formBrief,
        )
    except Exception as error:
        raise HTTPException(status_code=502, detail=_error_detail(error)) from error
    result["course"] = result["course"].as_api()
    return result


@router.post(
    "/transcribe",
    summary="Расшифровать короткую запись",
    description=(
        "Принимает запись методиста и возвращает текст. "
        "Звук разбирает локальная GigaAM, не шлюз чата, и в студию не сохраняется."
    ),
)
async def transcribe_speech(file: UploadFile = File(...)) -> dict[str, str]:
    content_type = file.content_type or ""
    if audio_kind(content_type) is None:
        raise HTTPException(status_code=400, detail="Нужна запись webm, ogg, wav или mp3.")
    raw = await file.read(MAX_AUDIO_BYTES + 1)
    if len(raw) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=400, detail="Запись больше 8 МБ.")
    try:
        text = await transcribe(raw, content_type)
    except SpeechError as error:
        raise HTTPException(status_code=error.status, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=public_error_text(error)) from error
    if not text:
        raise HTTPException(status_code=422, detail="В записи не слышно речи.")
    return {"text": text}


@router.post(
    "/run",
    summary="Прогнать запрос до каркаса",
    description=(
        "Несколько ходов модели до каркаса. Комплект после этого собирает методист "
        "кнопкой «Утвердить каркас» в студии. autoApprove=true только для тестов "
        "и скрытых прогонов: тогда эндпоинт сам утверждает каркас и пишет комплект. "
        "Поле report.audit совпадает с правилами POST /api/audit."
    ),
    operation_id="runCase",
)
async def run_case(request: RunRequest) -> dict[str, Any]:
    course = empty_course()
    user_texts: list[str] = []
    messages: list[dict[str, Any]] = []
    transcript: list[dict[str, Any]] = []
    client = CloudRuClient()

    async def turn(text: str) -> None:
        nonlocal course, messages
        # Budget is per turn; reset before the pre-check so prior turns do not block demos.
        if hasattr(client, "begin_turn"):
            client.begin_turn()
        if not client.budget_left():
            transcript.append(
                {
                    "user": text,
                    "assistant": "Остановилась: лимит токенов на задачу.",
                    "mode": "stop",
                    "steps": [],
                    "calls": [],
                }
            )
            return
        user_texts.append(text)
        messages.append({"role": "user", "content": text})
        result = await run_turn(
            course,
            user_texts=user_texts,
            model_messages=messages,
            references=request.references,
            client=client,
        )
        course = result["course"]
        messages = result["modelMessages"]
        transcript.append(
            {
                "user": text,
                "assistant": result["assistant"],
                "mode": result["mode"],
                "steps": result["steps"],
                "calls": result["calls"],
            }
        )

    try:
        await turn(request.request.strip())
        asked_questions = not course.modules
        if asked_questions and request.answers and request.answers.strip():
            await turn(request.answers.strip())
        if not course.modules and not is_incomplete_brief(course):
            await turn(FRAMEWORK_PROMPT)
        approved_by = None
        if course.modules:
            course = strengthen_framework(course)
        if all(item["ok"] for item in course_report(course, asked_questions=False)["checks"]):
            if request.autoApprove:
                course = approve_framework(course)
                approved_by = "auto"
                transcript.append(
                    {
                        "user": "Утверждаю каркас",
                        "assistant": "Каркас утверждён. Собираю комплект: тест, лекции и семинары.",
                        "mode": "approve",
                        "steps": ["approve_framework"],
                        "calls": [],
                    }
                )
                kit = await run_turn(
                    course,
                    user_texts=user_texts or [request.request.strip()],
                    model_messages=messages,
                    references=request.references,
                    client=client,
                )
                course = kit["course"]
                messages = kit["modelMessages"]
                transcript.append(
                    {
                        "user": "Собери комплект",
                        "assistant": kit["assistant"],
                        "mode": kit["mode"],
                        "steps": kit["steps"],
                        "calls": kit["calls"],
                    }
                )
        report = course_report(course, asked_questions=asked_questions)
        report["approvedBy"] = approved_by
        report["audit"] = audit_course_document(course)
        report["usage"] = client.usage
        return {
            "course": course.as_api(),
            "report": report,
            "transcript": transcript,
            "usage": client.usage,
        }
    except Exception as error:
        raise HTTPException(status_code=502, detail=_error_detail(error)) from error
