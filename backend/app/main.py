from __future__ import annotations

from contextlib import asynccontextmanager
import os
import uuid

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .access import access_denied, request_allowed
from .logging_setup import configure_logging, request_id_var
from .agent_api import router as agent_router
from .export_api import router as export_router
from .identity import router as identity_router
from .audit import audit_course
from .legal_basis import is_official_publication
from .contracts import (
    AuditCourse,
    AuditReport,
    MeaningReviewRequest,
    MeaningReviewResponse,
    HealthResponse,
    RegulatoryCheckRequest,
    RegulatoryCheckResponse,
    RegulatoryPolicy,
    SourceProbeRequest,
    SourceProbeResponse,
    StackFreshnessRequest,
    StackFreshnessResponse,
)
from .source_probe import probe_url, probe_urls
from .stack_freshness import check_stack

configure_logging()

try:
    from .database import init_database
    from .persistence import router as courses_router
except ModuleNotFoundError as error:
    if error.name != "sqlalchemy":
        raise
    init_database = None
    courses_router = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    if init_database is not None:
        init_database()
    yield


app = FastAPI(
    title="Студия методиста",
    version="0.1.0",
    summary="API каркаса программы, аудита и нормативных источников.",
    description=(
        "Формальные проверки выполняет код. Модель Cloud.ru предлагается только "
        "маршрутами агента и не подтверждает часы, ключи и нормативные реквизиты.\n\n"
        "Академические часы принимаются с шагом 0,5. У тестового вопроса обязательны "
        "ключ и результат обучения, дословно совпадающий с результатом модуля."
    ),
    lifespan=lifespan,
    root_path=os.getenv("ROOT_PATH", ""),
    openapi_tags=[
        {"name": "service", "description": "Проверка, что процесс отвечает."},
        {
            "name": "audit",
            "description": "Детерминированный отчёт без обращения к модели.",
        },
        {
            "name": "regulatory",
            "description": "Наличие источника. Маршрут не объявляет документ действующим.",
        },
        {
            "name": "agent",
            "description": "Один ход диалога и полный прогон запроса через Cloud.ru.",
        },
        {
            "name": "courses",
            "description": "Сохранение версии курса, сообщений и приложенных источников.",
        },
        {
            "name": "export",
            "description": "Серверная выдача JSON, DOCX и PPTX. Браузер файл не собирает.",
        },
        {
            "name": "identity",
            "description": (
                "Дорожная карта входа. JWT несёт роль методиста. "
                "Курсы, аудит и выгрузку этот токен не открывает: "
                "их по-прежнему открывает STUDIO_API_TOKEN."
            ),
        },
    ],
)
def cors_origins() -> list[str]:
    origins = [
        "http://localhost:3000",
        "http://localhost:3010",
        "http://localhost:8000",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3010",
        "http://127.0.0.1:8000",
    ]
    for item in os.getenv("STUDIO_CORS_ORIGINS", "").split(","):
        origin = item.strip().rstrip("/")
        if origin.startswith("http://") or origin.startswith("https://"):
            origins.append(origin)
    return origins


@app.middleware("http")
async def studio_network_gate(request, call_next):
    if not request_allowed(request):
        return access_denied()
    rid = request.headers.get("x-request-id") or str(uuid.uuid4())
    token = request_id_var.set(rid)
    try:
        response = await call_next(request)
        response.headers["x-request-id"] = rid
        return response
    finally:
        request_id_var.reset(token)


app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Request-Id"],
)
if courses_router is not None:
    app.include_router(courses_router)
app.include_router(agent_router)
app.include_router(export_router)
app.include_router(identity_router)


@app.exception_handler(RequestValidationError)
async def invalid_contract(_request, _error: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={"detail": "Запрос не подходит под контракт. Проверьте поля и повторите."},
    )


@app.get(
    "/health",
    response_model=HealthResponse,
    tags=["service"],
    summary="Проверка живости",
    operation_id="health",
)
def health() -> HealthResponse:
    from urllib.parse import urlsplit

    from .cloud import CloudRuClient

    configured = False
    host = ""
    try:
        client = CloudRuClient()
        configured = bool(client.api_key)
        host = urlsplit(client.base_url).hostname or ""
    except Exception:
        configured = False
        host = ""
    return HealthResponse(
        status="ok",
        service="edu-course-python",
        llm_configured=configured,
        llm_host=host,
        exports=["json", "docx", "pptx", "zip", "moodle", "gift", "csv", "html"],
    )


@app.post(
    "/api/audit",
    response_model=AuditReport,
    tags=["audit"],
    summary="Проверить программу без модели",
    description=(
        "Сверяет шаблон, сумму часов и шаг 0,5. Для каждого вопроса требует ключ "
        "и результат обучения из модуля. Каждый результат должен закрываться и тестом, "
        "и практическим заданием. Источник без файла или ссылки остаётся предупреждением."
    ),
    operation_id="auditCourse",
)
def audit(course: AuditCourse) -> AuditReport:
    return AuditReport.model_validate(audit_course(course.model_dump(by_alias=True)))



@app.post(
    "/api/audit/meaning-review",
    response_model=MeaningReviewResponse,
    tags=["audit"],
    summary="Опциональное LLM-ревью смысла",
    description=(
        "Краткие замечания по связности с ЦА, пробелам и противоречиям. "
        "Без ключа шлюза возвращает status=disabled и не считается ошибкой выгрузки."
    ),
    operation_id="meaningReview",
)
async def meaning_review(request: MeaningReviewRequest) -> MeaningReviewResponse:
    from .cloud import CloudRuClient

    course = request.course.model_dump(by_alias=True)
    try:
        client = CloudRuClient()
    except Exception:
        return MeaningReviewResponse(
            status="disabled",
            notes=[],
            details="Шлюз недоступен — LLM-ревью смысла пропущено.",
        )
    if not client.api_key:
        return MeaningReviewResponse(
            status="disabled",
            notes=[],
            details="Ключ LLM не задан — ревью смысла выключено (disabled, не ошибка).",
        )

    brief = course.get("brief") or {}
    modules = course.get("modules") or []
    sketch_parts = [
        f"Название: {brief.get('title') or ''}",
        f"Аудитория: {brief.get('audience') or ''}",
        f"Цели: {'; '.join(brief.get('goals') or [])}",
    ]
    for module in modules[:6]:
        sketch_parts.append(
            f"Модуль {module.get('title')}: темы {', '.join((module.get('topics') or [])[:4])}; "
            f"результаты {', '.join((module.get('learningOutcomes') or [])[:3])}"
        )
    sketch = "\n".join(sketch_parts)[:3500]
    system = (
        "Ты методист-ревьюер ДПО/АЦР. Дай 3–6 коротких замечаний по смыслу программы: "
        "связность с целевой аудиторией, пробелы, противоречия часов/тем. "
        "Ответь обычным текстом, каждый пункт с новой строки, без JSON и без выдуманных НПА."
    )
    try:
        client.begin_turn()
        message = await client.complete(
            system=system,
            messages=[{"role": "user", "content": sketch}],
            tools=[],
            tool_choice="none",
            max_tokens=500,
            timeout=60,
            attempts=2,
        )
        content = str(message.get("content") or "").strip()
        notes = [line.strip(" -•\t") for line in content.splitlines() if line.strip()]
        notes = [n for n in notes if len(n) > 8][:8]
        if not notes:
            return MeaningReviewResponse(
                status="pass",
                notes=["Замечаний по смыслу модель не сформулировала."],
                details="Ответ модели пуст или слишком краток.",
            )
        status = "warning" if notes else "pass"
        return MeaningReviewResponse(status=status, notes=notes, details="LLM-ревью выполнено.")
    except Exception as error:
        return MeaningReviewResponse(
            status="disabled",
            notes=[],
            details=f"LLM-ревью недоступно: {error}. Выгрузку не блокирует.",
        )

@app.post(
    "/api/regulatory/check",
    response_model=RegulatoryCheckResponse,
    tags=["regulatory"],
    summary="Проверить наличие источника",
    description=(
        "Ссылку открывает сервер и смотрит только код ответа. Текст приказа не сохраняется. "
        "confirmed ставится, если сайт ответил и реквизиты заполнены (или официальная публикация). "
        "Недоступный сайт оставляет документ неподтверждённым."
    ),
    operation_id="checkRegulatorySources",
)
def check_regulatory_sources(
    request: RegulatoryCheckRequest,
) -> RegulatoryCheckResponse:
    results = []
    for claim in request.claims:
        probe = (
            probe_url(str(claim.source), expect=claim.number or "")
            if claim.source is not None
            else {
                "state": "not_checked",
                "message": "Ссылки нет. Сайт не открывали, документ не подтверждён.",
                "requisites": "unchecked",
            }
        )
        site_ok = probe["state"] == "reachable"
        official = is_official_publication(str(claim.source or ""))
        filled = bool(claim.number and claim.date)
        requisites = probe.get("requisites")
        number_on_page = requisites == "found"
        source_attached = site_ok and ((official) or (filled and number_on_page))
        if official and site_ok:
            message = "Официальное опубликование ответило. Текст приказа со страницы не забираем."
        elif site_ok and filled and requisites == "missing":
            message = "Сайт ответил, но номер документа на странице не найден. Источник не подтверждён."
        elif source_attached:
            message = "Сайт ответил, номер документа на странице есть. Действующим приказ признаёт методист."
        else:
            message = probe["message"]
        results.append(
            {
                **claim.model_dump(mode="json"),
                "status": "confirmed" if source_attached else "unconfirmed",
                "message": message,
                "site": probe["state"],
                "siteMessage": probe["message"],
            }
        )
    return RegulatoryCheckResponse.model_validate({"results": results})


@app.post(
    "/api/sources/probe",
    response_model=SourceProbeResponse,
    tags=["regulatory"],
    summary="Открыть ссылки источников",
    description=(
        "Проверяет, отвечает ли сайт. Тело страницы не сохраняется. "
        "Недоступность сайта не превращается в вывод, что приказ отменён или действует."
    ),
    operation_id="probeSources",
)
def probe_sources(request: SourceProbeRequest) -> SourceProbeResponse:
    return SourceProbeResponse.model_validate(
        {"results": probe_urls(request.urls[:20], expect=request.expect)}
    )


@app.post(
    "/api/stack/freshness",
    response_model=StackFreshnessResponse,
    tags=["regulatory"],
    summary="Сверить версии инструментов со сроком поддержки",
    description=(
        "Ищет в тексте программы версии Python, Java, Node.js и соседних продуктов "
        "и спрашивает каталог endoflife.date. Ответ сайта не сохраняется. "
        "Если сайт не ответил, срок поддержки остаётся неподтверждённым."
    ),
    operation_id="checkStackFreshness",
)
def stack_freshness(request: StackFreshnessRequest) -> StackFreshnessResponse:
    return StackFreshnessResponse.model_validate(
        check_stack([text[:500] for text in request.texts[:80]])
    )


@app.get(
    "/api/regulatory/policy",
    response_model=RegulatoryPolicy,
    tags=["regulatory"],
    summary="Правила работы с нормативными документами",
    operation_id="regulatoryPolicy",
)
def regulatory_policy() -> RegulatoryPolicy:
    return RegulatoryPolicy(
        authorities=[
            "Минпросвещения России",
            "Минобрнауки России",
            "Минтруд России",
            "Правительство Российской Федерации",
        ],
        rules=[
            "Использовать только документы из файлов методиста или проверяемых ссылок.",
            "Не придумывать номера, даты, названия приказов и коды профстандартов.",
            "Общеразвивающая программа опирается на приказ Минпросвещения от 27.07.2022 № 629. Повышение квалификации опирается на 273-ФЗ и приказ Минобрнауки от 24.03.2025 № 266.",
            "Приказ Минобрнауки от 01.07.2013 № 499 утратил силу с 01.09.2025. Методист подтверждает, какой порядок оставить в программе.",
            "Реквизиты приказа организации, ФИО преподавателей и подпись заполняет методист.",
            "Неподтверждённые реквизиты помечать и не переносить в итоговый DOCX.",
            "Текст приказа не скачивать в студию. В момент проверки открывать ссылку и запоминать только отметку страницы.",
            "Если отметка страницы изменилась, предупредить методиста. Изменение страницы само по себе не означает новый приказ.",
            "Если сайт не ответил, документ остаётся неподтверждённым.",
            "Финальное решение о применимости документа принимает методист.",
        ],
    )
