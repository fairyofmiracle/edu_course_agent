from backend.app.models import CourseDocument, empty_course
from backend.app.reference_outline import (
    apply_file_labor_codes,
    apply_reference_hints,
    clip_text,
    compact_reference,
    outline_headings,
    title_from_reference,
    volume_from_reference,
)


SAMPLE = """«Анализ данных для банка»
Объём программы 72 академических часов
для сотрудников региональных отделений
Модуль 1. Введение в pandas и таблицы
1. Визуализация данных банка
Профессиональный стандарт 06.042
A/01.6
"""


def test_outline_skips_noise_and_clips_long_text() -> None:
    assert clip_text("коротко", 20) == "коротко"
    assert clip_text("абзац без переноса " * 20, 30).endswith("[...]")
    headings = outline_headings(
        "Модуль 1. Аб\n"
        "Модуль 2. 16 ч\n"
        "Модуль 3. итоговая строка плана\n"
        "1. Введение в pandas\n"
        "1. Введение в pandas\n"
    )
    assert headings == ["Введение в pandas"]
    assert volume_from_reference("  ") is None
    assert volume_from_reference("программа 7 часов") is None
    assert volume_from_reference("Объём программы 1024 академических часов") == 1024
    assert title_from_reference("") is None
    assert compact_reference("  ") == ""
    packed = compact_reference("16 ч\n\nМодуль 1. Введение в pandas и таблицы\nслушатели банка")
    assert "Введение в pandas" in packed


def test_reference_hints_follow_what_the_methodist_named() -> None:
    course = empty_course()
    value = course.as_api()
    value["brief"]["title"] = "Введение в pandas"
    value["brief"]["durationHours"] = 16
    value["brief"]["programKind"] = "qualification"
    value["modules"] = [
        {
            "id": "m1",
            "title": "Старый",
            "hours": 16,
            "lectureHours": 8,
            "practiceHours": 8,
            "labHours": 0,
            "selfStudyHours": 0,
            "topics": ["Тема"],
            "learningOutcomes": ["Умеет"],
            "plan": [],
            "competencyIds": ["c1"],
        }
    ]
    value["competencies"]["nodes"] = [
        {
            "id": "c1",
            "name": "Делает",
            "bloomLevel": "apply",
            "moduleIds": ["m1"],
            "knowledge": ["знает"],
            "skills": ["умеет"],
            "abilities": ["владеет"],
        }
    ]
    course = CourseDocument.model_validate(value)
    assert apply_reference_hints(course, "  ") is course

    updated = apply_reference_hints(course, SAMPLE, ["объём как в файле"])
    assert updated.brief.duration_hours == 72
    assert updated.modules == []
    assert updated.framework_approved is False
    updated = apply_reference_hints(updated, SAMPLE, ["название как в файле"])
    updated = apply_reference_hints(updated, SAMPLE, ["аудиторию как в файле"])
    updated = apply_reference_hints(updated, SAMPLE, ["разделы как в файле"])
    assert "Анализ данных" in updated.brief.title
    assert "сотрудник" in updated.brief.audience
    assert any("06.042" in (item.title or "") for item in updated.brief.references)
    assert any("Из файла по просьбе методиста" in line for line in updated.brief.constraints)

    coded = apply_file_labor_codes(updated, SAMPLE)
    assert coded.competencies.nodes[0].labor_function_code == "A/01.6"
    assert apply_file_labor_codes(coded, SAMPLE).competencies.nodes[0].labor_function_code == "A/01.6"
    plain = empty_course()
    assert apply_file_labor_codes(plain, SAMPLE) is plain
