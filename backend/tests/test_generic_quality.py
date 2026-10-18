from backend.app.agent import assemble_local_course
from backend.app.brief_guard import sample_intents, wants_hours_from_sample
from backend.app.catalog import profile_name
from backend.app.kit_content import STUB_BULLET, STUB_QUESTION
from backend.app.reference_outline import volume_from_reference
from backend.tests.test_open_cases import ANYTHING


def _stems(course) -> str:
    return " ".join(
        question.stem
        for item in course.assessments
        for question in item.questions
    )


def _bullets(course) -> str:
    return " ".join(
        bullet
        for lecture in course.lectures
        for slide in lecture.slides
        for bullet in slide.bullets
    )


def _titles(course) -> str:
    return " ".join(module.title for module in course.modules).lower()


def test_figma_request_is_about_figma_not_stubs() -> None:
    course = assemble_local_course(
        [ANYTHING],
        {"audience": "сотрудники музея без опыта дизайна"},
    )
    assert profile_name(course) == "generic"
    titles = _titles(course)
    assert "figma" in titles
    assert "основные понятия" not in titles
    stems = _stems(course)
    assert all(
        not STUB_QUESTION.search(question.stem)
        for item in course.assessments
        for question in item.questions
    )
    assert "figma" in stems.lower() or "макет" in stems.lower() or "афиш" in stems.lower()
    assert not STUB_BULLET.search(_bullets(course))
    seminar = " ".join(
        task.title + " " + task.prompt
        for item in course.seminars
        for task in item.tasks
    ).lower()
    assert "макет" in seminar or "афиш" in seminar or "figma" in seminar
    assert any("календарн" in line.lower() for line in course.brief.constraints)
    assert len(course.lectures) >= 2


def test_foreign_sample_does_not_steal_topic_or_hours() -> None:
    sample = (
        "Образец программы на 248 часов.\n"
        "Модуль 1. Бизнес-анализ и BABOK\n"
        "Модуль 2. Требования и UML\n"
        "Модуль 3. SQL для аналитика\n"
    )
    course = assemble_local_course(
        [ANYTHING],
        {"audience": "сотрудники музея без опыта дизайна"},
        references=sample,
    )
    titles = _titles(course)
    assert course.brief.duration_hours == 20
    assert "babok" not in titles
    assert "бизнес-анализ" not in titles
    assert "figma" in titles


def test_same_subject_outline_is_used() -> None:
    sample = (
        "Модуль 1. Знакомство с Figma\n"
        "Модуль 2. Компоненты и сетка\n"
        "Модуль 3. Макет афиши музея\n"
    )
    course = assemble_local_course(
        [ANYTHING],
        {"audience": "сотрудники музея без опыта дизайна"},
        references=sample,
    )
    titles = _titles(course)
    assert "figma" in titles
    assert "афиш" in titles or "макет" in titles or "компонент" in titles


def test_hours_from_file_only_when_methodist_asks() -> None:
    sample = (
        "Дополнительная профессиональная программа\n"
        "248 академических часов.\n"
        "Модуль 1. Бизнес-анализ и BABOK\n"
        "Модуль 2. Требования и UML\n"
    )
    assert volume_from_reference(sample) == 248
    assert wants_hours_from_sample(
        ["Тема другая, аудитория музей. Часы как в файле."]
    )
    assert not wants_hours_from_sample(
        ["Прикладываю программу, структуру можно взять, содержание новое."]
    )
    asked = assemble_local_course(
        [
            "Нужна общеразвивающая программа «Основы Figma для взрослых» "
            "очно. Слушатели — сотрудники музея без опыта дизайна. "
            "В конце защита макета афиши. Часы как в файле."
        ],
        references=sample,
    )
    assert asked.brief.duration_hours == 248
    assert "figma" in asked.brief.title.lower()
    assert "сотрудник" in asked.brief.audience.lower()
    titles = _titles(asked)
    assert "babok" not in titles
    assert "figma" in titles or "макет" in titles
    silent = assemble_local_course(
        [ANYTHING],
        {"audience": "сотрудники музея без опыта дизайна"},
        references=sample,
    )
    assert silent.brief.duration_hours == 20
    assert sample_intents(
        ["Тема Figma, 20 часов, аудиторию возьмите из образца."]
    ) == {"audience"}
    mixed = assemble_local_course(
        [
            "Нужна общеразвивающая программа «Основы Figma» на 20 часов, очно. "
            "Аудиторию возьмите из образца. В конце защита макета."
        ],
        references=sample + "\nСлушатели: сотрудники банка.\n",
    )
    assert mixed.brief.duration_hours == 20
    assert "figma" in mixed.brief.title.lower()
    assert "банк" in mixed.brief.audience.lower()


def test_labor_code_copied_from_file_only() -> None:
    request = (
        "Нужна программа повышения квалификации «Охрана труда на участке» "
        "на 40 часов, очно. Слушатели: мастера участка. Итоговая аттестация — зачёт."
    )
    course = assemble_local_course(
        [request],
        references="Профессиональный стандарт, трудовая функция A/04.6",
    )
    assert profile_name(course) == "generic"
    assert any(node.labor_function_code == "A/04.6" for node in course.competencies.nodes)
    bare = assemble_local_course([request])
    assert not any(node.labor_function_code for node in bare.competencies.nodes)
