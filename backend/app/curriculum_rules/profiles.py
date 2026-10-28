import json
from pathlib import Path
from typing import Any


PROFILE_PATH = Path(__file__).with_name("workload_profiles.json")

KIND_KEYS = (
    "lectureHours",
    "practiceHours",
    "labHours",
    "selfStudyHours",
)


def get_workload_weights(brief: dict[str, Any]) -> dict[str, float]:
    """Возвращает рекомендательные веса по формату программы."""

    profile_id = (
        brief.get("format", "blended")
        if brief.get("formatNamed") is True
        else "default"
    )

    with PROFILE_PATH.open("r", encoding="utf-8") as file:
        data = json.load(file)

    profiles = {
        profile["id"]: profile
        for profile in data["profiles"]
    }

    if profile_id not in profiles:
        raise ValueError(
            f"Не найден профиль распределения часов: {profile_id}"
        )

    weights = profiles[profile_id]["weights"]

    if set(weights) != set(KIND_KEYS):
        raise ValueError(
            f"Некорректный набор видов занятий в профиле {profile_id}"
        )

    result = {}

    for key in KIND_KEYS:
        weight = weights[key]

        if (
            isinstance(weight, bool)
            or not isinstance(weight, (int, float))
            or not 0 <= weight < float("inf")
        ):
            raise ValueError(
                f"Некорректный вес {key} в профиле {profile_id}"
            )

        result[key] = float(weight)

    if not any(result.values()):
        raise ValueError(
            f"Все веса профиля {profile_id} равны нулю"
        )

    return result