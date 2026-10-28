import pytest

from app.brief_guard import extract_hour_constraints


@pytest.mark.parametrize(
    "text, expected",
    [
        (
            "Практики минимум 25 часов",
            [
                {
                    "field": "practiceHours",
                    "operator": "min",
                    "value": 25.0,
                    "source": "methodist",
                }
            ],
        ),
        (
            "Не менее 30 часов практики",
            [
                {
                    "field": "practiceHours",
                    "operator": "min",
                    "value": 30.0,
                    "source": "methodist",
                }
            ],
        ),
        (
            "Лекций максимум 10 часов",
            [
                {
                    "field": "lectureHours",
                    "operator": "max",
                    "value": 10.0,
                    "source": "methodist",
                }
            ],
        ),
        (
            "Не больше 15 часов лекций",
            [
                {
                    "field": "lectureHours",
                    "operator": "max",
                    "value": 15.0,
                    "source": "methodist",
                }
            ],
        ),
        (
            "Практики ровно 20 часов",
            [
                {
                    "field": "practiceHours",
                    "operator": "eq",
                    "value": 20.0,
                    "source": "methodist",
                }
            ],
        ),
        (
            "Курс на 72 часа",
            [],
        ),
        (
            "Создай курс Python для начинающих",
            [],
        ),
    ],
)
def test_extract_hour_constraints(text, expected):
    assert extract_hour_constraints(text) == expected


def test_extract_multiple_hour_constraints():
    text = (
        "Создай курс на 72 часа "
        "практики минимум 30 часов "
        "лекций максимум 20 часов"
    )

    assert extract_hour_constraints(text) == [
        {
            "field": "practiceHours",
            "operator": "min",
            "value": 30.0,
            "source": "methodist",
        },
        {
            "field": "lectureHours",
            "operator": "max",
            "value": 20.0,
            "source": "methodist",
        },
    ]


def test_extract_constraints_without_punctuation():
    text = "Практики не менее 25 часов лекций не более 10 часов"

    assert extract_hour_constraints(text) == [
        {
            "field": "practiceHours",
            "operator": "min",
            "value": 25.0,
            "source": "methodist",
        },
        {
            "field": "lectureHours",
            "operator": "max",
            "value": 10.0,
            "source": "methodist",
        },
    ]

def test_overlapping_hour_constraints_are_not_duplicated():
    text = (
        "Практики минимум 30 часов "
        "лекций максимум 20 часов "
        "лабораторных ровно 10 часов"
    )

    result = extract_hour_constraints(text)

    assert result == [
        {
            "field": "practiceHours",
            "operator": "min",
            "value": 30.0,
            "source": "methodist",
        },
        {
            "field": "lectureHours",
            "operator": "max",
            "value": 20.0,
            "source": "methodist",
        },
        {
            "field": "labHours",
            "operator": "eq",
            "value": 10.0,
            "source": "methodist",
        },
    ]