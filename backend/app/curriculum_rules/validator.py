from collections import defaultdict
from typing import Any


MODULE_HOUR_FIELDS = (
    "lectureHours",
    "practiceHours",
    "labHours",
    "selfStudyHours",
)


def validate_hour_constraints(
    constraints: list[dict[str, Any]],
    duration_hours: float | None = None,
    attestation_hours: float = 0,
) -> list[str]:
    """Проверяет совместимость ограничений и бюджет часов курса.

    duration_hours — полная продолжительность курса.
    attestation_hours — часы аттестации, включённые в duration_hours.

    Если duration_hours не указан, проверяются только ограничения
    между собой.
    """

    errors: list[str] = []
    grouped = defaultdict(list)

    for constraint in constraints:
        field = constraint["field"]
        grouped[field].append(constraint)

    bounds: dict[str, tuple[float, float]] = {}

    # 1. Проверяем совместимость ограничений каждого поля.
    for field, rules in grouped.items():
        minimum = 0.0
        maximum = float("inf")
        exact_values = set()

        for rule in rules:
            operator = rule["operator"]
            value = float(rule["value"])

            if operator == "min":
                minimum = max(minimum, value)

            elif operator == "max":
                maximum = min(maximum, value)

            elif operator == "eq":
                exact_values.add(value)

        if minimum > maximum:
            errors.append(
                f"{field}: минимальное количество часов "
                f"{minimum} превышает максимальное {maximum}"
            )

        if len(exact_values) > 1:
            errors.append(
                f"{field}: указаны разные фиксированные значения часов"
            )

        if len(exact_values) == 1:
            exact = next(iter(exact_values))

            if exact < minimum or exact > maximum:
                errors.append(
                    f"{field}: фиксированное значение {exact} "
                    f"не соответствует диапазону "
                    f"от {minimum} до {maximum}"
                )

            # Фиксированное значение задаёт обе границы.
            minimum = max(minimum, exact)
            maximum = min(maximum, exact)

        bounds[field] = (minimum, maximum)

    # 2. Если общая продолжительность неизвестна,
    # проверка бюджета пока невозможна.
    if duration_hours is None:
        return errors

    # 3. Проверяем корректность бюджета курса.
    if duration_hours < 0:
        errors.append("Общая продолжительность курса не может быть отрицательной")
        return errors

    if attestation_hours < 0:
        errors.append("Продолжительность аттестации не может быть отрицательной")
        return errors

    if attestation_hours > duration_hours:
        errors.append(
            "Аттестация превышает общую продолжительность курса"
        )
        return errors

    # 4. Проверяем ограничения непосредственно на аттестацию.
    attestation_min, attestation_max = bounds.get(
        "attestationHours",
        (0.0, float("inf")),
    )

    if not attestation_min <= attestation_hours <= attestation_max:
        errors.append(
            f"attestationHours: заданные {attestation_hours} ч "
            "не соответствуют ограничениям"
        )

    # 5. Рассчитываем доступный бюджет учебных модулей.
    module_budget = duration_hours - attestation_hours

    required_minimum = sum(
        bounds.get(field, (0.0, float("inf")))[0]
        for field in MODULE_HOUR_FIELDS
    )

    if required_minimum > module_budget:
        errors.append(
            f"Превышен бюджет учебных модулей: "
            f"минимально требуется {required_minimum} ч, "
            f"доступно {module_budget} ч"
        )

    # 6. Проверяем верхние границы.
    maximum_total = sum(
        bounds.get(field, (0.0, float("inf")))[1]
        for field in MODULE_HOUR_FIELDS
    )

    if maximum_total < module_budget:
        errors.append(
            f"Бюджет учебных модулей невозможно заполнить: "
            f"максимально разрешено {maximum_total} ч, "
            f"необходимо {module_budget} ч"
        )

    # 7. Проверяем ограничение на общий объём программы.
    duration_min, duration_max = bounds.get(
        "hours",
        (0.0, float("inf")),
    )

    if not duration_min <= duration_hours <= duration_max:
        errors.append(
            f"hours: продолжительность курса {duration_hours} ч "
            "не соответствует ограничениям"
        )

    return errors