import json

from app.curriculum_rules import regulations


def test_empty_regulations(monkeypatch, tmp_path):
    path = tmp_path / "constraints.json"

    path.write_text(
        json.dumps({"version": "1.0", "rules": []}),
        encoding="utf-8",
    )

    monkeypatch.setattr(regulations, "CONSTRAINTS_PATH", path)

    assert regulations.load_regulation_constraints("qualification") == []


def test_regulation_applies_to_matching_program(monkeypatch, tmp_path):
    path = tmp_path / "constraints.json"

    path.write_text(
        json.dumps({
            "version": "1.0",
            "rules": [
                {
                    "programKind": "qualification",
                    "hourConstraints": [
                        {
                            "field": "practiceHours",
                            "operator": "min",
                            "value": 12,
                        }
                    ],
                }
            ],
        }),
        encoding="utf-8",
    )

    monkeypatch.setattr(regulations, "CONSTRAINTS_PATH", path)

    assert regulations.load_regulation_constraints("qualification") == [
        {
            "field": "practiceHours",
            "operator": "min",
            "value": 12.0,
            "source": "regulation",
        }
    ]

    assert regulations.load_regulation_constraints("other") == []


def test_invalid_regulations_raise_error(monkeypatch, tmp_path):
    path = tmp_path / "constraints.json"

    path.write_text(
        json.dumps({"rules": "invalid"}),
        encoding="utf-8",
    )

    monkeypatch.setattr(regulations, "CONSTRAINTS_PATH", path)

    try:
        regulations.load_regulation_constraints("qualification")
    except ValueError:
        pass
    else:
        raise AssertionError("Ожидалась ошибка структуры constraints.json")

def test_regulation_applied_during_course_rebalance(monkeypatch, tmp_path):
    """Норматив из JSON влияет на фактическое распределение часов."""
    from app.domain import apply_patch
    from app.models import empty_course

    path = tmp_path / "constraints.json"
    path.write_text(
        json.dumps({
            "version": "1.0",
            "rules": [
                {
                    "programKind": "qualification",
                    "hourConstraints": [
                        {
                            "field": "practiceHours",
                            "operator": "min",
                            "value": 12,
                        }
                    ],
                }
            ],
        }),
        encoding="utf-8",
    )

    monkeypatch.setattr(regulations, "CONSTRAINTS_PATH", path)

    course = empty_course()
    course.brief.title = "Основы Python"
    course.brief.program_kind = "qualification"
    course.brief.duration_hours = 24

    updated = apply_patch(
        course,
        {
            "type": "set_structure",
            "modules": [
                {
                    "id": "m1",
                    "title": "Основы Python",
                    "hours": 24,
                    "lectureHours": 20,
                    "practiceHours": 4,
                    "topics": ["Введение", "Практика"],
                    "learningOutcomes": ["Пишет простые программы"],
                }
            ],
        },
    )

    actual_practice = sum(
        module.practice_hours
        for module in updated.modules
    )

    assert actual_practice >= 12

    # Норматив не записывается в пользовательский Brief.
    assert updated.brief.hour_constraints == []