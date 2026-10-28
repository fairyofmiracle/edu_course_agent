from backend.app.domain import allocate_integer, apply_patch, balance_modules
from backend.app.models import empty_course, CourseDocument
from backend.app.tools import execute_tool

def test_hours_are_distributed_by_workload() -> None:
    """
    Модули с большей трудоёмкостью должны получать больше часов.
    """

    total_hours = 38

    # Относительная трудоёмкость трёх модулей.
    weights = [1, 2, 3]

    result = allocate_integer(total_hours, weights)

    assert sum(result) == total_hours

    # Более трудоёмкий модуль получает больше времени.
    assert result[0] < result[1] < result[2]

    # Часы распределяются с шагом 0,5.
    assert all(hours * 2 == int(hours * 2) for hours in result)

import pytest

def test_explicit_module_hours_are_preserved() -> None:
    """
    Если методист указал часы модулей и их сумма
    соответствует продолжительности программы,
    балансировка не должна менять эти значения.
    """

    modules = [
        {
            "id": "m1",
            "title": "Введение",
            "hours": 4,
            "lectureHours": 2,
            "practiceHours": 2,
            "labHours": 0,
            "selfStudyHours": 0,
            "topics": ["Знакомство с предметом"],
        },
        {
            "id": "m2",
            "title": "Основная часть",
            "hours": 10,
            "lectureHours": 4,
            "practiceHours": 6,
            "labHours": 0,
            "selfStudyHours": 0,
            "topics": ["Основные инструменты"],
        },
        {
            "id": "m3",
            "title": "Практический проект",
            "hours": 20,
            "lectureHours": 4,
            "practiceHours": 16,
            "labHours": 0,
            "selfStudyHours": 0,
            "topics": ["Разработка проекта"],
        },
    ]

    result = balance_modules(
        modules,
        duration_hours=36,
        attestation_hours=2,
    )

    assert [module["hours"] for module in result] == [4, 10, 20]

def test_partial_course_hours_change_when_next_modules_are_added():
    from backend.app.domain import balance_modules

    first_batch = [
        {"id": "1", "title": "Модуль 1", "hours": 10},
        {"id": "2", "title": "Модуль 2", "hours": 20},
    ]

    first_result = balance_modules(
        first_batch,
        duration_hours=100,
        attestation_hours=0,
    )

    second_batch = [
        *first_batch,
        {"id": "3", "title": "Модуль 3", "hours": 30},
    ]

    second_result = balance_modules(
        second_batch,
        duration_hours=100,
        attestation_hours=0,
    )

    first_hours = [module["hours"] for module in first_result]
    second_hours = [module["hours"] for module in second_result[:2]]

    assert sum(module["hours"] for module in first_result) == 100
    assert sum(module["hours"] for module in second_result) == 100

    assert first_hours != second_hours

def test_workload_weight_survives_structure_pipeline():
    from backend.app.domain import apply_patch
    from backend.app.models import CourseDocument
    from backend.app.tools import execute_tool

    course = CourseDocument.model_validate(
        {
            "brief": {
                "title": "Разработка REST API",
                "durationHours": 36,
            },
            "modules": [],
        }
    )

    arguments = {
        "modules": [
            {
                "id": "m1",
                "title": "Основы HTTP",
                "hours": 12,
                "workloadWeight": 2,
                "topics": ["HTTP", "Методы запросов"],
                "learningOutcomes": ["Выполняет HTTP-запросы"],
            },
            {
                "id": "m2",
                "title": "Разработка API",
                "hours": 24,
                "workloadWeight": 5,
                "topics": ["Маршрутизация", "Авторизация"],
                "learningOutcomes": ["Разрабатывает REST API"],
            },
        ]
    }

    patch = execute_tool(
        "set_structure",
        arguments,
        course,
        user_texts=[],
    )

    updated = apply_patch(course, patch)

    assert [module.workload_weight for module in updated.modules] == [2, 5]

    serialized = updated.as_api()

    assert [
        module["workloadWeight"]
        for module in serialized["modules"]
    ] == [2, 5]

def test_workload_weight_survives_structure_pipeline() -> None:
    """Вес трудоёмкости сохраняется после обработки структуры."""

    course = empty_course()
    course.brief.title = "Разработка REST API"
    course.brief.audience = "Начинающие разработчики"
    course.brief.duration_hours = 36

    arguments = {
        "modules": [
            {
                "id": "m1",
                "title": "Основы HTTP",
                "hours": 12,
                "workloadWeight": 2,
                "topics": ["HTTP", "Методы запросов"],
                "learningOutcomes": ["Выполняет HTTP-запросы"],
            },
            {
                "id": "m2",
                "title": "Разработка API",
                "hours": 24,
                "workloadWeight": 5,
                "topics": ["Маршрутизация", "Авторизация"],
                "learningOutcomes": ["Разрабатывает REST API"],
            },
        ]
    }

    patch = execute_tool(
        "set_structure",
        arguments,
        course,
        user_texts=[],
    )

    updated = apply_patch(course, patch)
    serialized = updated.as_api()

    assert [
        module["workloadWeight"]
        for module in serialized["modules"]
    ] == [2, 5]

def test_workload_weight_survives_module_update() -> None:
    """При обновлении модуля без нового веса старый вес сохраняется."""

    course = empty_course()
    course.brief.duration_hours = 36

    first_patch = execute_tool(
        "set_structure",
        {
            "modules": [
                {
                    "id": "m1",
                    "title": "Основы HTTP",
                    "hours": 36,
                    "workloadWeight": 5,
                    "topics": ["HTTP"],
                    "learningOutcomes": ["Работает с HTTP"],
                }
            ]
        },
        course,
        user_texts=[],
    )

    course = apply_patch(course, first_patch)

    second_patch = execute_tool(
        "set_structure",
        {
            "modules": [
                {
                    "id": "m1",
                    "title": "HTTP и REST API",
                    "hours": 36,
                    "topics": ["HTTP", "REST"],
                    "learningOutcomes": ["Разрабатывает REST API"],
                }
            ]
        },
        course,
        user_texts=[],
    )

    updated = apply_patch(course, second_patch)

    assert len(updated.modules) == 1
    assert updated.modules[0].title == "HTTP и REST API"
    assert updated.modules[0].workload_weight == 5

def test_hour_constraints_survive_brief_update() -> None:
    """Ограничения часов сохраняются при обновлении других полей Brief."""

    course = empty_course()

    course.brief.title = "Основы Python"
    course.brief.duration_hours = 16

    first_patch = {
        "type": "update_brief",
        "brief": {
            "hourConstraints": [
                {
                    "field": "practiceHours",
                    "operator": "min",
                    "value": 8,
                    "source": "methodist",
                }
            ]
        },
    }

    course = apply_patch(course, first_patch)

    second_patch = {
        "type": "update_brief",
        "brief": {
            "title": "Python для детей",
        },
    }

    updated = apply_patch(course, second_patch)

    assert updated.brief.title == "Python для детей"

    assert updated.as_api()["brief"]["hourConstraints"] == [
        {
            "field": "practiceHours",
            "operator": "min",
            "value": 8,
            "source": "methodist",
        }
    ]

def test_hour_constraints_merge_on_brief_update() -> None:
    """Новые ограничения дополняют существующие."""

    course = empty_course()
    course.brief.duration_hours = 16

    first_patch = {
        "type": "update_brief",
        "brief": {
            "hourConstraints": [
                {
                    "field": "practiceHours",
                    "operator": "min",
                    "value": 8,
                    "source": "methodist",
                }
            ]
        },
    }

    course = apply_patch(course, first_patch)

    second_patch = {
        "type": "update_brief",
        "brief": {
            "hourConstraints": [
                {
                    "field": "selfStudyHours",
                    "operator": "eq",
                    "value": 4,
                    "source": "methodist",
                }
            ]
        },
    }

    updated = apply_patch(course, second_patch)

    constraints = updated.as_api()["brief"]["hourConstraints"]

    assert len(constraints) == 2

    assert any(
        item["field"] == "practiceHours"
        and item["operator"] == "min"
        and item["value"] == 8
        for item in constraints
    )

    assert any(
        item["field"] == "selfStudyHours"
        and item["operator"] == "eq"
        and item["value"] == 4
        for item in constraints
    )

def test_hour_constraint_is_updated_without_duplication() -> None:
    """Повторное ограничение заменяет предыдущее значение."""

    course = empty_course()
    course.brief.duration_hours = 16

    first_patch = {
        "type": "update_brief",
        "brief": {
            "hourConstraints": [
                {
                    "field": "practiceHours",
                    "operator": "min",
                    "value": 8,
                    "source": "methodist",
                }
            ]
        },
    }

    course = apply_patch(course, first_patch)

    second_patch = {
        "type": "update_brief",
        "brief": {
            "hourConstraints": [
                {
                    "field": "practiceHours",
                    "operator": "min",
                    "value": 10,
                    "source": "methodist",
                }
            ]
        },
    }

    updated = apply_patch(course, second_patch)
    constraints = updated.as_api()["brief"]["hourConstraints"]

    assert len(constraints) == 1
    assert constraints[0]["field"] == "practiceHours"
    assert constraints[0]["operator"] == "min"
    assert constraints[0]["value"] == 10

def test_balance_modules_uses_workload_weights() -> None:
    """Часы модулей распределяются по workloadWeight."""

    modules = [
        {
            "id": "m1",
            "title": "Введение",
            "hours": 2,
            "workloadWeight": 1,
            "topics": ["Знакомство"],
            "learningOutcomes": ["Знает основы"],
        },
        {
            "id": "m2",
            "title": "Основы",
            "hours": 2,
            "workloadWeight": 2,
            "topics": ["Основные понятия"],
            "learningOutcomes": ["Понимает основные понятия"],
        },
        {
            "id": "m3",
            "title": "Практикум",
            "hours": 2,
            "workloadWeight": 1,
            "topics": ["Практические задания"],
            "learningOutcomes": ["Выполняет задания"],
        },
    ]

    result = balance_modules(
        modules,
        duration_hours=36,
        attestation_hours=2,
    )

    assert [module["hours"] for module in result] == [
        8.5,
        17.0,
        8.5,
    ]

    assert sum(module["hours"] for module in result) == 34

def test_balance_modules_preserves_fixed_hours() -> None:
    """Фиксированные часы сохраняются, остаток распределяется по весам."""

    modules = [
        {
            "id": "m1",
            "title": "Введение",
            "hours": 2,
            "fixedHours": 4,
            "workloadWeight": 1,
            "topics": ["Знакомство с курсом"],
            "learningOutcomes": ["Знает цели курса"],
        },
        {
            "id": "m2",
            "title": "Основы",
            "hours": 2,
            "workloadWeight": 2,
            "topics": ["Основные понятия"],
            "learningOutcomes": ["Понимает основные понятия"],
        },
        {
            "id": "m3",
            "title": "Практикум",
            "hours": 2,
            "workloadWeight": 1,
            "topics": ["Практические задания"],
            "learningOutcomes": ["Выполняет задания"],
        },
    ]

    result = balance_modules(
        modules,
        duration_hours=36,
        attestation_hours=2,
    )

    assert [module["hours"] for module in result] == [
        4.0,
        20.0,
        10.0,
    ]

    assert sum(module["hours"] for module in result) == 34

def test_fixed_hours_survive_course_model() -> None:
    """Фиксированные часы сохраняются при сериализации курса."""

    course = empty_course()

    data = course.as_api()

    data["modules"] = [
        {
            "id": "m1",
            "title": "Введение",
            "hours": 4,
            "fixedHours": 4,
            "workloadWeight": 1,
            "topics": ["Знакомство с курсом"],
            "learningOutcomes": ["Понимает цели курса"],
        }
    ]

    restored = CourseDocument.model_validate(data)

    module = restored.as_api()["modules"][0]

    assert module["fixedHours"] == 4
    assert module["workloadWeight"] == 1
    assert module["hours"] == 4

import pytest


def test_fixed_hours_exceed_available_budget():
    """Фиксированные часы не могут превышать бюджет курса."""

    modules = [
        {
            "id": "m1",
            "title": "Модуль 1",
            "hours": 25,
            "fixedHours": 25,
        },
        {
            "id": "m2",
            "title": "Модуль 2",
            "hours": 5,
        },
    ]

    with pytest.raises(ValueError, match="превышают доступный бюджет"):
        balance_modules(
            modules,
            duration_hours=20,
            attestation_hours=2,
        )


def test_all_modules_have_fixed_hours():
    """Если все часы фиксированы, алгоритм не меняет их."""

    modules = [
        {
            "id": "m1",
            "title": "Модуль 1",
            "hours": 2,
            "fixedHours": 4,
        },
        {
            "id": "m2",
            "title": "Модуль 2",
            "hours": 2,
            "fixedHours": 6,
        },
    ]

    result = balance_modules(
        modules,
        duration_hours=12,
        attestation_hours=2,
    )

    assert [module["hours"] for module in result] == [4, 6]
    assert sum(module["hours"] for module in result) == 10


def test_all_fixed_modules_with_remaining_hours():
    """Нельзя оставить часы нераспределёнными."""

    modules = [
        {
            "id": "m1",
            "title": "Модуль 1",
            "hours": 4,
            "fixedHours": 4,
        },
        {
            "id": "m2",
            "title": "Модуль 2",
            "hours": 6,
            "fixedHours": 6,
        },
    ]

    with pytest.raises(ValueError, match="нераспределённых часов"):
        balance_modules(
            modules,
            duration_hours=20,
            attestation_hours=2,
        )

def test_fixed_hours_with_zero_available_budget():
    """Нельзя выделить фиксированные часы при нулевом бюджете."""

    modules = [
        {
            "id": "m1",
            "title": "Введение",
            "hours": 4,
            "fixedHours": 4,
        }
    ]

    with pytest.raises(ValueError, match="превышают доступный бюджет"):
        balance_modules(
            modules,
            duration_hours=2,
            attestation_hours=2,
        )

def test_fixed_hours_zero_is_preserved():
    """Нулевые фиксированные часы не перераспределяются."""

    modules = [
        {
            "id": "m1",
            "title": "Введение",
            "hours": 5,
            "fixedHours": 0,
        },
        {
            "id": "m2",
            "title": "Практика",
            "hours": 5,
            "workloadWeight": 1,
        },
    ]

    result = balance_modules(
        modules,
        duration_hours=12,
        attestation_hours=2,
    )

    assert [module["hours"] for module in result] == [0, 10]
    assert sum(module["hours"] for module in result) == 10

    assert result[0]["fixedHours"] == 0

    assert all(
        result[0][key] == 0
        for key in (
            "lectureHours",
            "practiceHours",
            "labHours",
            "selfStudyHours",
        )
    )

    assert all(
        row[key] == 0
        for row in result[0]["plan"]
        for key in (
            "lectureHours",
            "practiceHours",
            "labHours",
            "selfStudyHours",
        )
    )

def test_fixed_hours_survive_rebalancing():
    """Повторное распределение не меняет фиксированные часы."""

    modules = [
        {
            "id": "m1",
            "title": "Введение",
            "hours": 2,
            "fixedHours": 4,
        },
        {
            "id": "m2",
            "title": "Основы",
            "hours": 2,
            "workloadWeight": 2,
        },
        {
            "id": "m3",
            "title": "Практика",
            "hours": 2,
            "workloadWeight": 1,
        },
    ]

    first_result = balance_modules(
        modules,
        duration_hours=36,
        attestation_hours=2,
    )

    second_result = balance_modules(
        first_result,
        duration_hours=36,
        attestation_hours=2,
    )

    assert second_result == first_result
    assert second_result[0]["hours"] == 4
    assert second_result[0]["fixedHours"] == 4

def test_coerce_structure_preserves_fixed_hours():
    """Обработчик структуры не должен терять фиксированные часы."""

    from app.tools import coerce_structure_arguments

    arguments = {
        "modules": [
            {
                "id": "m1",
                "title": "Введение",
                "hours": 4,
                "fixedHours": 4,
                "workloadWeight": 1,
                "topics": ["Введение в курс"],
                "learningOutcomes": ["Понимает цели курса"],
            }
        ]
    }

    result = coerce_structure_arguments(arguments)

    module = result["modules"][0]

    assert module["fixedHours"] == 4
    assert module["workloadWeight"] == 1

def test_merge_modules_preserves_fixed_hours():
    """Обновление модуля не должно удалять фиксированные часы."""

    from app.domain import _merge_modules

    existing = [
        {
            "id": "m1",
            "title": "Введение",
            "hours": 4,
            "fixedHours": 4,
            "workloadWeight": 1,
        }
    ]

    incoming = [
        {
            "id": "m1",
            "title": "Обновлённое введение",
            "hours": 6,
        }
    ]

    result = _merge_modules(existing, incoming)

    assert len(result) == 1
    assert result[0]["title"] == "Обновлённое введение"
    assert result[0]["fixedHours"] == 4
    assert result[0]["workloadWeight"] == 1

def test_fixed_hours_survive_structure_pipeline():
    """Фиксированные часы сохраняются после повторного обновления структуры."""

    from backend.app.domain import apply_patch
    from backend.app.models import CourseDocument
    from backend.app.tools import execute_tool

    course = empty_course()

    course.brief.title = "Разработка REST API"
    course.brief.duration_hours = 36
    course.brief.attestation_hours = 2

    first_arguments = {
        "modules": [
            {
                "id": "m1",
                "title": "Основы HTTP",
                "hours": 4,
                "fixedHours": 4,
                "workloadWeight": 1,
                "topics": ["HTTP"],
                "learningOutcomes": ["Понимает HTTP"],
            },
            {
                "id": "m2",
                "title": "Разработка API",
                "hours": 30,
                "workloadWeight": 3,
                "topics": ["Маршрутизация", "Авторизация"],
                "learningOutcomes": ["Разрабатывает API"],
            },
        ]
    }

    first_patch = execute_tool(
        "set_structure",
        first_arguments,
        course,
        user_texts=[],
    )

    course = apply_patch(course, first_patch)

    assert [module.hours for module in course.modules] == [4, 30]
    assert course.modules[0].fixed_hours == 4

    # Агент повторно обновляет структуру, но не указывает fixedHours.
    second_arguments = {
        "modules": [
            {
                "id": "m1",
                "title": "Основы HTTP и REST",
                "hours": 12,
                "workloadWeight": 2,
                "topics": ["HTTP", "REST"],
                "learningOutcomes": ["Понимает REST API"],
            },
            {
                "id": "m2",
                "title": "Разработка API",
                "hours": 22,
                "workloadWeight": 5,
                "topics": ["Маршрутизация", "Авторизация"],
                "learningOutcomes": ["Разрабатывает API"],
            },
        ]
    }

    second_patch = execute_tool(
        "set_structure",
        second_arguments,
        course,
        user_texts=[],
    )

    updated = apply_patch(course, second_patch)
    serialized = updated.as_api()

    # Фиксированные часы не должны измениться.
    assert updated.modules[0].hours == 4
    assert updated.modules[0].fixed_hours == 4

    # Остальные часы должны быть перераспределены.
    assert updated.modules[1].hours == 30

    # Общий бюджет соблюдён.
    assert sum(module.hours for module in updated.modules) == 34

    # Ограничение сохранилось после сериализации.
    assert serialized["modules"][0]["fixedHours"] == 4

    # При этом обновление содержания модуля применилось.
    assert updated.modules[0].title == "Основы HTTP и REST"

def test_methodist_min_practice_hours_is_respected():
    """Минимум практики из требований методиста соблюдается."""

    from backend.app.domain import apply_patch
    from backend.app.models import empty_course

    course = empty_course()
    course.brief.title = "Разработка REST API"
    course.brief.duration_hours = 36
    course.brief.attestation_hours = 2

    course = apply_patch(
        course,
        {
            "type": "update_brief",
            "brief": {
                "hourConstraints": [
                    {
                        "field": "practiceHours",
                        "operator": "min",
                        "value": 12,
                        "source": "methodist",
                    }
                ]
            },
        },
    )

    course = apply_patch(
        course,
        {
            "type": "set_structure",
            "modules": [
                {
                    "id": "m1",
                    "title": "Основы HTTP",
                    "hours": 10,
                    "lectureHours": 10,
                    "practiceHours": 0,
                    "topics": ["HTTP"],
                    "learningOutcomes": ["Понимает HTTP"],
                },
                {
                    "id": "m2",
                    "title": "Разработка API",
                    "hours": 24,
                    "lectureHours": 24,
                    "practiceHours": 0,
                    "topics": ["Маршрутизация"],
                    "learningOutcomes": ["Разрабатывает API"],
                },
            ],
        },
    )

    modules = course.as_api()["modules"]

    total_practice = sum(
        module["practiceHours"]
        for module in modules
    )

    total_hours = sum(
        module["hours"]
        for module in modules
    )

    assert total_practice >= 12
    assert total_hours == 34

def test_min_practice_does_not_break_fixed_lecture_hours():
    """Минимум практики не должен нарушать фиксированные часы лекций."""

    from backend.app.domain import apply_patch

    course = empty_course()
    course.brief.title = "Разработка REST API"
    course.brief.duration_hours = 36
    course.brief.attestation_hours = 2

    course = apply_patch(
        course,
        {
            "type": "update_brief",
            "brief": {
                "hourConstraints": [
                    {
                        "field": "practiceHours",
                        "operator": "min",
                        "value": 12,
                        "source": "methodist",
                    },
                    {
                        "field": "lectureHours",
                        "operator": "eq",
                        "value": 20,
                        "source": "methodist",
                    },
                ]
            },
        },
    )

    # course = apply_patch(
    updated_course = apply_patch(
        course,
        {
            "type": "set_structure",
            "modules": [
                {
                    "id": "m1",
                    "title": "Основы HTTP",
                    "hours": 10,
                    "lectureHours": 10,
                    "practiceHours": 0,
                    "topics": ["HTTP"],
                    "learningOutcomes": ["Понимает принципы работы HTTP"],
                },
                {
                    "id": "m2",
                    "title": "Разработка API",
                    "hours": 24,
                    "lectureHours": 24,
                    "practiceHours": 0,
                    "topics": ["Маршрутизация"],
                    "learningOutcomes": ["Разрабатывает REST API"]
                },
            ],
        },
    )
    print("\n=== STRUCTURE DEBUG ===")
    print("Original modules:", len(course.modules))
    print("Updated modules:", len(updated_course.modules))
    print("Same object:", updated_course is course)

    course = updated_course
    modules = course.as_api()["modules"]

    total_lecture = sum(
        module["lectureHours"]
        for module in modules
    )

    total_practice = sum(
        module["practiceHours"]
        for module in modules
    )
    print("\n=== HOUR CONSTRAINT DEBUG ===")

    for module in modules:
        print(
            f"{module['title']}: "
            f"hours={module['hours']}, "
            f"lecture={module['lectureHours']}, "
            f"practice={module['practiceHours']}, "
            f"lab={module['labHours']}, "
            f"selfStudy={module['selfStudyHours']}"
        )

    print(f"TOTAL LECTURE: {total_lecture}")
    print(f"TOTAL PRACTICE: {total_practice}")
    print(
        "CONSTRAINTS:",
        course.as_api()["brief"].get("hourConstraints"),
    )
    assert total_lecture == 20
    assert total_practice >= 12

def test_allocate_hours_with_multiple_constraints():
    """Распределение соблюдает несколько ограничений одновременно."""

    from backend.app.domain import allocate_constrained_hours

    result = allocate_constrained_hours(
        target=34,
        weights={
            "lectureHours": 34,
            "practiceHours": 0,
            "labHours": 0,
            "selfStudyHours": 0,
        },
        constraints=[
            {
                "field": "practiceHours",
                "operator": "min",
                "value": 12,
            },
            {
                "field": "lectureHours",
                "operator": "eq",
                "value": 20,
            },
        ],
    )

    assert result["lectureHours"] == 20
    assert result["practiceHours"] >= 12

    assert sum(result.values()) == 34

    assert all(
        value >= 0 and (value * 2).is_integer()
        for value in result.values()
    )

def test_allocate_constrained_hours_respects_max_with_zero_weights():
    """Остаток распределяется, даже если доступные категории имеют нулевые веса."""

    from backend.app.domain import allocate_constrained_hours

    result = allocate_constrained_hours(
        target=10,
        weights={
            "lectureHours": 100,
            "practiceHours": 0,
            "labHours": 0,
            "selfStudyHours": 0,
        },
        constraints=[
            {
                "field": "lectureHours",
                "operator": "max",
                "value": 2,
            },
        ],
    )

    assert result["lectureHours"] <= 2
    assert sum(result.values()) == 10

    assert all(
        value >= 0 and (value * 2).is_integer()
        for value in result.values()
    )

def test_allocate_constrained_hours_rejects_impossible_minimums():
    """Нельзя выделить больше обязательных часов, чем есть в программе."""

    import pytest
    from backend.app.domain import allocate_constrained_hours

    with pytest.raises(ValueError, match="Сумма минимальных часов"):
        allocate_constrained_hours(
            target=20,
            weights={
                "lectureHours": 10,
                "practiceHours": 10,
                "labHours": 0,
                "selfStudyHours": 0,
            },
            constraints=[
                {
                    "field": "lectureHours",
                    "operator": "min",
                    "value": 15,
                },
                {
                    "field": "practiceHours",
                    "operator": "min",
                    "value": 10,
                },
            ],
        )

def test_allocate_constrained_hours_rejects_conflicting_bounds():
    """Противоречивые min и max для одного вида занятий вызывают ошибку."""

    import pytest
    from backend.app.domain import allocate_constrained_hours

    with pytest.raises(ValueError, match="Противоречивые ограничения"):
        allocate_constrained_hours(
            target=40,
            weights={
                "lectureHours": 20,
                "practiceHours": 10,
                "labHours": 5,
                "selfStudyHours": 5,
            },
            constraints=[
                {
                    "field": "lectureHours",
                    "operator": "min",
                    "value": 12,
                },
                {
                    "field": "lectureHours",
                    "operator": "max",
                    "value": 8,
                },
            ],
        )

@pytest.mark.parametrize(
    "target, weights, constraints",
    [
        (
            16,
            {"lectureHours": 8, "practiceHours": 8},
            [{"field": "practiceHours", "operator": "min", "value": 8}],
        ),
        (
            72,
            {"lectureHours": 40, "practiceHours": 32},
            [{"field": "lectureHours", "operator": "max", "value": 30}],
        ),
        (
            140,
            {"lectureHours": 60, "practiceHours": 60, "labHours": 20},
            [
                {"field": "practiceHours", "operator": "min", "value": 60},
                {"field": "lectureHours", "operator": "max", "value": 50},
            ],
        ),
        (
            25.5,
            {"lectureHours": 10, "practiceHours": 10, "selfStudyHours": 5.5},
            [{"field": "lectureHours", "operator": "eq", "value": 9.5}],
        ),
        (
            0,
            {"lectureHours": 1, "practiceHours": 1},
            [],
        ),
    ],
)
def test_allocate_constrained_hours_various_budgets(
    target, weights, constraints
):
    """Алгоритм работает с разными бюджетами и ограничениями."""

    from backend.app.domain import allocate_constrained_hours

    result = allocate_constrained_hours(
        target=target,
        weights=weights,
        constraints=constraints,
    )

    assert sum(result.values()) == target

    for value in result.values():
        assert value >= 0
        assert (value * 2).is_integer()

    for constraint in constraints:
        actual = result[constraint["field"]]
        expected = constraint["value"]

        if constraint["operator"] == "min":
            assert actual >= expected
        elif constraint["operator"] == "max":
            assert actual <= expected
        elif constraint["operator"] == "eq":
            assert actual == expected

def test_distribute_kinds_between_modules_preserves_budgets():
    """Распределение видов занятий сохраняет часы каждого модуля."""

    from backend.app.domain import distribute_kinds_between_modules

    modules = [
        {
            "id": "m1",
            "hours": 10,
            "lectureHours": 8,
            "practiceHours": 2,
            "labHours": 0,
            "selfStudyHours": 0,
            "plan": [
                {
                    "title": "Тема 1",
                    "lectureHours": 8,
                    "practiceHours": 2,
                    "labHours": 0,
                    "selfStudyHours": 0,
                }
            ],
        },
        {
            "id": "m2",
            "hours": 20,
            "lectureHours": 12,
            "practiceHours": 8,
            "labHours": 0,
            "selfStudyHours": 0,
            "plan": [
                {
                    "title": "Тема 2",
                    "lectureHours": 12,
                    "practiceHours": 8,
                    "labHours": 0,
                    "selfStudyHours": 0,
                }
            ],
        },
    ]
    target_kinds = {
        "lectureHours": 15,
        "practiceHours": 10,
        "labHours": 3,
        "selfStudyHours": 2,
    }

    result = distribute_kinds_between_modules(
        modules,
        target_kinds,
    )

    kind_keys = (
        "lectureHours",
        "practiceHours",
        "labHours",
        "selfStudyHours",
    )

    assert len(result) == len(modules)

    # Продолжительность каждого модуля неизменна.
    for original, updated in zip(modules, result):
        assert updated["hours"] == original["hours"]

        assert sum(
            updated[key] for key in kind_keys
        ) == updated["hours"]

    # Общие суммы совпадают с целевыми.
    for key in kind_keys:
        assert sum(
            module[key] for module in result
        ) == target_kinds[key]

    # Все часы неотрицательные и кратны 0.5.
    for module in result:
        for key in kind_keys:
            assert module[key] >= 0
            assert (module[key] * 2).is_integer()

def test_move_hours_between_kinds_preserves_topic_plan():
    """Перенос часов сохраняет бюджет модуля и согласованность плана."""

    from backend.app.domain import _move_hours_between_kinds

    module = {
        "hours": 12,
        "lectureHours": 8,
        "practiceHours": 4,
        "labHours": 0,
        "selfStudyHours": 0,
        "plan": [
            {
                "title": "Тема 1",
                "lectureHours": 5,
                "practiceHours": 1,
                "labHours": 0,
                "selfStudyHours": 0,
            },
            {
                "title": "Тема 2",
                "lectureHours": 3,
                "practiceHours": 3,
                "labHours": 0,
                "selfStudyHours": 0,
            },
        ],
    }

    moved = _move_hours_between_kinds(
        module,
        source_key="lectureHours",
        target_key="labHours",
        requested_hours=2.5,
    )

    assert moved == 2.5

    assert module["hours"] == 12
    assert module["lectureHours"] == 5.5
    assert module["practiceHours"] == 4
    assert module["labHours"] == 2.5

    kind_keys = (
        "lectureHours",
        "practiceHours",
        "labHours",
        "selfStudyHours",
    )

    assert sum(module[key] for key in kind_keys) == 12

    for key in kind_keys:
        assert sum(
            row[key] for row in module["plan"]
        ) == module[key]

    for row in module["plan"]:
        assert sum(row[key] for key in kind_keys) == 6

def test_distribute_kinds_preserves_topic_hours_and_original_data():
    """Распределение сохраняет часы тем и не изменяет входные данные."""

    from copy import deepcopy
    from backend.app.domain import distribute_kinds_between_modules

    modules = [
        {
            "id": "m1",
            "hours": 12,
            "fixedHours": 12,
            "workloadWeight": 2,
            "lectureHours": 8,
            "practiceHours": 4,
            "labHours": 0,
            "selfStudyHours": 0,
            "plan": [
                {
                    "title": "Тема 1",
                    "lectureHours": 5,
                    "practiceHours": 1,
                    "labHours": 0,
                    "selfStudyHours": 0,
                },
                {
                    "title": "Тема 2",
                    "lectureHours": 3,
                    "practiceHours": 3,
                    "labHours": 0,
                    "selfStudyHours": 0,
                },
            ],
        },
    ]

    original = deepcopy(modules)

    result = distribute_kinds_between_modules(
        modules,
        {
            "lectureHours": 5,
            "practiceHours": 4,
            "labHours": 2,
            "selfStudyHours": 1,
        },
    )

    module = result[0]
    kind_keys = (
        "lectureHours",
        "practiceHours",
        "labHours",
        "selfStudyHours",
    )

    # Входные данные не изменились.
    assert modules == original

    # Продолжительность и параметры модуля сохранились.
    assert module["hours"] == 12
    assert module["fixedHours"] == 12
    assert module["workloadWeight"] == 2

    # Продолжительность каждой темы осталась прежней.
    assert [
        sum(row[key] for key in kind_keys)
        for row in module["plan"]
    ] == [6, 6]

    # Тематический план согласован с модулем.
    for key in kind_keys:
        assert sum(
            row[key] for row in module["plan"]
        ) == module[key]

    # Целевое распределение выполнено.
    assert {
        key: module[key]
        for key in kind_keys
    } == {
        "lectureHours": 5,
        "practiceHours": 4,
        "labHours": 2,
        "selfStudyHours": 1,
    }

def test_apply_patch_rejects_impossible_hour_constraints():
    """Противоречивые ограничения не должны применяться молча."""

    import pytest

    from backend.app.domain import apply_patch

    course = empty_course()

    patch = {
        "brief": {
            "durationHours": 20,
            "attestationHours": 0,
            "hourConstraints": [
                {
                    "field": "lectureHours",
                    "operator": "min",
                    "value": 15,
                },
                {
                    "field": "practiceHours",
                    "operator": "min",
                    "value": 10,
                },
            ],
        },
        "modules": [
            {
                "id": "m1",
                "title": "Основной модуль",
                "hours": 20,
                "lectureHours": 10,
                "practiceHours": 10,
                "labHours": 0,
                "selfStudyHours": 0,
                "topics": ["Тема 1"],
                "learningOutcomes": ["Результат обучения"],
            },
        ],
    }

    # Сначала добавляем модуль в программу.
    course = apply_patch(
        course,
        {
            "type": "set_structure",
            "modules": patch["modules"],
        },
    )

    # Проверяем, что структура действительно добавлена.
    assert len(course.modules) == 1

    # Затем применяем ограничения методиста.
    # Они противоречивы: 15 + 10 > 20 часов.
    with pytest.raises(
        ValueError,
        match="Превышен бюджет учебных модулей",
    ):
        apply_patch(
            course,
            {
                "type": "update_brief",
                "brief": patch["brief"],
            },
        )

def test_apply_hour_constraints_uses_validator():
    """Перед распределением проверяются ограничения методиста."""

    import pytest

    from backend.app.domain import _apply_hour_constraints

    value = {
        "brief": {
            "durationHours": 20,
            "attestationHours": 0,
            "hourConstraints": [
                {
                    "field": "lectureHours",
                    "operator": "min",
                    "value": 15,
                },
                {
                    "field": "practiceHours",
                    "operator": "min",
                    "value": 10,
                },
            ],
        },
        "modules": [
            {
                "id": "m1",
                "hours": 20,
                "lectureHours": 10,
                "practiceHours": 10,
                "labHours": 0,
                "selfStudyHours": 0,
            }
        ],
    }

    with pytest.raises(
        ValueError,
        match="Превышен бюджет учебных модулей",
    ):
        _apply_hour_constraints(value)

def test_fill_plan_uses_profile_for_unallocated_hours():
    """Профиль используется, когда виды занятий ещё не распределены."""

    from backend.app.domain import _fill_plan

    module = {
        "id": "m1",
        "title": "Основной модуль",
        "hours": 20,
        "topics": ["Тема 1"],
        "learningOutcomes": ["Результат обучения"],
    }

    profile_weights = {
        "lectureHours": 1,
        "practiceHours": 5,
        "labHours": 3,
        "selfStudyHours": 1,
    }

    result = _fill_plan(
        module,
        profile_weights=profile_weights,
    )

    assert result["hours"] == 20

    assert (
        result["lectureHours"]
        + result["practiceHours"]
        + result["labHours"]
        + result["selfStudyHours"]
    ) == 20

    assert result["practiceHours"] > result["lectureHours"]
    assert result["labHours"] > result["lectureHours"]

    assert sum(
        row["practiceHours"]
        for row in result["plan"]
    ) == result["practiceHours"]

def test_fill_plan_preserves_existing_kind_weights():
    """Рекомендательный профиль не заменяет заданные пропорции."""

    from backend.app.domain import _fill_plan

    module = {
        "id": "m1",
        "title": "Практический модуль",
        "hours": 20,
        "lectureHours": 0,
        "practiceHours": 15,
        "labHours": 0,
        "selfStudyHours": 5,
        "topics": ["Тема 1"],
        "learningOutcomes": ["Результат обучения"],
    }

    profile_weights = {
        "lectureHours": 5,
        "practiceHours": 2,
        "labHours": 1,
        "selfStudyHours": 2,
    }

    result = _fill_plan(
        module,
        profile_weights=profile_weights,
    )

    assert result["lectureHours"] == 0
    assert result["practiceHours"] == 15
    assert result["selfStudyHours"] == 5