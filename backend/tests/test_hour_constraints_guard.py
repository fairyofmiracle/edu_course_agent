from app.brief_guard import guard_brief


def test_guard_restores_hour_constraints_without_llm():
    brief, dropped = guard_brief(
        patch={},
        current={"durationHours": 0},
        user_texts=[
            "Создай курс Python на 72 часа "
            "практики минимум 30 часов "
            "лекций максимум 20 часов"
        ],
    )

    assert brief["durationHours"] == 72

    assert brief["hourConstraints"] == [
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


def test_guard_corrects_wrong_llm_constraint():
    brief, dropped = guard_brief(
        patch={
            "hourConstraints": [
                {
                    "field": "practiceHours",
                    "operator": "min",
                    "value": 20,
                    "source": "methodist",
                }
            ]
        },
        current={"durationHours": 72},
        user_texts=[
            "Практики минимум 30 часов"
        ],
    )

    assert brief["hourConstraints"] == [
        {
            "field": "practiceHours",
            "operator": "min",
            "value": 30.0,
            "source": "methodist",
        }
    ]


def test_guard_keeps_unrelated_llm_constraints():
    brief, dropped = guard_brief(
        patch={
            "hourConstraints": [
                {
                    "field": "labHours",
                    "operator": "max",
                    "value": 10,
                    "source": "methodist",
                }
            ]
        },
        current={"durationHours": 72},
        user_texts=[
            "Практики минимум 30 часов"
        ],
    )

    assert brief["hourConstraints"] == [
        {
            "field": "labHours",
            "operator": "max",
            "value": 10,
            "source": "methodist",
        },
        {
            "field": "practiceHours",
            "operator": "min",
            "value": 30.0,
            "source": "methodist",
        },
    ]


def test_guard_does_not_invent_hour_constraints():
    brief, dropped = guard_brief(
        patch={},
        current={"durationHours": 0},
        user_texts=[
            "Создай курс Python для начинающих"
        ],
    )

    assert "hourConstraints" not in brief