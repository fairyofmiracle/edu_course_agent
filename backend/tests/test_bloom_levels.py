# -*- coding: utf-8 -*-
"""Bloom level resolution: aliases, inference, no silent all-to-apply."""

from backend.app.tools import (
    _clean_competency_node,
    _normalize_bloom_token,
    _infer_bloom_level,
    _resolve_bloom_level,
    _diversify_bloom_levels,
)


def test_normalize_russian_ui_labels():
    assert _normalize_bloom_token("Знать") == "remember"
    assert _normalize_bloom_token("понимать") == "understand"
    assert _normalize_bloom_token("Применять") == "apply"
    assert _normalize_bloom_token("анализировать") == "analyze"
    assert _normalize_bloom_token("Оценивать") == "evaluate"
    assert _normalize_bloom_token("создавать") == "create"


def test_normalize_noun_forms_and_english():
    assert _normalize_bloom_token("знание") == "remember"
    assert _normalize_bloom_token("понимание") == "understand"
    assert _normalize_bloom_token("analyse") == "analyze"
    assert _normalize_bloom_token("3. apply") == "apply"


def test_missing_bloom_infers_from_wording():
    level = _resolve_bloom_level(
        None,
        "Оценка качества алгоритмов",
        ["критерии сравнения"],
        ["оценивать варианты"],
        ["выбор лучшего решения"],
        0,
    )
    assert level == "evaluate"


def test_missing_bloom_infers_create():
    level = _resolve_bloom_level(
        "",
        "Разработка собственной структуры",
        ["этапы проектирования"],
        ["создавать прототип"],
        ["спроектировать решение"],
        0,
    )
    assert level == "create"


def test_missing_bloom_does_not_all_default_apply():
    nodes = [
        _clean_competency_node({"id": f"c{i}", "name": f"Узел {i}", "knowledge": ["факт"], "skills": ["шаг"], "abilities": ["приём"]}, i, True)
        for i in range(6)
    ]
    levels = [n["bloomLevel"] for n in nodes]
    # round-robin across Bloom when no wording signal beyond generic fallbacks
    assert len(set(levels)) >= 3
    assert not all(level == "apply" for level in levels)


def test_explicit_bloom_preserved():
    node = _clean_competency_node(
        {
            "id": "c1",
            "name": "Анализ данных",
            "bloomLevel": "analyze",
            "knowledge": ["методы"],
            "skills": ["разбирать"],
            "abilities": ["выявлять"],
        },
        0,
        True,
    )
    assert node["bloomLevel"] == "analyze"


def test_russian_bloom_label_preserved():
    node = _clean_competency_node(
        {
            "id": "c1",
            "name": "Базовые понятия",
            "bloomLevel": "Знать",
            "knowledge": ["термины"],
            "skills": ["называть"],
            "abilities": ["перечислять"],
        },
        0,
        True,
    )
    assert node["bloomLevel"] == "remember"


def test_diversify_collapses_all_apply():
    nodes = [
        {
            "id": f"c{i}",
            "name": name,
            "bloomLevel": "apply",
            "knowledge": [know],
            "skills": [skill],
            "abilities": [abil],
        }
        for i, (name, know, skill, abil) in enumerate(
            [
                ("Базовые термины", "знать термины", "перечислить", "вспомнить определения"),
                ("Объяснение схем", "понимание схем", "объяснять", "интерпретировать"),
                ("Практика расчётов", "формулы", "применять расчёт", "выполнять задачи"),
                ("Сравнение подходов", "анализ", "сравнивать", "выявлять различия"),
                ("Критерии выбора", "критерии", "оценивать варианты", "выбор лучшего"),
                ("Проектирование модуля", "этапы проектирования", "создавать прототип", "разрабатывать"),
            ]
        )
    ]
    out = _diversify_bloom_levels(nodes)
    levels = [n["bloomLevel"] for n in out]
    assert len(set(levels)) >= 4
    assert levels[0] == "remember"
    assert levels[-1] == "create"
