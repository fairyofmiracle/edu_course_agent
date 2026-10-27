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

# def test_fixed_hours_zero_is_preserved():
#     """Нулевые фиксированные часы не перераспределяются."""

#     modules = [
#         {
#             "id": "m1",
#             "title": "Введение",
#             "hours": 5,
#             "fixedHours": 0,
#         },
#         {
#             "id": "m2",
#             "title": "Практика",
#             "hours": 5,
#             "workloadWeight": 1,
#         },
#     ]

#     result = balance_modules(
#         modules,
#         duration_hours=12,
#         attestation_hours=2,
#     )

#     assert [module["hours"] for module in result] == [0, 10]


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