from backend.app.verbatim import generated_text, stored_source_status, verbatim_spans


def test_http_source_stays_unconfirmed() -> None:
    assert stored_source_status("https://example.com/order") == "unconfirmed"
    assert stored_source_status("") == "unconfirmed"
    assert stored_source_status("профстандарт.pdf") == "confirmed"
    assert stored_source_status(None) == "unconfirmed"
    assert stored_source_status("http://example.com/order") == "unconfirmed"


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


def test_copy_in_criterion_or_answer_is_flagged() -> None:
    fragment = " ".join(["слово"] * 12)
    course = {
        "brief": {"references": [{"note": fragment}]},
        "lectures": [],
        "seminars": [{"tasks": [{"criteria": [fragment]}]}],
        "assessments": [],
    }
    assert verbatim_spans(course)

    course["seminars"] = []
    course["assessments"] = [{"questions": [{"answer": fragment}]}]
    assert verbatim_spans(course)


def test_eleven_words_and_split_bullets_are_not_a_copy() -> None:
    words = [f"слово{index}" for index in range(12)]
    course = {
        "brief": {"references": [{"note": " ".join(words)}]},
        "lectures": [{"slides": [{"bullets": [" ".join(words[:11])]}]}],
        "seminars": [],
        "assessments": [],
    }
    assert verbatim_spans(course) == []

    course["lectures"] = [
        {"slides": [{"bullets": [" ".join(words[:6]), " ".join(words[6:])]}]}
    ]
    assert verbatim_spans(course) == []


def test_short_citation_is_not_a_copy() -> None:
    course = {
        "brief": {"references": [{"title": "Приказ № 629", "note": "Официальное опубликование."}]},
        "lectures": [{"slides": [{"bullets": ["Официальное опубликование."]}]}],
        "seminars": [],
        "assessments": [],
    }
    assert verbatim_spans(course) == []


def test_non_dict_rows_are_skipped_and_three_hits_stop_the_scan() -> None:
    words = [f"слово{index}" for index in range(12)]
    spans = [" ".join(f"{word}{mark}" for word in words) for mark in ("а", "б", "в", "г")]
    course = {
        "brief": {"references": ["не словарь", {"note": "\n".join(spans)}]},
        "lectures": [
            "не лекция",
            {
                "outline": [spans[0]],
                "slides": [
                    "не слайд",
                    {"title": spans[1], "bullets": [spans[2]], "speakerNotes": spans[3]},
                ],
            },
        ],
        "seminars": [
            "не семинар",
            {"tasks": ["не задание", {"title": spans[0], "prompt": "", "steps": [], "criteria": []}]},
        ],
        "assessments": [
            "не тест",
            {"questions": ["не вопрос", {"stem": spans[1], "answer": "", "explanation": "", "options": []}]},
        ],
    }
    assert len(verbatim_spans(course)) == 3
    assert spans[0].split()[0] in generated_text(course)
