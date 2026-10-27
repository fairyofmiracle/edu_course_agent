# from backend.app.domain import allocate_integer
from backend.app.domain import allocate_integer, balance_modules

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

# from backend.app.hour_allocation import allocate_with_fixed_hours


# def test_fixed_module_hours_are_preserved() -> None:
#     """
#     Явно заданные методистом часы нельзя изменять
#     при распределении оставшегося времени.
#     """

#     result = allocate_with_fixed_hours(
#         total_hours=38,
#         weights=[1, 2, 3],
#         fixed_hours={1: 12},
#     )

#     assert result == [6.5, 12, 19.5]


# def test_fixed_hours_cannot_exceed_total() -> None:
#     """
#     Невозможно распределить больше часов,
#     чем предусмотрено программой.
#     """

#     with pytest.raises(ValueError):
#         allocate_with_fixed_hours(
#             total_hours=20,
#             weights=[1, 2, 3],
#             fixed_hours={0: 12, 1: 10},
#         )

#     from backend.app.domain import balance_modules


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