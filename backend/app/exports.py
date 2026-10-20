from __future__ import annotations

import json
import re
from io import BytesIO
from typing import Any

from .legal_basis import required_legal_basis
from .rationale import module_rationales, result_passport
from .models import CourseDocument

FORMAT_LABELS = {
    "lecture": "очная",
    "blended": "очно-заочная",
    "workshop": "практическая",
}
KIND_MEDIA = {
    "json": "application/json",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}


def hours(value: float) -> str:
    return str(round(value * 2) / 2).replace(".", ",")


def artifact_filename(course: CourseDocument, kind: str) -> str:
    base = re.sub(r"[^\w\-]+", "-", (course.brief.title or "course").strip(), flags=re.UNICODE)
    base = base.strip("-")[:60] or "course"
    return f"{base}.{kind}"


def build_artifact(kind: str, course: CourseDocument) -> tuple[bytes, str, str]:
    fmt = kind.lower().strip()
    if fmt not in KIND_MEDIA:
        raise ValueError("Доступны форматы json, docx и pptx")
    if fmt == "json":
        payload = json.dumps(course.as_api(), ensure_ascii=False, indent=2).encode("utf-8")
    elif fmt == "docx":
        payload = build_docx(course)
    else:
        payload = build_pptx(course)
    return payload, KIND_MEDIA[fmt], artifact_filename(course, fmt)


def _program_title(kind: str) -> str:
    if kind == "qualification":
        return "ДОПОЛНИТЕЛЬНАЯ ПРОФЕССИОНАЛЬНАЯ ПРОГРАММА ПОВЫШЕНИЯ КВАЛИФИКАЦИИ"
    if kind == "general":
        return "ДОПОЛНИТЕЛЬНАЯ ОБЩЕОБРАЗОВАТЕЛЬНАЯ ОБЩЕРАЗВИВАЮЩАЯ ПРОГРАММА"
    return "ДОПОЛНИТЕЛЬНАЯ ОБРАЗОВАТЕЛЬНАЯ ПРОГРАММА"


def _basis_lines(course: CourseDocument) -> list[str]:
    lines: list[str] = []
    seen: set[str] = set()
    for document in required_legal_basis(course.brief.program_kind):
        seen.add(document["source"])
        lines.append(" · ".join(part for part in (document["title"], document["source"]) if part))
    for reference in course.brief.references:
        key = reference.source or reference.title
        if key in seen:
            continue
        seen.add(key)
        parts = [part for part in (reference.title, reference.source) if part]
        source = (reference.source or "").strip().lower()
        if source.startswith("http://") or source.startswith("https://"):
            parts.append("не подтверждён")
        lines.append(" · ".join(parts))
    return lines or ["Нормативное основание не указано."]


def _add_table(doc: Document, headers: list[str], rows: list[list[str]]) -> None:
    table = doc.add_table(rows=1 + len(rows), cols=len(headers))
    table.style = "Table Grid"
    for index, header in enumerate(headers):
        table.rows[0].cells[index].text = header
    for row_index, row in enumerate(rows, start=1):
        for col_index, value in enumerate(row):
            table.rows[row_index].cells[col_index].text = value or "—"


def build_docx(course: CourseDocument) -> bytes:
    from docx import Document
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.shared import Pt

    brief = course.brief
    doc = Document()
    style = doc.styles["Normal"]
    style.font.name = "Times New Roman"
    style.font.size = Pt(12)

    for line in (
        "Автономная некоммерческая организация дополнительного профессионального образования",
        "«Академия Информационных Технологий»",
        _program_title(brief.program_kind),
        f"«{brief.title or 'Без названия'}»",
        f"Объём: {hours(brief.duration_hours)} академических часов",
        f"Категория обучающихся: {brief.audience or '____________________'}",
        f"Форма обучения: {FORMAT_LABELS.get(brief.format, brief.format)}",
        f"Итоговая аттестация: {brief.attestation_form or '____________________'}, {hours(brief.attestation_hours)} ч.",
        "Реквизиты приказа организации: ____________________",
        "Преподаватель: ____________________",
        "Подпись: ____________________",
    ):
        paragraph = doc.add_paragraph(line)
        paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER

    doc.add_heading("1. Общая характеристика", level=1)
    for goal in brief.goals or ["Цель не заполнена."]:
        doc.add_paragraph(goal, style="List Bullet")
    doc.add_heading("Нормативные основания", level=2)
    for line in _basis_lines(course):
        doc.add_paragraph(line, style="List Bullet")

    doc.add_heading("1.1. Компетенции", level=2)
    nodes = course.competencies.nodes
    _add_table(
        doc,
        ["Компетенция", "Трудовая функция", "Знания", "Умения"],
        [
            [
                node.name,
                node.labor_function_code or "—",
                "; ".join(node.knowledge) or "—",
                "; ".join(node.skills) or "—",
            ]
            for node in nodes
        ]
        or [["—", "—", "—", "—"]],
    )

    doc.add_heading("2. Учебный план", level=1)
    plan_rows = [
        [
            str(index + 1),
            module.title,
            hours(module.hours),
            hours(module.lecture_hours),
            hours(module.practice_hours),
            hours(module.lab_hours),
            hours(module.self_study_hours),
        ]
        for index, module in enumerate(course.modules)
    ]
    plan_rows.append(
        [
            "",
            "Итоговая аттестация",
            hours(brief.attestation_hours),
            "0",
            "0",
            "0",
            "0",
        ]
    )
    _add_table(doc, ["№", "Наименование", "Всего", "ЛК", "ПР", "ЛБ", "СРС"], plan_rows)
    doc.add_heading("Паспорт результата", level=2)
    doc.add_paragraph(
        "Этот блок считает код. Формулировки лекций в него не входят и при новом прогоне модели могут отличаться."
    )
    doc.add_paragraph(result_passport(course.as_api()))
    doc.add_heading("Почему план такой", level=2)
    doc.add_paragraph(
        "Формулировки лекций при новом прогоне модели могут отличаться. "
        "Часы, результаты и связь со средствами проверки считает код."
    )
    for row in module_rationales(course.as_api()):
        doc.add_paragraph(row["text"], style="List Bullet")

    doc.add_heading("2.1. Результаты обучения", level=2)
    for module in course.modules:
        doc.add_heading(module.title, level=3)
        for outcome in module.learning_outcomes:
            doc.add_paragraph(outcome, style="List Bullet")

    doc.add_heading("Приложение 1. Оценочные материалы", level=1)
    questions = [
        (assessment.module_id, question)
        for assessment in course.assessments
        for question in assessment.questions
    ]
    if not questions:
        doc.add_paragraph("Вопросы заполняются после утверждения каркаса.")
    titles = {module.id: module.title for module in course.modules}
    for index, (module_id, question) in enumerate(questions, start=1):
        doc.add_paragraph(f"{index}. {question.stem}")
        doc.add_paragraph(f"Модуль: {titles.get(module_id, module_id)}")
        for option in question.options or []:
            doc.add_paragraph(option, style="List Bullet")
        doc.add_paragraph(f"Ключ: {question.answer}")
        doc.add_paragraph(f"Результат обучения: {question.learning_outcome}")

    doc.add_heading("Приложение 2. Практические задания", level=1)
    tasks = [
        (seminar.module_id, task)
        for seminar in course.seminars
        for task in seminar.tasks
    ]
    if not tasks:
        doc.add_paragraph("Задания заполняются после утверждения каркаса.")
    for module_id, task in tasks:
        doc.add_heading(f"{task.title} · {hours(task.time_min)} мин", level=2)
        doc.add_paragraph(f"Модуль: {titles.get(module_id, module_id)}")
        doc.add_paragraph(task.prompt)
        for step in task.steps:
            doc.add_paragraph(step, style="List Number")
        doc.add_paragraph("Критерии")
        for criterion in task.criteria:
            doc.add_paragraph(criterion, style="List Bullet")

    buffer = BytesIO()
    doc.save(buffer)
    return buffer.getvalue()


def _rgb(value: str):
    from pptx.dml.color import RGBColor

    return RGBColor.from_string(value)


def _paint(slide: Any) -> None:
    fill = slide.background.fill
    fill.solid()
    fill.fore_color.rgb = _rgb("F6F4F1")


def _rule(slide: Any, left: float, top: float, width: float = 2.2) -> None:
    from pptx.enum.shapes import MSO_SHAPE
    from pptx.util import Emu, Inches

    shape = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE, Inches(left), Inches(top), Inches(width), Emu(32000)
    )
    shape.fill.solid()
    shape.fill.fore_color.rgb = _rgb("6E2432")
    shape.line.fill.background()


def _add_textbox(
    slide: Any,
    left: float,
    top: float,
    width: float,
    height: float,
    text: str,
    size: int = 20,
    bold: bool = False,
    color: str = "1C1614",
    font: str = "Calibri",
) -> None:
    from pptx.util import Inches, Pt as PptPt

    box = slide.shapes.add_textbox(Inches(left), Inches(top), Inches(width), Inches(height))
    frame = box.text_frame
    frame.word_wrap = True
    paragraph = frame.paragraphs[0]
    run = paragraph.add_run()
    run.text = text
    run.font.size = PptPt(size)
    run.font.bold = bold
    run.font.color.rgb = _rgb(color)
    run.font.name = font


def _add_bullets(slide: Any, items: list[str]) -> None:
    from pptx.util import Inches, Pt as PptPt

    box = slide.shapes.add_textbox(Inches(0.85), Inches(2.35), Inches(11.5), Inches(4.5))
    frame = box.text_frame
    frame.word_wrap = True
    for index, item in enumerate(items[:6]):
        paragraph = frame.paragraphs[0] if index == 0 else frame.add_paragraph()
        paragraph.text = f"•  {item}"
        paragraph.level = 0
        paragraph.space_after = PptPt(12)
        paragraph.font.size = PptPt(20)
        paragraph.font.color.rgb = _rgb("1C1614")
        paragraph.font.name = "Calibri"


def build_pptx(course: CourseDocument) -> bytes:
    from pptx import Presentation
    from pptx.util import Inches

    presentation = Presentation()
    presentation.slide_width = Inches(13.333)
    presentation.slide_height = Inches(7.5)
    blank = presentation.slide_layouts[6]
    cover = presentation.slides.add_slide(blank)
    _paint(cover)
    _add_textbox(cover, 0.75, 1.35, 11.5, 0.35, "СТУДИЯ МЕТОДИСТА", 14, False, "6E2432", "Calibri")
    _add_textbox(
        cover,
        0.75,
        1.85,
        11.5,
        1.6,
        course.brief.title or "Программа",
        40,
        False,
        "1C1614",
        "Georgia",
    )
    _rule(cover, 0.75, 3.6, 2.4)
    audience = course.brief.audience.strip()
    hours = course.brief.duration_hours
    subtitle = " · ".join(
        part
        for part in (
            audience,
            f"{hours:g} ч" if hours else "",
            "Материалы лекций",
        )
        if part
    )
    _add_textbox(cover, 0.75, 3.85, 11.5, 0.6, subtitle, 18, False, "5C534C")

    lectures = course.lectures
    if not lectures:
        empty = presentation.slides.add_slide(blank)
        _paint(empty)
        _add_textbox(empty, 0.8, 3.1, 11.7, 1, "Слайды появятся после утверждения каркаса.", 22, False, "5C534C", "Georgia")

    titles = {module.id: module.title for module in course.modules}
    for lecture in lectures:
        module_title = titles.get(lecture.module_id, lecture.module_id)
        opener = presentation.slides.add_slide(blank)
        _paint(opener)
        _add_textbox(opener, 0.75, 2.35, 11.5, 0.35, "МОДУЛЬ", 14, False, "6E2432")
        _add_textbox(opener, 0.75, 2.85, 11.5, 1.4, module_title, 36, False, "1C1614", "Georgia")
        _rule(opener, 0.75, 4.45, 2.2)
        for index, slide in enumerate(lecture.slides, start=1):
            page = presentation.slides.add_slide(blank)
            _paint(page)
            _add_textbox(page, 0.75, 0.38, 10.4, 0.32, module_title, 13, False, "6E2432")
            _add_textbox(page, 11.2, 0.38, 1.3, 0.32, f"{index} / {len(lecture.slides)}", 13, False, "5C534C")
            _add_textbox(page, 0.75, 0.9, 11.7, 0.9, slide.title, 32, False, "1C1614", "Georgia")
            _rule(page, 0.75, 1.9, 1.8)
            _add_bullets(page, list(slide.bullets))

    buffer = BytesIO()
    presentation.save(buffer)
    return buffer.getvalue()
