from backend.app.agent import fill_missing_kit
from backend.app.kit_content import (
    attestation_form,
    default_competencies,
    document_constraints,
    fallback_questions,
    hour_split,
    is_intro_python,
    is_teacher_ai,
    issued_document,
    lecture_for_module,
    slides_for_topic,
)
from backend.app.models import empty_course
from backend.tests.test_domain import fixture_course


def test_intro_python_gets_school_competencies_and_real_questions() -> None:
    course = fixture_course()
    course.brief.audience = "школьники 8 и 9 классов без опыта"
    course.brief.title = "Первые шаги в Python"
    course.brief.attestation_form = "итоговый тест"
    course.modules[0].topics = ["Переменные", "Условия", "Циклы"]
    assert is_intro_python(course)
    nodes = default_competencies(course)
    assert nodes[0]["name"] == "Пишет короткую программу"
    assert not nodes[0]["knowledge"][0].startswith("Знает: ")
    questions = fallback_questions(course)
    assert len(questions) == 10
    assert questions[0]["answer"] in questions[0]["options"]
    assert all("Что верно про тему" not in item["stem"] for item in questions)
    assert "input()" in " ".join(item["stem"] for item in questions)
    form = attestation_form(course)
    assert form and "Защита проекта" in form
    slide = slides_for_topic("Ветвления: if, else, elif")
    assert "if проверяет условие" in " ".join(slide["bullets"])
    data_slide = slides_for_topic("Ввод и вывод данных")
    assert "Персональные данные детей" not in " ".join(data_slide["bullets"])
    office = slides_for_topic("Практические задания", course)
    assert "Готовый комплект можно дать классу" not in " ".join(office["bullets"])
    teacher = fixture_course()
    teacher.brief.title = "Искусственный интеллект в работе учителя"
    teacher.brief.audience = "учителя школ"
    risk_slide = slides_for_topic("Риски и персональные данные учеников", teacher)
    assert "Персональные данные детей" in " ".join(risk_slide["bullets"])


def test_lecture_explains_topics_without_hour_table() -> None:
    course = fixture_course()
    module = course.modules[0]
    module.topics = ["Переменные", "Условия", "Циклы", "Функции"]
    lecture = lecture_for_module(module, course)
    titles = [slide["title"] for slide in lecture["slides"]]
    assert len(lecture["slides"]) > 4
    assert "Ход занятия" not in titles
    assert "Часы модуля" not in titles
    assert all("ч." not in " ".join(slide["bullets"]) for slide in lecture["slides"])
    assert lecture["slides"][0]["bullets"][0] == "Переменные"


def test_teacher_ai_kit_follows_case2_document() -> None:
    course = fixture_course()
    course.brief.title = "Искусственный интеллект в работе учителя"
    course.brief.audience = "учителя школ Ингушетии"
    course.brief.program_kind = "qualification"
    course.brief.duration_hours = 36
    course.brief.attestation_form = "зачёт"
    course.modules[0].title = "План урока с нейросетью"
    course.modules[0].topics = ["План урока"]
    assert is_teacher_ai(course)
    assert not is_intro_python(course)
    nodes = default_competencies(course)
    assert nodes[0]["laborFunctionCode"] == "A/01.6"
    assert "GigaChat" in nodes[0]["skills"][0]
    questions = fallback_questions(course)
    blob = " ".join(item["stem"] + " " + " ".join(item["options"]) for item in questions).lower()
    assert "персональн" in blob
    assert "портфолио" in blob
    assert "gigachat" in blob
    form = attestation_form(course)
    assert form and "портфолио" in form and "трёх" in form
    filled = fill_missing_kit(course)
    titles = [task.title for item in filled.seminars for task in item.tasks]
    assert any("План урока" in title for title in titles)
    assert any("Проверочная" in title for title in titles)
    assert any("544н" in (ref.title or "") for ref in filled.brief.references)
    assert any("удостоверение" in line.lower() for line in filled.brief.constraints)
    assert any("Очно:" in line for line in filled.brief.constraints)
    assert "программ" in filled.brief.audience.lower()
    assert "удостоверение" in issued_document(filled)
    assert any("Очно:" in line for line in document_constraints(filled))
    assert hour_split(filled)[0] >= 0


def test_fill_covers_every_outcome_on_each_module() -> None:
    course = fixture_course()
    course.brief.audience = "сотрудники музея без опыта"
    course.brief.title = "Подписи к экспонатам"
    course.brief.duration_hours = 30
    second = course.modules[0].model_copy(
        update={
            "id": "M2",
            "title": "Этикетка",
            "learning_outcomes": ["Пишет короткую этикетку"],
            "topics": ["Этикетка"],
        }
    )
    course.modules.append(second)
    filled = fill_missing_kit(course)
    outcomes = [
        (module.id, outcome)
        for module in filled.modules
        for outcome in module.learning_outcomes
    ]
    question_hits = {
        (item.module_id, question.learning_outcome)
        for item in filled.assessments
        for question in item.questions
    }
    task_hits = {
        (item.module_id, task.learning_outcome)
        for item in filled.seminars
        for task in item.tasks
    }
    assert outcomes
    assert all(pair in question_hits for pair in outcomes)
    assert all(pair in task_hits for pair in outcomes)
    assert sum(len(item.questions) for item in filled.assessments) >= 10


def test_fill_replaces_stub_kit() -> None:
    course = fixture_course()
    course.brief.audience = "школьники 8 и 9 классов без опыта"
    filled = fill_missing_kit(course)
    assert filled is not course
    assert filled.assessments[0].questions[0].stem != "Что верно про тему «Переменные»?"
    assert filled.seminars[0].tasks[0].criteria
    assert "игра или чат-бот" in filled.seminars[0].tasks[0].title.lower() + filled.brief.attestation_form.lower()
