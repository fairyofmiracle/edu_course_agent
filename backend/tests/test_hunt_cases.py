from backend.app.agent import assemble_local_course, strengthen_framework
from backend.app.models import CourseDocument
from backend.app.brief_guard import attestation_hours_from_text, volume_from_text
from backend.app.catalog import is_incomplete_brief, is_internship, profile_name, promise_notes
from backend.app.kit_content import is_teacher_ai
from backend.app.planner import missing_brief_lines


H_ARCHIVE = (
    "Нужна программа повышения квалификации в форме стажировки "
    "«Описание фондов архива» на 80 часов. Слушатели проходят стажировку "
    "в архиве региона, аудиторных занятий нет, работа самостоятельная "
    "под руководством наставника. Итоговая аттестация занимает 2 часа "
    "и проходит в форме защиты отчёта."
)
H_PANDAS_ONLY = (
    "Нужна общеразвивающая программа «Визуализация в pandas» на 32 часа, "
    "очно. Слушатели: аналитики без Excel и без банка. В конце защита проекта."
)
H_PANDAS_EXCEL = (
    "Нужна программа повышения квалификации на 36 часов «pandas для склада». "
    "Слушатели: сотрудники склада, работают в Excel. Формат очно-заочный. "
    "Защита проекта."
)
H_EMPTY = "Сделайте курс."
H_ATTEST_2 = (
    "Нужна общеразвивающая программа «Скетчинг от руки» для взрослых, "
    "24 часа, очно. Итоговая аттестация занимает 2 часа и проходит "
    "как защита проекта."
)
H_TEACHER_GIGA = (
    "Программа повышения квалификации «GigaChat в работе учителя» "
    "для учителей школ, 18 часов, очно. Итоговая аттестация — зачёт "
    "по портфолио."
)
H_1C = (
    "Нужна программа повышения квалификации «1С:ЗУП для кадровиков» "
    "на 48 часов, очно. Слушатели: сотрудники отдела кадров. "
    "Итоговая аттестация — зачёт."
)
H_CHATGPT = (
    "Нужна общеразвивающая программа «Промпты» на 16 часов, очно, "
    "для взрослых. В программе используйте ChatGPT. "
    "В конце защита проекта."
)


def _titles(course) -> str:
    return " ".join(module.title for module in course.modules).lower()


def test_cyber_without_job_promise_does_not_quote_customer() -> None:
    course = assemble_local_course(
        [
            "Нужна программа повышения квалификации «Кибербезопасность Linux» "
            "на 72 часа, очно. Слушатели: студенты 3 курса, знают сети и Linux. "
            "Итоговая аттестация — экзамен."
        ]
    )
    notes = " ".join(promise_notes(course))
    assert "пойти работать" not in notes
    assert "начальн" in notes


def test_linux_in_cyber_is_not_internship() -> None:
    course = assemble_local_course(
        [
            "Нужна программа повышения квалификации «Кибербезопасность Linux» "
            "на 72 часа, очно. Слушатели: студенты 3 курса, знают сети и Linux. "
            "Итоговая аттестация — экзамен. В программе контейнеры и анализ трафика."
        ]
    )
    assert profile_name(course) == "cyber"
    assert not is_internship(course)
    assert sum(module.lecture_hours for module in course.modules) > 0


def test_archive_internship_is_not_devops() -> None:
    course = assemble_local_course([H_ARCHIVE])
    titles = _titles(course)
    assert is_internship(course)
    assert profile_name(course) == "generic"
    assert course.brief.duration_hours == 80
    assert course.brief.attestation_hours == 2
    assert course.brief.format == "workshop"
    assert sum(module.lecture_hours for module in course.modules) == 0
    assert sum(module.self_study_hours for module in course.modules) == 78
    assert "linux" not in titles
    assert "ci/cd" not in titles
    assert "архив" in _titles(course) or "фонд" in titles or "описан" in titles or "стажиров" in titles


def test_pandas_without_excel_is_not_bank_sku() -> None:
    course = assemble_local_course([H_PANDAS_ONLY])
    assert profile_name(course) == "generic"
    assert course.brief.duration_hours == 32
    assert "отток" not in _titles(course)


def test_pandas_with_excel_is_data_profile() -> None:
    course = assemble_local_course([H_PANDAS_EXCEL])
    assert profile_name(course) == "data_analysis"
    assert "pandas" in _titles(course)


def test_empty_request_asks() -> None:
    course = assemble_local_course([H_EMPTY])
    assert is_incomplete_brief(course)
    assert course.brief.duration_hours == 0
    missing = missing_brief_lines(course)
    assert "точный объём в академических часах" in missing
    assert "тип программы" in missing


def test_attestation_hours_from_plain_text() -> None:
    assert attestation_hours_from_text([H_ATTEST_2]) == 2
    assert volume_from_text([H_ATTEST_2]) == 24
    course = assemble_local_course([H_ATTEST_2])
    assert course.brief.duration_hours == 24
    assert course.brief.attestation_hours == 2
    assert abs(sum(module.hours for module in course.modules) - 22) < 0.01


def test_teacher_gigachat_is_teacher_profile() -> None:
    course = assemble_local_course([H_TEACHER_GIGA])
    assert is_teacher_ai(course)
    assert profile_name(course) == "teacher_ai"
    assert any(node.labor_function_code == "A/01.6" for node in course.competencies.nodes)


def test_model_classroom_hours_on_internship_are_zeroed() -> None:
    course = assemble_local_course([H_ARCHIVE])
    value = course.as_api()
    value["modules"][0]["lectureHours"] = 5
    value["modules"][0]["practiceHours"] = 5
    value["modules"][0]["selfStudyHours"] = 0
    fixed = strengthen_framework(CourseDocument.model_validate(value))
    assert sum(module.lecture_hours for module in fixed.modules) == 0
    assert sum(module.practice_hours for module in fixed.modules) == 0
    assert abs(sum(module.self_study_hours for module in fixed.modules) - 78) < 0.01


def test_case5_still_devops_sku() -> None:
    from backend.tests.test_open_cases import CASE5

    course = assemble_local_course([CASE5])
    assert profile_name(course) == "internship"
    assert "linux" in _titles(course)
    assert course.brief.attestation_hours == 2
