from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl


class ContractModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")


class HealthResponse(BaseModel):
    status: Literal["ok"] = Field(description="Сервис принимает запросы.")
    service: Literal["edu-course-python"]


class AuditQuestion(ContractModel):
    stem: str = Field(default="", description="Формулировка вопроса.")
    answer: str = Field(
        default="",
        description="Ключ ответа. Пустой ключ — ошибка аудита.",
    )
    learning_outcome: str = Field(
        default="",
        alias="learningOutcome",
        description="Дословный результат обучения из модуля.",
    )


class AuditTask(ContractModel):
    learning_outcome: str = Field(
        default="",
        alias="learningOutcome",
        description="Дословный результат обучения, который закрывает задание.",
    )


class AuditModule(ContractModel):
    id: str = ""
    title: str = ""
    hours: float = Field(default=0, description="Объём модуля, академические часы с шагом 0,5.")
    lecture_hours: float = Field(default=0, alias="lectureHours")
    practice_hours: float = Field(default=0, alias="practiceHours")
    lab_hours: float = Field(default=0, alias="labHours")
    self_study_hours: float = Field(default=0, alias="selfStudyHours")
    learning_outcomes: list[str] = Field(default_factory=list, alias="learningOutcomes")


class AuditBrief(ContractModel):
    title: str = ""
    audience: str = ""
    program_kind: str = Field(
        default="unset",
        alias="programKind",
        description="general — общеразвивающая, qualification — повышение квалификации.",
    )
    duration_hours: float = Field(
        default=0,
        alias="durationHours",
        description="Общий объём программы, академические часы с шагом 0,5.",
    )
    attestation_hours: float = Field(
        default=0,
        alias="attestationHours",
        description="Часы аттестации внутри общего объёма, шаг 0,5.",
    )
    references: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Источники методиста. Пустой список даёт предупреждение, а не подтверждение.",
    )


class AuditCourse(ContractModel):
    """Неполный курс тоже принимается: аудит сообщает, чего не хватает, и не вызывает модель."""

    brief: AuditBrief = Field(default_factory=AuditBrief)
    modules: list[AuditModule] = Field(default_factory=list)
    lectures: list[dict[str, Any]] = Field(default_factory=list)
    seminars: list[dict[str, Any]] = Field(default_factory=list)
    assessments: list[dict[str, Any]] = Field(default_factory=list)
    competencies: dict[str, Any] = Field(default_factory=dict)


class AuditItem(BaseModel):
    id: str
    label: str
    status: Literal["pass", "warning", "fail"]
    section: Literal["framework", "content", "sources", "freshness"]
    details: str | None = None


class AuditSummary(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    passed: int = Field(alias="pass")
    warning: int
    fail: int


class AuditReport(BaseModel):
    summary: AuditSummary
    items: list[AuditItem]


class RegulatoryClaim(BaseModel):
    title: str = Field(min_length=1, max_length=500, description="Название документа как в источнике.")
    authority: str = Field(min_length=1, max_length=200, description="Орган, издавший документ.")
    number: str | None = Field(default=None, max_length=80, description="Номер приказа или документа.")
    date: str | None = Field(default=None, max_length=40, description="Дата документа.")
    source: HttpUrl | None = Field(
        default=None,
        description="Проверяемая ссылка. Без неё реквизиты остаются неподтверждёнными.",
    )


class RegulatoryCheckRequest(BaseModel):
    claims: list[RegulatoryClaim] = Field(default_factory=list, max_length=50)


class RegulatoryCheckResult(RegulatoryClaim):
    status: Literal["source_attached", "unconfirmed"]
    message: str
    site: Literal["reachable", "unavailable", "not_found", "blocked", "not_checked"] = "not_checked"
    site_message: str = Field(default="", alias="siteMessage")


class RegulatoryCheckResponse(BaseModel):
    results: list[RegulatoryCheckResult]


class RegulatoryPolicy(BaseModel):
    authorities: list[str]
    rules: list[str]


class SourceProbeRequest(BaseModel):
    urls: list[str] = Field(default_factory=list, max_length=20)


class SourceProbeHit(BaseModel):
    url: str
    state: Literal["reachable", "unavailable", "not_found", "blocked", "not_checked"]
    message: str
    fingerprint: str = Field(
        default="",
        description="Отметка страницы: ETag, Last-Modified и хеш первых 64 КБ. Текст ответа сюда не входит.",
    )


class SourceProbeResponse(BaseModel):
    results: list[SourceProbeHit]


class StackFreshnessRequest(BaseModel):
    texts: list[str] = Field(
        default_factory=list,
        max_length=80,
        description="Фрагменты программы, в которых может быть названа версия инструмента.",
    )


class StackFreshnessHit(BaseModel):
    id: str
    label: str
    status: Literal["supported", "eol", "unknown", "unavailable"]
    place: str
    detail: str
    source: str


class StackFreshnessResponse(BaseModel):
    state: Literal["empty", "ready"]
    source: str
    hits: list[StackFreshnessHit]
