from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field


class ApiModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")


class Reference(ApiModel):
    title: str = Field(min_length=1, max_length=200)
    source: str | None = Field(default=None, max_length=500)
    note: str | None = Field(default=None, max_length=1500)


class Brief(ApiModel):
    title: str = Field(default="", max_length=180)
    audience: str = Field(default="", max_length=400)
    level: Literal["beginner", "intermediate", "advanced"] = "intermediate"
    duration_hours: float = Field(default=0, ge=0, le=500, alias="durationHours")
    format: Literal["lecture", "blended", "workshop"] = "blended"
    program_kind: Literal["unset", "general", "qualification"] = Field(
        default="unset", alias="programKind"
    )
    attestation_hours: float = Field(default=0, ge=0, le=80, alias="attestationHours")
    attestation_form: str = Field(default="", max_length=180, alias="attestationForm")
    goals: list[str] = Field(default_factory=list, max_length=12)
    constraints: list[str] = Field(default_factory=list, max_length=12)
    references: list[Reference] = Field(default_factory=list, max_length=20)


class CompetencyNode(ApiModel):
    id: str
    name: str
    bloom_level: Literal[
        "remember", "understand", "apply", "analyze", "evaluate", "create"
    ] = Field(alias="bloomLevel")
    module_ids: list[str] = Field(default_factory=list, alias="moduleIds")
    description: str | None = None
    knowledge: list[str] = Field(default_factory=list)
    skills: list[str] = Field(default_factory=list)
    abilities: list[str] = Field(default_factory=list)
    labor_function_code: str | None = Field(default=None, alias="laborFunctionCode")


class CompetencyEdge(ApiModel):
    from_: str = Field(alias="from")
    to: str


class CompetencyMap(ApiModel):
    nodes: list[CompetencyNode] = Field(default_factory=list)
    edges: list[CompetencyEdge] = Field(default_factory=list)


class TopicPlan(ApiModel):
    title: str
    lecture_hours: float = Field(default=0, alias="lectureHours")
    practice_hours: float = Field(default=0, alias="practiceHours")
    lab_hours: float = Field(default=0, alias="labHours")
    self_study_hours: float = Field(default=0, alias="selfStudyHours")


class CourseModule(ApiModel):
    id: str
    title: str
    hours: float
    lecture_hours: float = Field(default=0, alias="lectureHours")
    practice_hours: float = Field(default=0, alias="practiceHours")
    lab_hours: float = Field(default=0, alias="labHours")
    self_study_hours: float = Field(default=0, alias="selfStudyHours")
    topics: list[str] = Field(min_length=1, max_length=20)
    plan: list[TopicPlan] = Field(default_factory=list)
    learning_outcomes: list[str] = Field(alias="learningOutcomes", min_length=1)
    competency_ids: list[str] = Field(default_factory=list, alias="competencyIds")


class Slide(ApiModel):
    title: str
    bullets: list[str]
    mermaid: str | None = None
    visual_prompt: str | None = Field(default=None, alias="visualPrompt")
    speaker_notes: str | None = Field(default=None, alias="speakerNotes")


class Lecture(ApiModel):
    module_id: str = Field(alias="moduleId")
    duration_min: float = Field(alias="durationMin")
    outline: list[str]
    slides: list[Slide]


class SeminarTask(ApiModel):
    title: str
    prompt: str
    steps: list[str]
    time_min: float = Field(alias="timeMin")
    criteria: list[str]
    competency_id: str = Field(alias="competencyId")
    learning_outcome: str | None = Field(default=None, alias="learningOutcome")


class Seminar(ApiModel):
    module_id: str = Field(alias="moduleId")
    tasks: list[SeminarTask]


class Question(ApiModel):
    type: Literal["mcq", "open"]
    stem: str
    options: list[str] | None = None
    answer: str
    explanation: str
    competency_id: str = Field(alias="competencyId")
    learning_outcome: str | None = Field(default=None, alias="learningOutcome")


class Assessment(ApiModel):
    module_id: str = Field(alias="moduleId")
    questions: list[Question]


class CourseDocument(ApiModel):
    id: str
    updated_at: str = Field(alias="updatedAt")
    brief: Brief = Field(default_factory=Brief)
    competencies: CompetencyMap = Field(default_factory=CompetencyMap)
    modules: list[CourseModule] = Field(default_factory=list)
    lectures: list[Lecture] = Field(default_factory=list)
    seminars: list[Seminar] = Field(default_factory=list)
    assessments: list[Assessment] = Field(default_factory=list)
    framework_approved: bool = Field(default=False, alias="frameworkApproved")
    framework_fingerprint: str = Field(default="", alias="frameworkFingerprint")

    def as_api(self) -> dict[str, Any]:
        return self.model_dump(mode="json", by_alias=True)


def empty_course() -> CourseDocument:
    return CourseDocument(
        id=str(uuid4()),
        updatedAt=datetime.now(timezone.utc).isoformat(),
    )
