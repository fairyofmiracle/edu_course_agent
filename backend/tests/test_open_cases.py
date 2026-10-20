from backend.app.agent import assemble_local_course
from backend.app.catalog import is_incomplete_brief, profile_name, promise_notes
from backend.app.models import empty_course
from backend.app.planner import missing_brief_lines, plan_step
from backend.app.tools import execute_tool
from backend.app.domain import apply_patch, framework_items


CASE1 = (
    "Нужна дополнительная общеразвивающая программа «Первые шаги в Python» "
    "для школьников 8 и 9 классов без опыта программирования. Объем 16 часов, "
    "занятия очно по 2 часа два раза в неделю. Практики должно быть не меньше "
    "половины всех часов. В конце каждый ученик защищает небольшой проект, "
    "например простую игру или чат-бота. Нужны итоговый тест на 10 вопросов "
    "и слайды для первых двух занятий."
)
CASE2 = (
    "Программа повышения квалификации «Искусственный интеллект в работе учителя» "
    "для учителей школ Ингушетии, 36 часов, очно-заочно с применением дистанционных "
    "технологий. Учителя должны научиться готовить с помощью нейросетей планы уроков, "
    "задания и проверочные работы, а также понимать риски и правила безопасного "
    "использования ИИ в работе с детьми. Итоговая аттестация в форме зачёта по "
    "портфолио из трёх материалов, созданных с помощью ИИ. Использовать только "
    "сервисы, которые доступны в России."
)
CASE3 = (
    "Нужна программа повышения квалификации на 72 часа «Анализ данных на Python» "
    "для сотрудников региональных отделений банков, которые сейчас работают в Excel. "
    "Формат очно-заочный, срок 4 недели. Основные темы это pandas, визуализация, "
    "SQL для выгрузки данных и основы статистики. Итоговая аттестация в виде защиты "
    "проекта на обезличенных банковских данных. Прикладываю нашу прошлую программу, "
    "структуру можно взять оттуда, но содержание нужно новое. Слайды нужны для "
    "модуля про pandas."
)
CASE4 = (
    "Сделайте курс по кибербезопасности для студентов колледжа, примерно на месяц, "
    "чтобы после него ребята могли пойти работать в эту сферу."
)
CASE4_ANSWERS = (
    "Тип программы: повышение квалификации. Объём 72 часа. Слушатели: студенты "
    "3 курса специальности «Информационные системы и программирование», знают "
    "основы сетей и Linux. Форма обучения очная, занятия на базе колледжа. "
    "Итоговая аттестация: экзамен с практическим заданием на стенде."
)
CASE5 = (
    "Нужна программа повышения квалификации в форме стажировки "
    "«DevOps-инженер от Linux до CI/CD» на 256 часов. Слушатели проходят "
    "стажировку в ИТ-компаниях региона, вся работа самостоятельная под "
    "руководством наставника от компании, аудиторных занятий нет. Итоговая "
    "аттестация занимает 2 часа и проходит в форме защиты отчёта о стажировке. "
    "Срок около двух месяцев, не больше 4 часов в день. Возьмите за образец "
    "структуры нашу стажировку по бизнес-анализу."
)
ANYTHING = (
    "Нужна дополнительная общеразвивающая программа «Основы Figma для взрослых» "
    "на 20 часов, очно. Слушатели — сотрудники музея без опыта дизайна. "
    "В конце защита макета афиши."
)


def _text(course) -> str:
    return " ".join(
        [
            course.brief.title,
            course.brief.audience,
            course.brief.attestation_form,
            *course.brief.constraints,
            *course.brief.goals,
            *(module.title for module in course.modules),
            *(topic for module in course.modules for topic in module.topics),
        ]
    ).lower()


def test_case1_school_python() -> None:
    course = assemble_local_course(
        [CASE1],
        {
            "audience": "школьники 8 и 9 классов без опыта программирования",
            "attestationForm": "защита проекта",
        },
    )
    practice = sum(module.practice_hours for module in course.modules)
    questions = sum(len(item.questions) for item in course.assessments)
    blob = _text(course)
    assert course.brief.program_kind == "general"
    assert course.brief.format == "lecture"
    assert course.brief.level == "beginner"
    assert course.brief.duration_hours == 16
    assert practice >= 8
    assert not any("Дистанционно" in line for line in course.brief.constraints)
    assert questions == 10
    assert len(course.lectures) >= 2
    assert "проект" in course.brief.attestation_form.lower()
    first_topics = " ".join(course.modules[0].topics).lower()
    assert "класс" not in first_topics
    assert "api" not in first_topics
    assert not any(node.labor_function_code for node in course.competencies.nodes)
    assert any("8 занятий" in line for line in course.brief.constraints)


def test_case2_teacher_ai() -> None:
    course = assemble_local_course(
        [CASE2],
        {"audience": "учителя школ Ингушетии"},
    )
    blob = _text(course)
    ochno = sum(module.lecture_hours + module.lab_hours for module in course.modules)
    distance = sum(module.practice_hours + module.self_study_hours for module in course.modules)
    assert course.brief.program_kind == "qualification"
    assert course.brief.duration_hours == 36
    assert any("удостоверение" in line.lower() for line in course.brief.constraints)
    assert any("Очно:" in line for line in course.brief.constraints)
    assert ochno + distance == 36
    assert any(node.labor_function_code == "A/01.6" for node in course.competencies.nodes)
    assert "риск" in blob and "персональн" in blob
    assert "chatgpt" not in blob
    assert any("План урока" in task.title for item in course.seminars for task in item.tasks)
    assert "портфолио" in course.brief.attestation_form.lower()
    assert "программ" in course.brief.audience.lower()


def test_case3_data_analysis() -> None:
    course = assemble_local_course(
        [CASE3],
        {"audience": "сотрудники региональных отделений банков, работают в Excel"},
    )
    blob = _text(course)
    titles = " ".join(module.title for module in course.modules).lower()
    assert course.brief.program_kind == "qualification"
    assert course.brief.duration_hours == 72
    assert "pandas" in titles
    assert "sql" in titles
    assert "статист" in titles
    assert "визуализац" in titles
    assert "excel" in blob or "python" in titles
    assert any("06.042" in (ref.title or "") for ref in course.brief.references)
    assert "обезлич" in course.brief.attestation_form.lower()
    assert any("отток" in task.title.lower() or "просроч" in task.prompt.lower() for item in course.seminars for task in item.tasks)
    assert any("pandas" in lecture.slides[0].title.lower() or "pandas" in " ".join(lecture.outline).lower() for lecture in course.lectures)
    assert not any("python 2" in " ".join(module.topics).lower() for module in course.modules)


def test_case4_asks_then_builds() -> None:
    first = assemble_local_course([CASE4])
    assert is_incomplete_brief(first)
    assert first.brief.duration_hours == 0
    assert not first.competencies.nodes
    assert not first.brief.title.lower().startswith("сделайте")
    missing = missing_brief_lines(first)
    assert "точный объём в академических часах" in missing
    assert "тип программы" in missing
    assert "входной уровень слушателей" in missing
    step = plan_step("intake", first, ["update_brief"], 1)
    assert step["kind"] == "reply"
    assert "час" in step["task"]

    course = assemble_local_course(
        [CASE4, CASE4_ANSWERS],
        {
            "audience": (
                "студенты 3 курса колледжа специальности «Информационные системы "
                "и программирование», знают основы сетей и Linux, параллельно получают СПО"
            )
        },
    )
    blob = _text(course)
    notes = " ".join(promise_notes(course)).lower()
    assert course.brief.program_kind == "qualification"
    assert course.brief.format == "lecture"
    assert course.brief.level == "beginner"
    assert course.brief.duration_hours == 72
    assert "экзамен" in course.brief.attestation_form.lower()
    assert "стенд" in course.brief.attestation_form.lower()
    assert "начальн" in blob
    assert "специалист" in notes or "специалист" in blob
    assert "колледж" in course.brief.audience.lower()
    assert any("06.032" in (ref.title or "") for ref in course.brief.references)


def test_case5_internship_hours() -> None:
    course = assemble_local_course(
        [CASE5],
        {"audience": "слушатели стажировки в ИТ-компаниях региона"},
    )
    blob = _text(course)
    totals = {
        "lecture": sum(module.lecture_hours for module in course.modules),
        "practice": sum(module.practice_hours for module in course.modules),
        "lab": sum(module.lab_hours for module in course.modules),
        "self": sum(module.self_study_hours for module in course.modules),
    }
    module_hours = sum(module.hours for module in course.modules)
    assert course.brief.program_kind == "qualification"
    assert course.brief.format == "workshop"
    assert course.brief.duration_hours == 256
    assert course.brief.attestation_hours == 2
    assert module_hours == 254
    assert totals["lecture"] == 0
    assert totals["practice"] == 0
    assert totals["lab"] == 0
    assert totals["self"] == 254
    assert all(token in blob for token in ("linux", "сет", "контейнер", "ci/cd", "мониторинг"))
    assert "инфраструктур" in blob or "как код" in blob
    assert "отчёт" in course.brief.attestation_form.lower()
    assert any("собеседование" in task.title.lower() for item in course.seminars for task in item.tasks)
    assert any("06.026" in (ref.title or "") for ref in course.brief.references)
    assert any("4 ч" in line or "4 часа" in line for line in course.brief.constraints)


def test_arbitrary_request_is_not_a_hackathon_sku() -> None:
    course = assemble_local_course(
        [ANYTHING],
        {"audience": "сотрудники музея без опыта дизайна"},
    )
    assert profile_name(course) == "generic"
    assert course.brief.program_kind == "general"
    assert course.brief.duration_hours == 20
    assert course.modules
    assert "figma" in course.brief.title.lower()
    assert course.seminars
    assert all(module.plan for module in course.modules)
    assert all(len(module.learning_outcomes) >= 2 for module in course.modules)
    assert all(item["ok"] for item in framework_items(course))
    assert "чат-бот" not in " ".join(task.title for item in course.seminars for task in item.tasks).lower()
    assert any("сертификат" in line.lower() for line in course.brief.constraints)


def test_case1_request_fills_attestation_from_text() -> None:
    course = empty_course()
    output = execute_tool("update_brief", {}, course, [CASE1])
    course = apply_patch(course, output)
    assert course.brief.attestation_form
    assert "проект" in course.brief.attestation_form.lower()
    assert course.brief.duration_hours == 16
    assert course.brief.program_kind == "general"


def test_incomplete_request_does_not_invent_hours() -> None:
    course = empty_course()
    output = execute_tool("update_brief", {"title": "Кибербезопасность"}, course, [CASE4])
    course = apply_patch(course, output)
    assert course.brief.duration_hours == 0
    assert course.brief.program_kind == "unset"
