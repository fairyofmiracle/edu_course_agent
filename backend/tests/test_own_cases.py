from backend.app.agent import assemble_local_course
from backend.app.brief_guard import (
    attestation_from_text,
    audience_from_text,
    mentioned_hours,
    mentioned_kind,
    repair_typos,
    title_from_request,
    volume_from_text,
)
from backend.app.domain import balance_modules
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



def test_own1_modules_do_not_flip_to_data_analysis() -> None:
    """Модель может написать «анализ данных» в модуле — профиль берём из брифа."""
    course = assemble_local_course([OWN1])
    assert profile_name(course) == "generic"
    course.modules[0].title = "Автоматизация и анализ данных в Excel для бухгалтерии"
    assert profile_name(course) == "generic"


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
    assert "\n2." not in questions
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


def test_audience_answers_are_kept_and_stop_the_question() -> None:
    from backend.app.models import empty_course as make_course
    from backend.app.planner import plan_step

    first = "программа для изучениая алгоритмов 36 часов для студетвов 3 курса"
    assert repair_typos("Форма обучения: стажировка") == "Форма обучения: стажировка"
    course = make_course()
    course = apply_patch(course, execute_tool("update_brief", {}, course, [first]))
    assert "студент" in course.brief.audience.lower()
    assert "3 курса" in course.brief.audience.lower()
    asked = apply_patch(
        course,
        execute_tool("update_brief", {}, course, [first, "3 курс"]),
    )
    assert asked.brief.audience.lower() == "3 курс"
    named = apply_patch(
        asked,
        execute_tool(
            "update_brief",
            {},
            asked,
            [first, "3 курс", "стденты 3 курс продвинутые"],
        ),
    )
    assert "студент" in named.brief.audience.lower()
    assert "продвинут" in named.brief.audience.lower()
    assert "аудитория" not in missing_brief_lines(named)
    step = plan_step("intake", course, ["update_brief"], 4)
    assert step["kind"] == "reply"
    assert step.get("tool") is None


def test_named_format_is_not_asked_again_while_hours_are_missing() -> None:
    from backend.app.models import empty_course as make_course

    course = make_course()
    named = apply_patch(
        course,
        execute_tool(
            "update_brief",
            {},
            course,
            [
                "Общеразвивающая программа с сертификатом",
                "Итоговая аттестация: защита проекта",
                "Форма обучения: стажировка",
            ],
        ),
    )
    assert named.brief.program_kind == "general"
    assert named.brief.format == "workshop"
    assert named.brief.format_named is True
    assert "проект" in named.brief.attestation_form.lower()
    missing = missing_brief_lines(named)
    assert "форма обучения" not in missing
    assert "тип программы" not in missing
    assert "форма итоговой аттестации" not in missing
    assert "точный объём в академических часах" in missing


def test_exam_without_a_number_takes_two_hours_from_the_volume() -> None:
    from backend.app.models import empty_course as make_course

    course = assemble_local_course(
        [
            "Повышение квалификации, 72 академических часа, студенты 3 курса колледжа, "
            "знают Linux. Итоговая аттестация: экзамен."
        ]
    )
    assert course.brief.attestation_hours == 2
    assert "экзамен" in course.brief.attestation_form.lower()
    assert abs(sum(module.hours for module in course.modules) - 70) < 0.01
    untouched = apply_patch(
        make_course(),
        execute_tool(
            "update_brief",
            {},
            make_course(),
            ["Итоговая аттестация занимает 6 часов. Объём 24 академических часа."],
        ),
    )
    assert untouched.brief.attestation_hours == 6


def test_named_format_wins_over_the_model_guess() -> None:
    from backend.app.models import empty_course as make_course

    course = make_course()
    named = apply_patch(
        course,
        execute_tool(
            "update_brief",
            {"format": "workshop"},
            course,
            ["Форма обучения: очно"],
        ),
    )
    assert named.brief.format == "lecture"
    assert named.brief.format_named is True
    spoken = apply_patch(
        make_course(),
        execute_tool("update_brief", {}, make_course(), ["занятия очно, 16 часов"]),
    )
    assert spoken.brief.format == "lecture"
    assert spoken.brief.format_named is True


def test_regex_keeps_the_field_it_was_given() -> None:
    phrase = "программа для изучениая алгоритмов 36 часов для студетвов 3 курса"
    audience = audience_from_text([phrase]) or ""
    assert audience.lower().startswith("студент")
    assert "час" not in audience.lower()
    assert title_from_request(phrase) == "Изучение алгоритмов"
    assert volume_from_text(["16 часов практики и 36 часов на программу"]) == 36
    assert mentioned_hours("поменяй часы на 24") == [24]
    assert attestation_from_text("курс про корпоративный сайт для витрины") is None
    assert attestation_from_text("не экзамен, а зачёт") == "зачёт"
    assert mentioned_kind(["Форма обучения: стажировка"]) is None
    assert attestation_from_text("итоговая атестация будет сайт") == "защита проекта"


def test_typos_still_name_the_students() -> None:
    text = "программа для изучениая алгоритмов 36 часов для студетвов 3 курса"
    audience = audience_from_text([text]) or ""
    assert "студент" in audience.lower()
    assert "3 курса" in audience.lower()
    assert mentioned_hours(text) == [36]


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


def test_attestation_remains_unset_without_explicit_answer() -> None:
    course = empty_course()
    texts = ["Нужен курс Python на 24 часа для сотрудников."]

    course = _update_attestation(course, texts)

    assert course.brief.attestation_status == "unset"
    assert course.brief.attestation_form == ""
    assert course.brief.attestation_hours == 0

    texts.append("Форма обучения очная.")
    course = _update_attestation(course, texts)

    assert course.brief.attestation_status == "unset"
    assert course.brief.attestation_form == ""
    assert course.brief.attestation_hours == 0
    assert "форма итоговой аттестации" in missing_brief_lines(course)

def test_attestation_can_be_added_changed_cancelled_and_restored() -> None:
    course = empty_course()
    texts = [
        "Нужен курс Python на 24 часа для сотрудников.",
        "Форма обучения очная.",
    ]
    course = _update_attestation(course, texts)
    assert course.brief.attestation_status == "unset"

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

def test_short_course_default_attestation_hours() -> None:
    course = empty_course()

    texts = [
        "Нужен курс Python на 16 часов. "
        "Итоговая аттестация — тестирование."
    ]

    course = _update_attestation(course, texts)

    assert course.brief.attestation_status == "specified"
    assert course.brief.attestation_form == "тест"
    assert course.brief.attestation_hours == 1


def test_short_course_explicit_attestation_hours() -> None:
    course = empty_course()

    texts = [
        "Нужен курс Python на 16 часов. "
        "На итоговую аттестацию выделить 3 часа. "
        "Форма — тестирование."
    ]

    course = _update_attestation(course, texts)

    assert course.brief.attestation_status == "specified"
    assert course.brief.attestation_hours == 3


def test_duration_change_preserves_attestation_hours() -> None:
    course = empty_course()

    # Исходные данные: 24 часа, из них 3 часа — аттестация.
    texts = [
        "Нужен курс Python на 24 академических часа. "
        "Итоговая аттестация — защита проекта, 3 часа."
    ]

    output = execute_tool(
        "update_brief",
        {
            "durationHours": 24,
            "attestationForm": "защита проекта",
            "attestationHours": 3,
        },
        course,
        texts,
    )
    course = apply_patch(course, output)

    assert course.brief.duration_hours == 24
    assert course.brief.attestation_hours == 3
    assert course.brief.attestation_status == "specified"

    # Методист изменяет только общую продолжительность.
    texts.append("Измени продолжительность курса на 36 академических часов.")

    output = execute_tool(
        "update_brief",
        {"durationHours": 36},
        course,
        texts,
    )
    course = apply_patch(course, output)

    # Общая продолжительность изменилась.
    assert course.brief.duration_hours == 36

    # Аттестация осталась прежней.
    assert course.brief.attestation_hours == 3
    assert course.brief.attestation_form == "защита проекта"
    assert course.brief.attestation_status == "specified"


def test_modules_rebalance_when_duration_changes() -> None:
    modules = [
        {"id": "module-1", "title": "Введение", "hours": 10},
        {"id": "module-2", "title": "Практика", "hours": 11},
    ]

    initial = balance_modules(
        modules,
        duration_hours=24,
        attestation_hours=3,
    )

    assert sum(module["hours"] for module in initial) == 21

    updated = balance_modules(
        initial,
        duration_hours=36,
        attestation_hours=3,
    )

    assert sum(module["hours"] for module in updated) == 33


def test_duration_change_rebalances_existing_course() -> None:
    course = empty_course()

    # Создаём бриф: 24 часа, включая 3 часа аттестации.
    texts = [
        "Нужен курс Python на 24 академических часа. "
        "Итоговая аттестация — защита проекта, 3 часа."
    ]

    output = execute_tool(
        "update_brief",
        {
            "durationHours": 24,
            "attestationForm": "защита проекта",
            "attestationHours": 3,
        },
        course,
        texts,
    )
    course = apply_patch(course, output)

    # Добавляем два учебных модуля.
    course = apply_patch(
        course,
        {
            "type": "set_structure",
            "modules": [
                {
                    "id": "module-1",
                    "title": "Введение",
                    "hours": 10,
                    "lectureHours": 6,
                    "practiceHours": 4,
                    "labHours": 0,
                    "selfStudyHours": 0,
                    "topics": ["Основы Python"],
                    "learningOutcomes": ["Понимает основы Python"],
                },
                {
                    "id": "module-2",
                    "title": "Практика",
                    "hours": 11,
                    "lectureHours": 3,
                    "practiceHours": 8,
                    "labHours": 0,
                    "selfStudyHours": 0,
                    "topics": ["Практические задания"],
                    "learningOutcomes": ["Решает задачи на Python"],
                },
            ],
        },
    )

    assert len(course.modules) == 2
    assert sum(module.hours for module in course.modules) == 21

    # Методист меняет только общую продолжительность.
    texts.append("Измени продолжительность курса на 36 академических часов.")

    output = execute_tool(
        "update_brief",
        {"durationHours": 36},
        course,
        texts,
    )
    course = apply_patch(course, output)

    # Проверяем результат.
    assert course.brief.duration_hours == 36
    assert course.brief.attestation_hours == 3
    assert course.brief.attestation_form == "защита проекта"
    assert course.brief.attestation_status == "specified"

    assert len(course.modules) == 2
    assert sum(module.hours for module in course.modules) == 33