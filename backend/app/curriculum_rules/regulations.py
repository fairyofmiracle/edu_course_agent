"""Загрузка нормативных ограничений учебных программ."""

import json
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from ..models import HourConstraint


CONSTRAINTS_PATH = Path(__file__).with_name("constraints.json")


def load_regulation_constraints(
    program_kind: str | None = None,
) -> list[dict[str, Any]]:
    """Возвращает нормативные ограничения, применимые к программе.

    Правило применяется только при точном совпадении programKind.
    Правила без programKind не применяются автоматически.
    """

    with CONSTRAINTS_PATH.open(encoding="utf-8") as file:
        data = json.load(file)

    if not isinstance(data, dict) or not isinstance(data.get("rules"), list):
        raise ValueError("Некорректная структура constraints.json")

    constraints = []

    for rule in data["rules"]:
        if not isinstance(rule, dict):
            raise ValueError("Некорректное правило в constraints.json")

        if not program_kind or rule.get("programKind") != program_kind:
            continue

        raw_constraints = rule.get("hourConstraints", [])

        if not isinstance(raw_constraints, list):
            raise ValueError("hourConstraints должны быть списком")

        for raw in raw_constraints:
            if not isinstance(raw, dict):
                raise ValueError("Некорректное нормативное ограничение")

            try:
                constraint = HourConstraint.model_validate(
                    {**raw, "source": "regulation"}
                )
            except ValidationError as error:
                raise ValueError(
                    "Некорректное ограничение в constraints.json"
                ) from error

            constraints.append(constraint.model_dump())

    return constraints