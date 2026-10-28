from app.curriculum_rules.validator import validate_allocated_hours


def test_allocated_hours_respect_minimum():
    errors = validate_allocated_hours(
        constraints=[
            {
                "field": "practiceHours",
                "operator": "min",
                "value": 20,
                "source": "methodist",
            }
        ],
        modules=[
            {
                "hours": 36,
                "lectureHours": 12,
                "practiceHours": 20,
                "labHours": 4,
                "selfStudyHours": 0,
            }
        ],
        duration_hours=36,
    )

    assert errors == []


def test_allocated_hours_detect_violation():
    errors = validate_allocated_hours(
        constraints=[
            {
                "field": "practiceHours",
                "operator": "min",
                "value": 20,
                "source": "methodist",
            }
        ],
        modules=[
            {
                "hours": 36,
                "lectureHours": 24,
                "practiceHours": 12,
                "labHours": 0,
                "selfStudyHours": 0,
            }
        ],
        duration_hours=36,
    )

    assert any("practiceHours" in error for error in errors)


def test_allocated_hours_check_attestation():
    errors = validate_allocated_hours(
        constraints=[
            {
                "field": "attestationHours",
                "operator": "eq",
                "value": 4,
                "source": "methodist",
            }
        ],
        modules=[
            {
                "hours": 32,
                "lectureHours": 12,
                "practiceHours": 20,
                "labHours": 0,
                "selfStudyHours": 0,
            }
        ],
        duration_hours=36,
        attestation_hours=4,
    )

    assert errors == []