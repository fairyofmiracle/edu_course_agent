import json
from io import BytesIO
from zipfile import ZipFile

import pytest

from backend.app.agent import assemble_local_course, fill_missing_kit
from backend.app.audit import audit_course_document
from backend.app.exports import build_artifact, build_docx
from backend.tests.test_open_cases import CASE1, CASE2

pytest.importorskip("docx")
pytest.importorskip("pptx")

ORDER_629 = "http://publication.pravo.gov.ru/document/0001202209270013"
LAW_273 = "http://publication.pravo.gov.ru/document/0001201212300007"
ORDER_266 = "http://publication.pravo.gov.ru/document/0001202504230011"


def _docx_text(course) -> str:
    with ZipFile(BytesIO(build_docx(course))) as archive:
        return archive.read("word/document.xml").decode("utf-8")


def _failures(course) -> list[str]:
    report = audit_course_document(course)
    return [
        f"{item['id']}: {item.get('details') or item['label']}"
        for item in report["items"]
        if item["status"] == "fail"
    ]


def test_python_program_ready_for_handoff() -> None:
    course = assemble_local_course([CASE1])
    brief = course.brief

    assert brief.program_kind == "general"
    assert brief.duration_hours == 16
    assert "школьник" in brief.audience
    assert sum(module.practice_hours for module in course.modules) >= 8
    assert sum(module.hours for module in course.modules) + brief.attestation_hours == 16
    assert len(course.lectures) == sum(1 for module in course.modules if module.lecture_hours > 0)
    assert {seminar.module_id for seminar in course.seminars} == {module.id for module in course.modules}
    assert {assessment.module_id for assessment in course.assessments} == {module.id for module in course.modules}
    questions = [question for assessment in course.assessments for question in assessment.questions]
    assert len(questions) == 10
    assert all(question.answer.strip() for question in questions)
    assert all(not node.labor_function_code for node in course.competencies.nodes)
    assert ORDER_629 in [reference.source for reference in brief.references]
    assert _failures(course) == []

    document = _docx_text(course)
    assert brief.title in document
    assert "Реквизиты приказа организации: ____________________" in document
    assert "Преподаватель: ____________________" in document
    assert "Подпись: ____________________" in document
    assert "№ 629" in document

    raw_json, _media, filename = build_artifact("json", course)
    payload = json.loads(raw_json)
    assert filename.endswith(".json")
    assert payload["brief"]["durationHours"] == 16
    assert payload["brief"]["programKind"] == "general"

    pptx, _media, _name = build_artifact("pptx", course)
    assert pptx[:2] == b"PK"
    with ZipFile(BytesIO(pptx)) as archive:
        slides = " ".join(
            archive.read(name).decode("utf-8")
            for name in archive.namelist()
            if name.startswith("ppt/slides/slide")
        )
    assert course.modules[0].title in slides


def test_qualification_program_keeps_current_basis() -> None:
    course = assemble_local_course([CASE2])
    sources = [reference.source for reference in course.brief.references]

    assert course.brief.program_kind == "qualification"
    assert course.brief.duration_hours == 36
    assert LAW_273 in sources
    assert ORDER_266 in sources
    assert _failures(course) == []
    report = audit_course_document(course)
    warning = next(item for item in report["items"] if item["id"] == "basis.order-499")
    assert warning["status"] == "warning"
    assert "№ 266" in (warning.get("details") or "")


def test_model_lecture_is_kept_when_gaps_are_filled() -> None:
    course = assemble_local_course([CASE1])
    phrase = "Ученик сам называет, что хранит переменная score."
    lecture = course.lectures[0]
    lecture.slides[0].bullets = [phrase, "Дальше ученик меняет это значение в программе."]
    filled = fill_missing_kit(course)
    kept = filled.lectures[0]
    assert any(phrase in bullet for slide in kept.slides for bullet in slide.bullets)


def test_acr_docx_has_dual_template_sections() -> None:
    """Оба шаблона АЦР: титул, УТП, ЗУН/навыки, выдаваемый документ, пустые реквизиты."""
    general = assemble_local_course([CASE1])
    qualification = assemble_local_course([CASE2])

    general_xml = _docx_text(general)
    qual_xml = _docx_text(qualification)

    for document in (general_xml, qual_xml):
        assert "УТВЕРЖДЕНО" in document
        assert "Магас" in document
        assert "Учебно-тематический план" in document
        assert "Навыки" in document
        assert "Контактная работа" in document
        assert "Реквизиты приказа организации: ____________________" in document
        assert "Преподаватель: ____________________" in document
        assert "Подпись: ____________________" in document

    assert "ОБЩЕРАЗВИВАЮЩАЯ" in general_xml
    assert "сертификат" in general_xml.lower()
    assert "Пояснительная записка" in general_xml

    assert "ПОВЫШЕНИЯ КВАЛИФИКАЦИИ" in qual_xml
    assert "удостоверение" in qual_xml.lower()
    assert "Трудовая функция" in qual_xml
