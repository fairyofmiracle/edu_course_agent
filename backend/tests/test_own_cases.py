from backend.app.agent import assemble_local_course
from backend.app.brief_guard import audience_from_text, mentioned_hours, volume_from_text
from backend.app.catalog import is_incomplete_brief, profile_name
from backend.app.kit_content import is_intro_python, is_teacher_ai
from backend.app.models import empty_course
from backend.app.planner import intake_questions, missing_brief_lines
from backend.app.tools import execute_tool
from backend.app.domain import apply_patch


OWN1 = (
    "Нужна дополнительная общеразвивающая программа «Excel для бухгалтерии» "
    "для сотрудников бухгалтерии. Объём 24 часа, очно. В конце защита проекта: "
    "сводная таблица по учебным проводкам."
)
OWN2 = (
    "Нужна общеразвивающая программа «Python для офиса» для сотрудников "
    "бухгалтерии без опыта программирования. Объём 24 часа, очно. В конце "
    "защита проекта: мини-отчёт из таблицы."
)
OWN3 = (
    "Сделайте курс по нейросетям для методистов колледжа примерно на два месяца."
)
OWN3_ANSWERS = (
    "Тип программы: общеразвивающая. Объём 20 часов. Форма обучения очная. "
    "Итоговая аттестация: защита проекта, разбор готового промпта. "
    "Слушатели: методисты колледжа."
)
OWN4 = (
    "Нужна программа повышения квалификации «Охрана труда в серверной» на месяц, "
    "40 часов, очно. Слушатели: системные администраторы. Итоговая аттестация — "
    "зачёт. Поставьте код трудовой функции B/02.7."
)
OWN5 = (
    "Программа повышения квалификации «Цифровая грамотность учителя» для учителей "
    "школ, 36 часов, очно-заочно. Нейросети и генеративные модели в программу "
    "не входят. Итоговая аттестация — зачёт."
)


def _blob(course) -> str:
    return " ".join(
        [
            course.brief.title,
            course.brief.audience,
            course.brief.attestation_form,
            *course.brief.constraints,
            *(module.title for module in course.modules),
            *(topic for module in course.modules for topic in module.topics),
            *(" ".join(task.title for item in course.seminars for task in item.tasks),),
        ]
    ).lower()


def test_own1_excel_is_generic() -> None:
    course = assemble_local_course([OWN1])
    assert profile_name(course) == "generic"
    assert course.brief.program_kind == "general"
    assert course.brief.duration_hours == 24
    assert course.modules
    assert not any(node.labor_function_code for node in course.competencies.nodes)
    assert "чат-бот" not in _blob(course)
    assert any("сертификат" in line.lower() for line in course.brief.constraints)


def test_own2_office_python_is_not_school() -> None:
    course = assemble_local_course([OWN2])
    assert not is_intro_python(course)
    assert profile_name(course) == "generic"
    assert course.brief.duration_hours == 24
    assert "чат-бот" not in _blob(course)
    assert not any("8 занятий" in line for line in course.brief.constraints)
    assert "школьник" not in (course.brief.audience or "").lower()


def test_own3_two_months_is_not_volume() -> None:
    first = assemble_local_course([OWN3])
    assert is_incomplete_brief(first)
    assert first.brief.duration_hours == 0
    assert "точный объём" in " ".join(missing_brief_lines(first))
    questions = intake_questions(first).lower()
    assert "час" in questions
    assert not is_teacher_ai(first)

    course = assemble_local_course([OWN3, OWN3_ANSWERS])
    assert course.brief.program_kind == "general"
    assert course.brief.duration_hours == 20
    assert not is_teacher_ai(course)
    assert profile_name(course) == "generic"
    assert "чат-бот" not in _blob(course)


def test_own4_month_does_not_override_40_hours() -> None:
    assert volume_from_text([OWN4]) == 40
    course = assemble_local_course([OWN4])
    codes = [node.labor_function_code for node in course.competencies.nodes]
    blob = _blob(course)
    assert course.brief.duration_hours == 40
    assert course.brief.program_kind == "qualification"
    assert course.brief.format == "lecture"
    assert "зачёт" in (course.brief.attestation_form or "").lower()
    assert "b/02.7" not in "".join(code or "" for code in codes).lower()
    assert profile_name(course) != "internship"
    assert "devops" not in blob


def test_own5_teacher_without_ai_is_not_teacher_profile() -> None:
    course = assemble_local_course([OWN5])
    assert not is_teacher_ai(course)
    assert profile_name(course) == "generic"
    assert course.brief.program_kind == "qualification"
    assert course.brief.duration_hours == 36
    assert course.brief.format == "blended"
    assert not any(node.labor_function_code == "A/01.6" for node in course.competencies.nodes)
    blob = _blob(course)
    assert "gigachat" not in blob
    assert "chatgpt" not in blob


def test_own3_audience_from_methodist() -> None:
    course = empty_course()
    output = execute_tool("update_brief", {}, course, [OWN3])
    course = apply_patch(course, output)
    assert audience_from_text([OWN3])
    assert "методист" in (course.brief.audience or "").lower()
    assert "месяц" not in (course.brief.title or "").lower()


def test_chat_log_phrases_do_not_steal_248_hours() -> None:
    first = (
        "Основы веб-разработки», ПК, 72 ч, HTML/CSS/JS, защита одностраничника. "
        "К ней приложила 248-часовой образец."
    )
    answers = (
        "это программа с сертификатом, слушатели те кому интересен веб, "
        "итоговая атестация будет сайт, очная форма"
    )
    students = "студенты универа 2 курс, итоговая аттестация проверка веб-сайта который они написали"
    assert volume_from_text([first]) == 72
    assert 248 not in mentioned_hours(first)
    assert volume_from_text(
        [first + " В образце 248 часов, их не копировать."]
    ) == 72
    course = assemble_local_course([first, answers, students])
    assert course.brief.duration_hours == 72
    assert course.brief.program_kind == "general"
    assert "студент" in (course.brief.audience or "").lower()
    assert "проект" in (course.brief.attestation_form or "").lower()
    assert course.modules


def test_own1_audience_is_not_title_fragment() -> None:
    course = empty_course()
    output = execute_tool("update_brief", {}, course, [OWN1])
    course = apply_patch(course, output)
    assert "»" not in (course.brief.audience or "")
    assert "сотрудник" in (course.brief.audience or "").lower()
