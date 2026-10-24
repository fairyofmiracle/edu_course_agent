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

def test_course_volume_with_educational_hours() -> None:
    text = (
        "создай курс по основам кибербезопасности на 20 учебных часов. "
        "Аттестация будет в виде теста. Для школьников 9-11 классов"
    )

    assert mentioned_hours(text) == [20]
    assert volume_from_text([text]) == 20

def test_final_attestation_can_be_a_test() -> None:
    course = empty_course()
    text = (
        "Создай курс по Python на 20 часов. "
        "Аттестация будет в виде теста."
    )

    output = execute_tool("update_brief", {}, course, [text])
    updated = apply_patch(course, output)

    assert updated.brief.attestation_form == "тест"
    assert updated.brief.duration_hours == 20

def test_intermediate_tests_do_not_override_final_attestation() -> None:
    course = empty_course()
    text = (
        "Создай курс Python на 20 часов. "
        "После каждого модуля проводи промежуточные тесты. "
        "Итоговая аттестация — защита проекта."
    )

    output = execute_tool("update_brief", {}, course, [text])
    updated = apply_patch(course, output)

    assert updated.brief.attestation_form == "защита проекта"
    assert updated.brief.duration_hours == 20

def test_final_test_with_intermediate_tests() -> None:
    course = empty_course()
    text = (
        "Создай курс Python на 20 часов. "
        "После каждого модуля проводи промежуточные тесты. "
        "Итоговая аттестация — тестирование."
    )

    output = execute_tool("update_brief", {}, course, [text])
    updated = apply_patch(course, output)

    assert updated.brief.attestation_form == "тест"
    assert updated.brief.duration_hours == 20

def _update_attestation(course, texts):
    output = execute_tool("update_brief", {}, course, texts)
    return apply_patch(course, output)


def test_attestation_defaults_to_none_after_second_message() -> None:
    course = empty_course()
    texts = ["Нужен курс Python на 24 часа для сотрудников."]

    course = _update_attestation(course, texts)

    assert course.brief.attestation_status == "unset"
    assert course.brief.attestation_form == ""
    assert course.brief.attestation_hours == 0

    texts.append("Форма обучения очная.")
    course = _update_attestation(course, texts)

    assert course.brief.attestation_status == "none"
    assert course.brief.attestation_form == ""
    assert course.brief.attestation_hours == 0
    assert "форма итоговой аттестации" not in missing_brief_lines(course)


def test_attestation_can_be_added_changed_cancelled_and_restored() -> None:
    course = empty_course()
    texts = [
        "Нужен курс Python на 24 часа для сотрудников.",
        "Форма обучения очная.",
    ]
    course = _update_attestation(course, texts)
    assert course.brief.attestation_status == "none"

    texts.append("Итоговая аттестация — защита проекта.")
    course = _update_attestation(course, texts)

    assert course.brief.attestation_status == "specified"
    assert course.brief.attestation_form == "защита проекта"
    assert course.brief.attestation_hours == 2

    texts.append("На итоговую аттестацию выделить 3 часа.")
    course = _update_attestation(course, texts)

    assert course.brief.attestation_status == "specified"
    assert course.brief.attestation_form == "защита проекта"
    assert course.brief.attestation_hours == 3

    texts.append("Убери итоговую аттестацию.")
    course = _update_attestation(course, texts)

    assert course.brief.attestation_status == "none"
    assert course.brief.attestation_form == ""
    assert course.brief.attestation_hours == 0

    texts.append("Итоговая аттестация — тестирование.")
    course = _update_attestation(course, texts)

    assert course.brief.attestation_status == "specified"
    assert course.brief.attestation_form == "тест"
    assert course.brief.attestation_hours == 2


def test_attestation_explicit_hours_survive_unrelated_message() -> None:
    course = empty_course()
    texts = [
        "Курс Python на 24 часа. "
        "Итоговая аттестация — защита проекта, 4 часа."
    ]
    course = _update_attestation(course, texts)

    assert course.brief.attestation_status == "specified"
    assert course.brief.attestation_hours == 4

    texts.append("Слушатели — сотрудники бухгалтерии.")
    course = _update_attestation(course, texts)

    assert course.brief.attestation_status == "specified"
    assert course.brief.attestation_form == "защита проекта"
    assert course.brief.attestation_hours == 4


def test_service_prompt_does_not_count_as_second_message() -> None:
    course = empty_course()
    texts = ["Нужен курс Python на 24 часа для сотрудников."]
    course = _update_attestation(course, texts)

    texts.append("Собери каркас")
    course = _update_attestation(course, texts)

    assert course.brief.attestation_status == "unset"
    assert course.brief.attestation_form == ""
    assert course.brief.attestation_hours == 0


def test_legacy_attestation_survives_unrelated_message() -> None:
    course = empty_course()
    # Старый курс: форма и часы есть, новый статус ещё не заполнен.
    course.brief.attestation_form = "Защита проекта"
    course.brief.attestation_hours = 4

    course = _update_attestation(
        course,
        [
            "Нужен курс Python на 24 часа.",
            "Слушатели — сотрудники бухгалтерии.",
        ],
    )

    assert course.brief.attestation_form == "Защита проекта"
    assert course.brief.attestation_hours == 4
    assert "форма итоговой аттестации" not in missing_brief_lines(course)

def test_custom_attestation_form_from_explicit_request() -> None:
    course = empty_course()
    texts = [
        "Нужен курс Python на 24 часа.",
        "Итоговая аттестация — устное собеседование.",
    ]

    output = execute_tool(
        "update_brief",
        {"attestationForm": "устное собеседование"},
        course,
        texts,
    )
    course = apply_patch(course, output)

    assert course.brief.attestation_status == "specified"
    assert course.brief.attestation_form == "устное собеседование"
    assert course.brief.attestation_hours == 2


def test_hours_change_ignores_unconfirmed_form_from_patch() -> None:
    course = empty_course()
    course.brief.attestation_form = "защита проекта"
    course.brief.attestation_hours = 2
    course.brief.attestation_status = "specified"

    output = execute_tool(
        "update_brief",
        {"attestationForm": "тест", "attestationHours": 3},
        course,
        ["На итоговую аттестацию выделить 3 часа."],
    )
    course = apply_patch(course, output)

    assert course.brief.attestation_status == "specified"
    assert course.brief.attestation_form == "защита проекта"
    assert course.brief.attestation_hours == 3
    