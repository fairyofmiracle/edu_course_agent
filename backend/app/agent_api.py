from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .agent import approve_framework, course_report, run_turn
from .audit import audit_course_document
from .models import CourseDocument, empty_course
from .planner import content_missing

router = APIRouter(prefix="/api", tags=["agent"])

FRAMEWORK_PROMPT = "Собери только каркас программы: бриф, компетенции и учебный план."
KIT_PROMPT = "Каркас утверждён методистом. Собери недостающий комплект."


def _error_detail(error: Exception) -> str:
    message = str(error).strip()
    return f"{type(error).__name__}: {message}" if message else type(error).__name__


class RunRequest(BaseModel):
    request: str = Field(min_length=1)
    answers: str | None = None
    references: str | None = None
    autoApprove: bool = True
    caseId: int | None = Field(default=None, ge=1, le=5)


class ChatTurnRequest(BaseModel):
    course: CourseDocument
    userTexts: list[str] = Field(min_length=1)
    messages: list[dict[str, Any]] = Field(default_factory=list)
    extraReferences: str | None = None
    formBrief: dict[str, Any] | None = None


@router.post("/chat/turn")
async def chat_turn(request: ChatTurnRequest) -> dict[str, Any]:
    messages = list(request.messages)
    if not messages or messages[-1].get("role") != "user":
        messages.append({"role": "user", "content": request.userTexts[-1]})
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


@router.post("/run")
async def run_case(request: RunRequest) -> dict[str, Any]:
    course = empty_course()
    user_texts: list[str] = []
    messages: list[dict[str, Any]] = []
    transcript: list[dict[str, Any]] = []

    async def turn(text: str) -> None:
        nonlocal course, messages
        user_texts.append(text)
        messages.append({"role": "user", "content": text})
        result = await run_turn(
            course,
            user_texts=user_texts,
            model_messages=messages,
            references=request.references,
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
        if not course.modules:
            await turn(FRAMEWORK_PROMPT)
        approved_by = None
        if all(item["ok"] for item in course_report(course, asked_questions=False)["checks"]):
            if request.autoApprove:
                course = approve_framework(course)
                approved_by = "auto"
                for _ in range(4):
                    if not content_missing(course):
                        break
                    await turn(KIT_PROMPT)
        report = course_report(course, asked_questions=asked_questions)
        report["approvedBy"] = approved_by
        report["audit"] = audit_course_document(course)
        return {
            "course": course.as_api(),
            "report": report,
            "transcript": transcript,
        }
    except Exception as error:
        raise HTTPException(status_code=502, detail=_error_detail(error)) from error
