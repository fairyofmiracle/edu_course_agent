from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .agent_api import router as agent_router
from .audit import audit_course
from .contracts import (
    AuditCourse,
    AuditReport,
    HealthResponse,
    RegulatoryCheckRequest,
    RegulatoryCheckResponse,
    RegulatoryPolicy,
)

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
    ],
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3010"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
if courses_router is not None:
    app.include_router(courses_router)
app.include_router(agent_router)


@app.get(
    "/health",
    response_model=HealthResponse,
    tags=["service"],
    summary="Проверка живости",
    operation_id="health",
)
def health() -> HealthResponse:
    return HealthResponse(status="ok", service="edu-course-python")


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
    "/api/regulatory/check",
    response_model=RegulatoryCheckResponse,
    tags=["regulatory"],
    summary="Проверить наличие источника",
    description=(
        "Статус source_attached означает, что ссылка и реквизиты заполнены. "
        "Он не означает, что документ действующий."
    ),
    operation_id="checkRegulatorySources",
)
def check_regulatory_sources(
    request: RegulatoryCheckRequest,
) -> RegulatoryCheckResponse:
    results = []
    for claim in request.claims:
        source_attached = claim.source is not None and bool(claim.number and claim.date)
        results.append(
            {
                **claim.model_dump(mode="json"),
                "status": "source_attached" if source_attached else "unconfirmed",
                "message": (
                    "Источник приложен; реквизиты всё равно подтверждает методист."
                    if source_attached
                    else "Не использовать в программе до подтверждения источником."
                ),
            }
        )
    return RegulatoryCheckResponse.model_validate({"results": results})


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
            "Неподтверждённые реквизиты помечать и не переносить в итоговый DOCX.",
            "Финальное решение о применимости документа принимает методист.",
        ],
    )
