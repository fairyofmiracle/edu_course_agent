from backend.app.verbatim import stored_source_status, verbatim_spans


def test_http_source_stays_unconfirmed() -> None:
    assert stored_source_status("https://example.com/order") == "unconfirmed"
    assert stored_source_status("") == "unconfirmed"
    assert stored_source_status("профстандарт.pdf") == "source_attached"


def test_verbatim_span_is_flagged() -> None:
    fragment = (
        "слушатель собирает учебный план и сверяет часы модулей с объёмом программы перед печатью комплекта"
    )
    course = {
        "brief": {"references": [{"title": "Образец", "note": fragment}]},
        "lectures": [
            {
                "outline": [],
                "slides": [{"title": "Ход", "bullets": [fragment], "speakerNotes": ""}],
            }
        ],
        "seminars": [],
        "assessments": [],
    }
    hits = verbatim_spans(course)
    assert hits
    assert "учебный план" in hits[0]


def test_short_citation_is_not_a_copy() -> None:
    course = {
        "brief": {"references": [{"title": "Приказ № 629", "note": "Официальное опубликование."}]},
        "lectures": [{"slides": [{"bullets": ["Официальное опубликование."]}]}],
        "seminars": [],
        "assessments": [],
    }
    assert verbatim_spans(course) == []
