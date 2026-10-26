"""Тесты и слайды из того же JSON курса, что и программа Word."""

from __future__ import annotations

import html
import re

from .models import CourseDocument


def _one_line(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def _gift_text(value: str) -> str:
    escaped = value.replace("\\", "\\\\")
    for char in "~=#{}":
        escaped = escaped.replace(char, f"\\{char}")
    return escaped


def course_gift(course: CourseDocument) -> str:
    title = _one_line(course.brief.title) or "Программа"
    blocks = [
        "// GIFT. Строки // Moodle при импорте отбрасывает: в них ключ открытого вопроса и результат обучения.",
    ]
    modules = {module.id: module.title for module in course.modules}
    for assessment in course.assessments:
        module_title = modules.get(assessment.module_id, assessment.module_id) or "Без названия"
        blocks.append(f"$CATEGORY: {title}/{module_title}")
        for index, question in enumerate(assessment.questions, start=1):
            name = _one_line(f"{module_title}. {index}. {question.stem}").replace(":", "—")[:180]
            stem = _gift_text(question.stem.strip())
            outcome = _one_line(question.learning_outcome)
            explanation = _one_line(question.explanation)
            if question.type == "mcq":
                correct = _one_line(question.answer)
                distractors = [
                    _one_line(option)
                    for option in (question.options or [])
                    if _one_line(option) and _one_line(option) != correct
                ]
                choices = [correct, *distractors] if correct else distractors
                lines = []
                for choice_index, choice in enumerate(choices):
                    mark = "=" if correct and choice_index == 0 else "~"
                    feedback = f" #{_gift_text(explanation)}" if correct and choice_index == 0 else ""
                    lines.append(f"{mark}{_gift_text(choice)}{feedback}")
                blocks.append(
                    "\n".join(
                        [
                            f"::{name}::",
                            stem,
                            "{",
                            *lines,
                            "}",
                            f"// Результат: {outcome}",
                            f"// Компетенция: {question.competency_id}",
                        ]
                    )
                )
            else:
                blocks.append(
                    "\n".join(
                        [
                            f"::{name}::",
                            stem,
                            "{",
                            "}",
                            f"####{_gift_text(explanation)}",
                            f"// Ключ: {_one_line(question.answer)}",
                            f"// Результат: {outcome}",
                            f"// Компетенция: {question.competency_id}",
                        ]
                    )
                )
    return "\n\n".join(blocks) + "\n"


def _csv_cell(value: str) -> str:
    text = value.replace("\r\n", "\n").replace("\r", "\n")
    if any(char in text for char in '",\n'):
        return '"' + text.replace('"', '""') + '"'
    return text


def course_csv(course: CourseDocument) -> str:
    header = [
        "module",
        "type",
        "stem",
        "option_1",
        "option_2",
        "option_3",
        "option_4",
        "option_5",
        "option_6",
        "answer",
        "explanation",
        "learning_outcome",
        "competency",
    ]
    rows = [",".join(header)]
    modules = {module.id: module.title for module in course.modules}
    for assessment in course.assessments:
        module_title = modules.get(assessment.module_id, assessment.module_id)
        for question in assessment.questions:
            options = list(question.options or [])
            options.extend([""] * (6 - len(options)))
            rows.append(
                ",".join(
                    _csv_cell(value)
                    for value in [
                        module_title,
                        question.type,
                        question.stem,
                        *options[:6],
                        question.answer,
                        question.explanation,
                        question.learning_outcome,
                        question.competency_id,
                    ]
                )
            )
    return "\ufeff" + "\n".join(rows) + "\n"


def _xml_text(value: str) -> str:
    safe = html.escape(value or "", quote=False)
    return f"<text><![CDATA[<p>{safe}</p>]]></text>"


def course_moodle_xml(course: CourseDocument) -> str:
    title = course.brief.title.strip() or "Программа"
    modules = {module.id: module.title for module in course.modules}
    blocks: list[str] = []
    for assessment in course.assessments:
        module_title = modules.get(assessment.module_id, assessment.module_id) or "Без названия"
        category = f"$course$/{title}/{module_title}"
        blocks.append(
            "  <question type=\"category\">\n"
            "    <category>\n"
            f"      {_xml_text(category)}\n"
            "    </category>\n"
            "  </question>"
        )
        for index, question in enumerate(assessment.questions, start=1):
            name = f"{module_title}. {index}. {_one_line(question.stem)}"[:250]
            if question.type == "mcq":
                correct = question.answer.strip()
                choices = [correct] if correct else []
                choices.extend(
                    option.strip()
                    for option in (question.options or [])
                    if option.strip() and option.strip() != correct
                )
                answers = "\n".join(
                    "    <answer fraction=\""
                    + ("100" if correct and choice_index == 0 else "0")
                    + "\" format=\"html\">\n"
                    + f"      {_xml_text(choice)}\n"
                    + "    </answer>"
                    for choice_index, choice in enumerate(choices)
                )
                blocks.append(
                    "  <question type=\"multichoice\">\n"
                    f"    <name>{_xml_text(name)}</name>\n"
                    f"    <questiontext format=\"html\">{_xml_text(question.stem)}</questiontext>\n"
                    f"    <generalfeedback format=\"html\">{_xml_text(question.explanation)}</generalfeedback>\n"
                    "    <defaultgrade>1</defaultgrade>\n"
                    "    <single>true</single>\n"
                    f"{answers}\n"
                    "  </question>"
                )
            else:
                blocks.append(
                    "  <question type=\"essay\">\n"
                    f"    <name>{_xml_text(name)}</name>\n"
                    f"    <questiontext format=\"html\">{_xml_text(question.stem)}</questiontext>\n"
                    f"    <generalfeedback format=\"html\">{_xml_text(question.explanation)}</generalfeedback>\n"
                    f"    <graderinfo format=\"html\">{_xml_text('Ключ: ' + question.answer)}</graderinfo>\n"
                    "  </question>"
                )
    return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<quiz>\n" + "\n".join(blocks) + "\n</quiz>\n"


def course_slides_html(course: CourseDocument) -> str:
    modules = {module.id: module.title for module in course.modules}
    sections: list[str] = []
    for lecture in course.lectures:
        module_title = html.escape(modules.get(lecture.module_id, lecture.module_id))
        for index, slide in enumerate(lecture.slides, start=1):
            bullets = "".join(f"<li>{html.escape(item)}</li>" for item in slide.bullets)
            sections.append(
                "<section class=\"slide\">"
                f"<p>{module_title} · {index}/{len(lecture.slides)}</p>"
                f"<h1>{html.escape(slide.title)}</h1>"
                f"<ul>{bullets}</ul>"
                "</section>"
            )
    title = html.escape(course.brief.title or "Слайды")
    body = "\n".join(sections) or "<p>Слайды появятся после утверждения каркаса.</p>"
    return (
        "<!doctype html><html lang=\"ru\"><head><meta charset=\"utf-8\"/>"
        f"<title>{title}</title></head><body>{body}</body></html>"
    )
