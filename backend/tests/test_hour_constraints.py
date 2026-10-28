from backend.app.curriculum_rules.validator import validate_hour_constraints


def test_detects_conflicting_min_and_max() -> None:
    """Валидатор обнаруживает несовместимые ограничения."""

    constraints = [
        {
            "field": "practiceHours",
            "operator": "min",
            "value": 10,
            "source": "methodist",
        },
        {
            "field": "practiceHours",
            "operator": "max",
            "value": 6,
            "source": "methodist",
        },
    ]

    errors = validate_hour_constraints(constraints)

    assert errors
    assert any("practiceHours" in error for error in errors)


def test_accepts_compatible_constraints() -> None:
    """Совместимые ограничения не вызывают ошибок."""

    constraints = [
        {
            "field": "practiceHours",
            "operator": "min",
            "value": 8,
            "source": "methodist",
        },
        {
            "field": "practiceHours",
            "operator": "max",
            "value": 12,
            "source": "methodist",
        },
    ]

    errors = validate_hour_constraints(constraints)

    assert errors == []

def test_accepts_exact_value_within_range() -> None:
    """Фиксированное значение внутри диапазона допустимо."""

    constraints = [
        {"field": "selfStudyHours", "operator": "eq", "value": 254},
        {"field": "selfStudyHours", "operator": "min", "value": 200},
    ]

    assert validate_hour_constraints(constraints) == []


def test_detects_exact_value_conflict() -> None:
    """Фиксированное значение не может нарушать минимум."""

    constraints = [
        {"field": "lectureHours", "operator": "eq", "value": 0},
        {"field": "lectureHours", "operator": "min", "value": 2},
    ]

    errors = validate_hour_constraints(constraints)

    assert errors
    assert any("lectureHours" in error for error in errors)


def test_detects_different_exact_values() -> None:
    """Два разных фиксированных значения несовместимы."""

    constraints = [
        {"field": "practiceHours", "operator": "eq", "value": 8},
        {"field": "practiceHours", "operator": "eq", "value": 10},
    ]

    errors = validate_hour_constraints(constraints)

    assert errors
    assert any("practiceHours" in error for error in errors)

def test_detects_constraints_exceeding_course_budget() -> None:
    """Сумма обязательных часов не должна превышать бюджет курса."""

    constraints = [
        {"field": "practiceHours", "operator": "min", "value": 12},
        {"field": "lectureHours", "operator": "min", "value": 8},
    ]

    errors = validate_hour_constraints(
        constraints,
        duration_hours=16,
        attestation_hours=0,
    )

    assert errors
    assert any("бюджет" in error.lower() for error in errors)


def test_accepts_constraints_within_course_budget() -> None:
    """Совместимые требования укладываются в бюджет курса."""

    constraints = [
        {"field": "practiceHours", "operator": "min", "value": 8},
        {"field": "lectureHours", "operator": "min", "value": 4},
    ]

    errors = validate_hour_constraints(
        constraints,
        duration_hours=16,
        attestation_hours=0,
    )

    assert errors == []


def test_attestation_reduces_available_module_hours() -> None:
    """Часы аттестации вычитаются из бюджета учебных модулей."""

    constraints = [
        {"field": "practiceHours", "operator": "min", "value": 20},
        {"field": "lectureHours", "operator": "min", "value": 15},
    ]

    errors = validate_hour_constraints(
        constraints,
        duration_hours=36,
        attestation_hours=2,
    )

    # Доступно 34 часа, а требуется минимум 35.
    assert errors
    assert any("бюджет" in error.lower() for error in errors)


def test_accepts_devops_hour_constraints() -> None:
    """Проверяем строгие требования к программе DevOps."""

    constraints = [
        {"field": "selfStudyHours", "operator": "eq", "value": 254},
        {"field": "lectureHours", "operator": "eq", "value": 0},
        {"field": "practiceHours", "operator": "eq", "value": 0},
        {"field": "labHours", "operator": "eq", "value": 0},
    ]

    errors = validate_hour_constraints(
        constraints,
        duration_hours=256,
        attestation_hours=2,
    )

    assert errors == []