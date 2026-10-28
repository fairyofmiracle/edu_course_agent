from __future__ import annotations

import re
from typing import Any

HOURS = re.compile(
    r"(\d+)\s*(?:(?:академическ\w*|учебн\w*)\s+|ак\.?\s*)?"
    r"(?:часов|часа|час\b|ч(?![а-яё]))",
    re.IGNORECASE,
)
HOURS_NAMED = re.compile(
    r"(?:часов|часа|часы|час)\s+(?:на|до)\s+(\d{1,4})\b",
    re.IGNORECASE,
)

VOLUME = re.compile(
    r"(?:объ[её]м\w*|на)\s*[:—-]?\s*(\d+)\s*"
    r"(?:(?:академическ\w*|учебн\w*)\s+|ак\.?\s*)?"
    r"(?:часов|часа|час\b|ч(?![а-яё]))",
    re.IGNORECASE,
)
SERVICE_PROMPT = re.compile(r"^(Собери |Каркас утверждён)")
LEAD = re.compile(
    r"^(?:сделайте|сделаем|делаем|давайте|давай|хочу|нужна|нужен|нужно|прошу)\s+",
    re.IGNORECASE,
)
AUDIENCE = re.compile(
    r"для\s+((?:школьник|учител|педагог|студент|сотрудник|слушател|взросл|методист)[^.,]{0,120})",
    re.IGNORECASE,
)
AUDIENCE_BARE = re.compile(
    r"((?:студенты|сотрудники|учителя|школьники|слушатели|методисты)\s+[^.,]{0,80})",
    re.IGNORECASE,
)
ATTESTATION_CANCEL = re.compile(
    r"(?:"
    r"(?:итогов\w*\s+)?аттестац\w*.{0,40}?"
    r"(?:не\s+предусмотрен\w*|не\s+нужн\w*|не\s+будет|отмен\w*|убрат\w*)"
    r"|"
    r"(?:убери|убрать|отмени|отменить|без)\s+"
    r"(?:итогов\w*\s+)?аттестац\w*"
    r")",
    re.IGNORECASE,
)
ATTESTATION_MARKERS = (
    (re.compile(r"защит\w+\s+отч[её]т", re.IGNORECASE), "защита отчёта о стажировке"),
    (re.compile(r"портфолио", re.IGNORECASE), "зачёт по портфолио"),
    (re.compile(r"экзамен", re.IGNORECASE), "экзамен с практическим заданием"),
    (re.compile(r"зач[её]т", re.IGNORECASE), "зачёт"),
    (
        re.compile(r"(?:защит|защищ)\w*.{0,24}(?:проект|макет)", re.IGNORECASE),
        "защита проекта",
    ),
    (
        re.compile(
            r"одностранич|(?:а+т+естац|итогов).{0,60}(?:(?:веб-)?сайт)|"
            r"проверк\w*.{0,24}сайт",
            re.IGNORECASE,
        ),
        "защита проекта",
    ),
    (
        re.compile(
            r"(?:"
            r"(?:итогов\w*|финальн\w*|аттестац\w*|итогов\w*\s+контрол\w*)"
            r".{0,45}?"
            r"\bтест\w*"
            r"|"
            r"\bтест\w*"
            r".{0,45}?"
            r"(?:итогов\w*|финальн\w*|аттестац\w*)"
            r")",
            re.IGNORECASE,
        ),
        "тест",
    ),
)
KIND_MARKERS = {
    "general": re.compile(
        r"общеразвива|программ\w*.{0,40}сертификат|с\s+сертификат",
        re.IGNORECASE,
    ),
    "qualification": re.compile(
        r"повышени\w*\s+квалификац|удостоверени|профстандарт|"
        r"профессиональн\w*\s+стандарт|(?<![а-яё])пк(?![а-яё])",
        re.IGNORECASE,
    ),
}


SAMPLE_NEAR = re.compile(r"образец|приложен|референс", re.IGNORECASE)
KNOWN_WORDS = (
    "студентов",
    "студенты",
    "студента",
    "изучения",
    "изучение",
    "алгоритмов",
    "алгоритмы",
    "общеразвивающая",
    "квалификации",
    "удостоверением",
    "сертификатом",
    "стажировка",
    "стажировку",
)


def _edit_distance(left: str, right: str) -> int:
    if abs(len(left) - len(right)) > 2:
        return 3
    previous = list(range(len(right) + 1))
    for index, char in enumerate(left, start=1):
        current = [index]
        for other_index, other in enumerate(right, start=1):
            current.append(
                min(
                    previous[other_index] + 1,
                    current[other_index - 1] + 1,
                    previous[other_index - 1] + (char != other),
                )
            )
        previous = current
    return previous[-1]


def repair_typos(text: str) -> str:
    """Близкие к знакомым словам опечатки. Дальше по тексту их можно узнать."""

    def fix(match: re.Match[str]) -> str:
        word = match.group(0)
        core = word.lower()
        if len(core) < 6 or core in KNOWN_WORDS:
            return word
        limit = 1 if len(core) < 8 else 2
        best = ""
        best_distance = limit + 1
        tied = False
        for known in KNOWN_WORDS:
            distance = _edit_distance(core, known)
            if distance == 0:
                return word
            if distance < best_distance:
                best = known
                best_distance = distance
                tied = False
            elif distance == best_distance:
                tied = True
        if (
            not best
            or tied
            or best_distance > limit
            or (best_distance > 1 and core[:3] != best[:3])
        ):
            return word
        if word[:1].isupper():
            return best[:1].upper() + best[1:]
        return best

    return re.sub(r"[0-9A-Za-zА-Яа-яЁё-]+", fix, text)
FILE_PTR = r"файл|образц|приложен|референс"
FIELD_WORDS = {
    "hours": r"час|объ[её]м",
    "audience": r"аудитор|слушател",
    "topic": r"тем[аеуы]|назван|предмет",
    "structure": r"структур|раздел|модул",
    "attestation": r"аттестац",
}
EXCEPT_WORDS = {
    "hours": r"час|объ[её]м",
    "audience": r"аудитор|слушател",
    "topic": r"тем|назван",
    "structure": r"структур|раздел|модул",
    "attestation": r"аттестац",
}


def sample_intents(texts: list[str]) -> set[str]:
    """Какие поля методист явно берёт из файла. Молчаливое приложение файла сюда не входит."""
    blob = " ".join(texts)
    intents: set[str] = set()
    if re.search(
        rf"(?:вс[её]|целиком|полностью).{{0,16}}(?:как в|из).{{0,12}}(?:{FILE_PTR})",
        blob,
        re.IGNORECASE,
    ):
        intents.update(FIELD_WORDS)
    for match in re.finditer(
        rf"кроме\s+({EXCEPT_WORDS['topic']}|{EXCEPT_WORDS['audience']}|"
        rf"{EXCEPT_WORDS['hours']}|{EXCEPT_WORDS['structure']}|{EXCEPT_WORDS['attestation']})\w*",
        blob,
        re.IGNORECASE,
    ):
        token = match.group(1).lower()
        for field, stem in EXCEPT_WORDS.items():
            if re.match(stem, token, re.IGNORECASE):
                intents.discard(field)
    for field, words in FIELD_WORDS.items():
        others = "|".join(stem for name, stem in FIELD_WORDS.items() if name != field)
        for match in re.finditer(
            rf"(?:{words})\w{{0,12}}(.{{0,40}})(?:как в|из)\s+(?:{FILE_PTR})",
            blob,
            re.IGNORECASE,
        ):
            gap = match.group(1)
            if not re.search(rf"(?:{others})\w*", gap, re.IGNORECASE):
                intents.add(field)
        if re.search(
            rf"(?:как в|из)\s+(?:{FILE_PTR})\w{{0,12}}.{{0,16}}только\s+(?:{words})",
            blob,
            re.IGNORECASE,
        ) or re.search(
            rf"(?:как в|из)\s+(?:{FILE_PTR}).{{0,20}}(?:{words})",
            blob,
            re.IGNORECASE,
        ):
            intents.add(field)
    if re.search(r"структур\w*.{0,24}(?:возьм|можно взять|как в)", blob, re.IGNORECASE):
        intents.add("structure")
    if re.search(r"тем[аеу]\s+друг", blob, re.IGNORECASE):
        intents.discard("topic")
    if re.search(r"аудитор\w*\s+друг", blob, re.IGNORECASE):
        intents.discard("audience")
    return intents


def wants_hours_from_sample(texts: list[str]) -> bool:
    return "hours" in sample_intents(texts)


def _hour_hit(text: str, match: re.Match[str]) -> int | None:
    start, end = match.span()
    window = text[max(0, start - 28) : min(len(text), end + 28)]
    if SAMPLE_NEAR.search(window):
        return None
    value = int(match.group(1))
    if value <= 0:
        return None
    return value


def mentioned_hours(text: str) -> list[int]:
    hours: list[int] = []
    for pattern in (HOURS, HOURS_NAMED):
        for match in pattern.finditer(text):
            value = _hour_hit(text, match)
            if value is not None:
                hours.append(value)
    return hours


def mentioned_kind(texts: list[str]) -> str | None:
    for text in reversed(texts):
        if KIND_MARKERS["qualification"].search(text):
            return "qualification"
        if KIND_MARKERS["general"].search(text):
            return "general"
    return None


ATTESTATION_HOURS = re.compile(
    r"аттестац\w*.{0,48}?(\d{1,2})\s*(?:академическ\w*\s+)?(?:час|ч\b)",
    re.IGNORECASE,
)
ATTESTATION_HOURS_FLIP = re.compile(
    r"(\d{1,2})\s*(?:академическ\w*\s+)?(?:час|ч\b).{0,24}аттестац",
    re.IGNORECASE,
)


def default_attestation_hours(
    form: str,
    named_hours: float | None,
    duration: float,
) -> float | None:
    """Часы итоговой аттестации по умолчанию внутри общего объёма курса."""
    if not (form or "").strip():
        return None

    if named_hours is not None:
        return None

    if duration <= 0:
        return None

    return 1.0 if duration < 24 else 2.0


def attestation_hours_from_text(texts: list[str]) -> float | None:
    for text in reversed(texts):
        for pattern in (ATTESTATION_HOURS, ATTESTATION_HOURS_FLIP):
            match = pattern.search(text)
            if not match:
                continue

            hours = int(match.group(1))
            if 0 <= hours <= 8:
                return float(hours)

    return None


def volume_from_text(texts: list[str]) -> int | None:
    for text in reversed(texts):
        match = VOLUME.search(text)
        if not match:
            continue
        start, end = match.span()
        window = text[max(0, start - 28) : min(len(text), end + 28)]
        if SAMPLE_NEAR.search(window):
            continue
        before = text[max(0, start - 24) : start]
        if re.search(r"аттестац", before, re.IGNORECASE):
            continue
        return int(match.group(1))
    ranked: list[tuple[int, int]] = []
    for text in reversed(texts):
        for match in HOURS.finditer(text):
            value = _hour_hit(text, match)
            if value is None or value < 8:
                continue
            before = text[max(0, match.start() - 24) : match.start()]
            if re.search(r"аттестац", before, re.IGNORECASE):
                continue
            around = text[max(0, match.start() - 40) : match.end() + 16]
            score = 2 if re.search(r"программ|курс|объ[её]м", around, re.IGNORECASE) else 0
            ranked.append((score, value))
    if not ranked:
        return None
    ranked.sort()
    return ranked[-1][1]


def normalize_program_kind(value: Any) -> str | None:
    if value in {"general", "qualification"}:
        return value
    text = str(value or "").strip()
    if not text or text == "unset":
        return None
    if KIND_MARKERS["qualification"].search(text):
        return "qualification"
    if KIND_MARKERS["general"].search(text):
        return "general"
    return None


def drop_empty_fields(patch: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in patch.items():
        if value is None:
            continue
        if key == "attestationForm" and value == "":
            result[key] = value
            continue
        if (
            key == "attestationHours"
            and isinstance(value, (int, float))
            and not isinstance(value, bool)
            and value == 0
        ):
            result[key] = value
            continue
        if isinstance(value, str) and (not value.strip() or value == "unset"):
            continue
        if isinstance(value, (int, float)) and value <= 0:
            continue
        if isinstance(value, list) and not value:
            continue
        result[key] = value
    return result



GARBAGE_TITLE = re.compile(
    r"^(?:asdf|qwerty|lorem|test|xxx|zzz|foo|bar)\b",
    re.IGNORECASE,
)
OFFTOPIC = re.compile(
    r"(?:"
    r"рецепт\w*|борщ\w*|калорий\w*|ингредиент\w*|"
    r"напиши\s+(?:подробн\w*\s+)?(?:рецепт|функци\w*|код)|"
    r"функци\w*\s+на\s+python|"
    r"def\s+\w+\s*\("
    r")",
    re.IGNORECASE,
)
COURSE_FRAME = re.compile(
    r"(?:программ\w*|курс\w*|основы|введение|интенсив\w*|практикум\w*|стажировк\w*|повышен\w*\s+квалификац\w*|"
    r"общеразвивающ\w*|обучен\w*|слушател\w*|академ\w*\s*час)",
    re.IGNORECASE,
)
URGENT_DEADLINE = re.compile(
    r"(?:"
    r"срочн\w*|"
    r"за\s+(?:1|один)\s+день|"
    r"за\s+день\b|"
    r"к\s+завтра|"
    r"сегодня\s+нужн"
    r")",
    re.IGNORECASE,
)
VOLUME_CLARIFIED = re.compile(
    r"(?:"
    r"объ[её]м\s+обучен|"
    r"срок\s+сборк|"
    r"оставить\s+\d+|"
    r"сократить\s+(?:до|объ)|"
    r"реально\s+за|"
    r"собрать\s+программу\s+быстр|"
    r"часы\s+для\s+слушател"
    r")",
    re.IGNORECASE,
)
VOLUME_CLARIFY_NOTE = (
    "Уточнить: указанные часы — объём обучения слушателей или "
    "срок сборки программы?"
)
GENERIC_GOAL = re.compile(r"^освоить\s+программу\b", re.IGNORECASE)


def letter_ratio(text: str) -> float:
    chars = [ch for ch in text if not ch.isspace()]
    if not chars:
        return 0.0
    letters = sum(1 for ch in chars if ch.isalpha())
    return letters / len(chars)


TITLE_MARKER = re.compile(
    r"(?:"
    r"программ\w*|курс\w*|основы|введение|интенсив\w*|практикум\w*|стажировк\w*|повышен\w*\s+квалификац\w*|"
    r"общеразвивающ\w*|обучен\w*|слушател\w*|академ\w*\s*час|"
    r"(?:курс|программ\w*)\s+по\s+|"
    r"(?:назван\w*|тема)\s*[:—-]|"
    r"«[^»]{3,160}»"
    r")",
    re.IGNORECASE,
)
WEAK_TITLE_LEAD = re.compile(
    r"^(?:делаем|сделаем|давайте|давай|хочу|нужно|прошу)\b",
    re.IGNORECASE,
)


def is_garbage_title(text: str) -> bool:
    cleaned = (text or "").strip()
    if len(cleaned) < 3:
        return True
    if GARBAGE_TITLE.search(cleaned):
        return True
    if letter_ratio(cleaned) < 0.45:
        return True
    if contains_profanity(cleaned):
        return True
    if len(re.findall(r"[!?.]{2,}", cleaned)) >= 2 and letter_ratio(cleaned) < 0.7:
        return True
    # Single vague token / slang without course frame — not a program title.
    # Two tokens like «Основы Python» are valid short titles.
    words = re.findall(r"[A-Za-zА-Яа-яЁё0-9+#.]+", cleaned)
    if len(words) <= 1 and not TITLE_MARKER.search(cleaned):
        return True
    if (
        len(words) == 2
        and not TITLE_MARKER.search(cleaned)
        and letter_ratio(cleaned) < 0.55
    ):
        return True
    if WEAK_TITLE_LEAD.search(cleaned) and not TITLE_MARKER.search(cleaned):
        return True
    return False


def has_title_markers(text: str) -> bool:
    return bool(TITLE_MARKER.search(text or ""))


def is_offtopic_request(text: str) -> bool:
    blob = (text or "").strip()
    if not blob:
        return False
    if COURSE_FRAME.search(blob):
        return False
    return bool(OFFTOPIC.search(blob))


def deadline_volume_conflict(texts: list[str], hours: float | int | None) -> bool:
    try:
        value = float(hours or 0)
    except (TypeError, ValueError):
        value = 0.0
    if value < 80:
        return False
    blob = " ".join(texts or [])
    if not URGENT_DEADLINE.search(blob):
        return False
    if VOLUME_CLARIFIED.search(blob):
        return False
    return True



# Soft RU+EN swear filter: block title/goals and refuse to assemble a course.
PROFANITY_REPLY = (
    "Переформулируйте запрос без грубостей — из мата программу не собираю."
)
_PROFANITY = re.compile(
    r"(?:"
    r"(?<![A-Za-zА-Яа-яЁё])(?:"
    r"бля(?:д|т|ть|ди|дск)?\w*"
    r"|сука\w*|сучк\w*"
    r"|ж+о+п+\w*"
    r"|хуй\w*|хуя\w*|хуе\w*|хуё\w*|нахуй\w*|нахер\w*|похуй\w*"
    r"|пизд\w*"
    r"|еба\w*|ёба\w*|ебл\w*|ёбл\w*|ебу\w*|ёбу\w*|ебан\w*|ёбан\w*"
    r"|муда\w*|мудил\w*"
    r"|гавно\w*|говно\w*"
    r"|залуп\w*"
    r"|пидор\w*|пидар\w*"
    r"|долбо[её]б\w*"
    r"|у[её]б\w*"
    r")"
    r"|"
    r"(?<![A-Za-z])(?:"
    r"fuck\w*|fucking|motherfuck\w*"
    r"|shit\w*|bullshit"
    r"|asshole\w*|dickhead\w*"
    r"|bitch\w*"
    r"|cunt\w*"
    r"|bastard\w*"
    r"|wtf\b"
    r")"
    r")",
    re.IGNORECASE,
)


def _collapse_repeats(text: str) -> str:
    # ЖОООПААА → ЖОПА so elongated slang still matches stems.
    return re.sub(r"(.)\1{2,}", r"\1\1", text or "")


def contains_profanity(text: str) -> bool:
    raw = text or ""
    return bool(_PROFANITY.search(raw) or _PROFANITY.search(_collapse_repeats(raw)))


VOLUME_ONLY_REPLY = re.compile(
    r"^\s*(?:объ[её]м\s*[:—-]?\s*)?\d+(?:[.,]\d+)?\s*"
    r"(?:академическ\S*\s+|ак\.?\s*)?(?:час(?:а|ов)?|ч)\b",
    re.IGNORECASE,
)


def is_unusable_title(text: str) -> bool:
    cleaned = (text or "").strip()
    if len(cleaned) < 2:
        return True
    if GARBAGE_TITLE.search(cleaned):
        return True
    if letter_ratio(cleaned) < 0.45:
        return True
    if contains_profanity(cleaned):
        return True
    if VOLUME_ONLY_REPLY.search(cleaned) or BARE_DURATION.search(cleaned):
        return True
    if VOLUME_FIELD_TITLE.search(cleaned):
        return True
    return False


BARE_DURATION = re.compile(
    r"^(?:месяц(?:а|ев)?|недел[яюи]|день|дня|дней|год(?:а|ов)?|час(?:а|ов)?)\.?$",
    re.IGNORECASE,
)

FIELD_LABEL_TITLE = re.compile(
    r"^(?:тип\s+программы|объ[её]м(?:\s+часов)?|слушатели|аудитория|"
    r"форма\s+обучени\w*|итоговая\s+аттестация)\.?$",
    re.IGNORECASE,
)


def clarifying_title_from_reply(text: str) -> str:
    cleaned = (text or "").strip()
    if not cleaned or SERVICE_PROMPT.search(cleaned):
        return ""
    if contains_profanity(cleaned):
        return ""
    if VOLUME_ONLY_REPLY.search(cleaned):
        return ""
    if BARE_DURATION.search(cleaned):
        return ""
    if is_offtopic_request(cleaned):
        return ""
    cleaned = re.sub(
        r"^(?:назван\w*|тема|программ\w*)\s*[:—-]\s*",
        "",
        cleaned,
        flags=re.IGNORECASE,
    ).strip()
    if len(cleaned) < 2 or is_unusable_title(cleaned):
        return ""
    title = re.split(r"[\n;]", cleaned)[0].strip()[:160]
    if title:
        title = title[0].upper() + title[1:]
    return title if title and not is_unusable_title(title) else ""


VOLUME_FIELD_TITLE = re.compile(
    r"^(?:объ[её]м|длительность|продолжительность|часов?|hours?|duration)\.?$",
    re.IGNORECASE,
)


def title_from_request(text: str) -> str:
    text = repair_typos(text)
    if VOLUME_ONLY_REPLY.search((text or "").strip()):
        return ""
    quoted = re.search(r"«([^»]{3,160})»", text)
    if quoted:
        # Specialty / profile quotes are not the course title
        # (e.g. специальности «Информационные системы…»).
        prefix = text[max(0, quoted.start() - 48) : quoted.start()].casefold()
        if not re.search(r"специальност|направлени|профил", prefix):
            return quoted.group(1).strip()
    cleaned = LEAD.sub("", text.strip())
    about = re.search(
        r"(?:курс|программ\w*)\s+по\s+([^.,]{3,80})",
        cleaned,
        flags=re.IGNORECASE,
    )
    if about:
        cleaned = about.group(1)
        cleaned = re.split(r"\s+для\s+", cleaned, maxsplit=1)[0]
        cleaned = re.split(r"\s+примерно\s+", cleaned, maxsplit=1)[0]
    study = re.search(
        r"для\s+изучени\w+\s+([^.,]{3,60})",
        cleaned,
        flags=re.IGNORECASE,
    )
    if study:
        topic = re.split(
            r"\s+\d+\s*(?:час|ч\b)|\s+для\s+",
            study.group(1),
            maxsplit=1,
            flags=re.IGNORECASE,
        )[0].strip()
        if topic:
            return f"Изучение {topic}"[:160]
    cleaned = re.sub(
        r"^(?:дополнительн\w*\s+)?(?:общеразвивающ\w*\s+)?программу\s+",
        "",
        cleaned,
        flags=re.IGNORECASE,
    )
    title = re.split(r"\s[—–-]\s|[.,;:\n]", cleaned)[0].strip()
    if title:
        title = title[0].upper() + title[1:]
    title = title[:160]
    if is_offtopic_request(text) or contains_profanity(text) or contains_profanity(title):
        return ""
    if (
        VOLUME_FIELD_TITLE.search(title)
        or BARE_DURATION.search(title)
        or FIELD_LABEL_TITLE.search(title)
    ):
        return ""
    # Short extracted topic ("Python") is OK when the request already framed a course.
    if is_garbage_title(title) and not has_title_markers(text):
        return ""
    # Do not mint a title from raw chat without DPO/course markers.
    if not has_title_markers(text) and not has_title_markers(title):
        return ""
    return title


def _trim_audience(value: str) -> str:
    cut = re.split(
        r"\s+(?=\d+\s*(?:академическ\w*\s+)?(?:час|ч\b)|очно|заоч|стажиров|"
        r"итогов|а+т+естац|общеразвива|повышени|форма\s+обучен)",
        value,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0]
    return cut.strip(" ,;:-")


def attestation_from_text(text: str) -> str | None:
    for pattern, form in ATTESTATION_MARKERS:
        for match in pattern.finditer(text):
            prefix = text[max(0, match.start() - 14) : match.start()]
            if re.search(r"(?:не|без)\s*$", prefix, re.IGNORECASE):
                continue
            return form
    return None


def named_format(texts: list[str]) -> str | None:
    """Форма, которую методист выбрал сам, а не слово «дистанционный» в теме."""
    blob = " ".join(texts).lower()
    if re.search(r"(?:в\s+форме|форма\s+обучени\w*\s*[:—-]?\s*)стажиров", blob):
        return "workshop"
    if "очно-заоч" in blob:
        return "blended"
    if re.search(r"очн(?:о|ая|ой|ые)\b", blob) and "заоч" not in blob:
        return "lecture"
    return None


def format_from_text(texts: list[str]) -> str | None:
    blob = " ".join(texts).lower()
    if re.search(r"(?:в\s+форме|форма\s+обучени\w*\s*[:—-]?\s*)стажиров", blob):
        return "workshop"
    if "стажиров" in blob and (
        "аудиторн" in blob or "самостоятельн" in blob or "наставник" in blob
    ):
        return "workshop"
    if "очно-заоч" in blob or "дистанционн" in blob or "эо и дот" in blob:
        return "blended"
    if re.search(r"очн(?:о|ая|ой|ые)\b", blob) and "заоч" not in blob:
        return "lecture"
    return None


def short_audience(text: str) -> str | None:
    """Короткий ответ на вопрос про слушателей, а не новый запрос программы."""
    cleaned = repair_typos(text).strip()
    if not cleaned or len(cleaned) > 120:
        return None
    if re.search(r"программ|час|аттестац|форма\s+обучен", cleaned, re.IGNORECASE):
        return None
    if re.fullmatch(
        r"(?:студент\w*|слушател\w*|сотрудник\w*|школьник\w*|учител\w*|методист\w*|"
        r"\d+\s*курс\w*|продвинут\w*|базов\w*|начинающ\w*|без опыта)"
        r"(?:[\s,]+(?:студент\w*|слушател\w*|\d+\s*курс\w*|продвинут\w*|базов\w*|"
        r"начинающ\w*|без опыта|колледж\w*|универ\w*))*",
        cleaned,
        re.IGNORECASE,
    ):
        return cleaned
    return None


def audience_from_text(texts: list[str]) -> str | None:
    for raw in reversed(texts):
        text = repair_typos(raw)
        follow = short_audience(text)
        if follow:
            return follow
        labeled = re.search(
            r"(?:слушател\w*|аудитори\w*)\s*[:—]\s*([^.]{6,180})",
            text,
            re.IGNORECASE,
        )
        if labeled:
            return labeled.group(1).strip()
        match = AUDIENCE.search(text)
        work = re.search(r"работают в\s+([^.,]{3,60})", text, re.IGNORECASE)
        if match and work:
            return f"{match.group(1).strip()}, {work.group(0).strip()}"
        if match:
            return _trim_audience(match.group(1))
        if work:
            return work.group(0).strip()
        intern = re.search(r"стажировку\s+в\s+([^.,]{6,80})", text, re.IGNORECASE)
        if intern:
            return f"слушатели стажировки в {intern.group(1).strip()}"
        bare = AUDIENCE_BARE.search(text)
        if bare:
            return _trim_audience(bare.group(1))
    return None


def guard_brief(
    patch: dict[str, Any],
    current: dict[str, Any],
    user_texts: list[str],
    form_brief: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], list[str]]:
    brief = drop_empty_fields(patch)
    dropped: list[str] = []
    texts = [text for text in user_texts if not SERVICE_PROMPT.search(text.strip())]
    form = form_brief or {}
    last = user_texts[-1] if user_texts else ""
    if "programKind" in brief:
        kind = normalize_program_kind(brief.get("programKind"))
        if kind:
            brief["programKind"] = kind
        else:
            brief.pop("programKind", None)

    if "durationHours" not in brief and current.get("durationHours", 0) <= 0:
        volume = volume_from_text(texts)
        if volume:
            brief["durationHours"] = volume
    if "programKind" not in brief and current.get("programKind") == "unset":
        kind = mentioned_kind(texts)
        if kind:
            brief["programKind"] = kind

    if (
        "durationHours" in brief
        and brief["durationHours"] != current.get("durationHours")
    ):
        try:
            asked_hours = int(float(brief["durationHours"]))
        except (TypeError, ValueError):
            asked_hours = None
        earlier = {hour for text in texts for hour in mentioned_hours(text)}
        allowed = (
            form.get("durationHours") == brief["durationHours"]
            or asked_hours in mentioned_hours(last)
            or (current.get("durationHours", 0) <= 0 and asked_hours in earlier)
        )
        if not allowed:
            brief.pop("durationHours")
            dropped.append("durationHours")

    if brief.get("programKind") not in (None, "unset", current.get("programKind")):
        if (
            form.get("programKind") != brief["programKind"]
            and mentioned_kind(user_texts) != brief["programKind"]
        ):
            brief.pop("programKind")
            dropped.append("programKind")

    chosen_format = named_format(texts)
    form_format = form.get("format")
    if chosen_format:
        brief["format"] = chosen_format
        brief["formatNamed"] = True
    elif form_format in {"lecture", "blended", "workshop"}:
        brief["format"] = form_format
        brief["formatNamed"] = True
    elif "format" not in brief:
        inferred_format = format_from_text(texts)
        if inferred_format:
            brief["format"] = inferred_format
    follow_audience = short_audience(last)
    extracted_audience = audience_from_text(texts)
    last_names_audience = bool(
        re.search(r"(?:слушател\w*|аудитори\w*)\s*[:—]", last, re.IGNORECASE)
    )
    if follow_audience:
        brief["audience"] = follow_audience
    elif extracted_audience and not brief.get("audience"):
        if not current.get("audience", "").strip() or last_names_audience:
            brief["audience"] = extracted_audience

    last_text = texts[-1] if texts else ""
    current_status = current.get("attestationStatus", "unset")

    if (
        current_status == "unset"
        and current.get("attestationForm", "").strip()
    ):
        # Старый бриф с заполненной формой уже содержит аттестацию.
        current_status = "specified"

    if ATTESTATION_CANCEL.search(last_text):
        # Методист явно отменил аттестацию.
        brief["attestationForm"] = ""
        brief["attestationHours"] = 0
        brief["attestationStatus"] = "none"

    else:
        # Сначала ищем форму в последнем сообщении.
        detected_form = None

        for pattern, att_form in ATTESTATION_MARKERS:
            if pattern.search(last_text):
                detected_form = att_form
                break

        # Если форма ещё не определена, восстанавливаем её из истории.
        # После явной отмены старую форму восстанавливать нельзя.
        if not detected_form and current_status == "unset":
            for previous_text in reversed(texts[:-1]):
                if ATTESTATION_CANCEL.search(previous_text):
                    break

                for pattern, att_form in ATTESTATION_MARKERS:
                    if pattern.search(previous_text):
                        detected_form = att_form
                        break

                if detected_form:
                    break

        explicit_hours = attestation_hours_from_text([last_text])

        patch_form = brief.get("attestationForm")

        if isinstance(patch_form, str) and patch_form.strip():
            candidate = patch_form.strip()
            normalized_candidate = " ".join(candidate.casefold().split())
            normalized_text = " ".join(last_text.casefold().split())

            if re.search(
                rf"(?<!\w){re.escape(normalized_candidate)}(?!\w)",
                normalized_text,
            ):
                # Форма из patch прямо названа в последнем сообщении.
                detected_form = candidate

        if detected_form:
            # Сохраняем подробную форму из patch.
            # Маркер используем, если модель не извлекла форму.
            patch_form = brief.get("attestationForm")
            if not isinstance(patch_form, str) or not patch_form.strip():
                brief["attestationForm"] = detected_form

            brief["attestationStatus"] = "specified"

            if explicit_hours is not None:
                brief["attestationHours"] = explicit_hours

            elif current.get("attestationHours", 0) > 0:
                brief["attestationHours"] = current["attestationHours"]

            else:
                duration = float(
                    brief.get("durationHours")
                    or current.get("durationHours")
                    or 0
                )

                form_name = str(
                    brief.get("attestationForm")
                    or detected_form
                )

                fallback = default_attestation_hours(
                    form=form_name,
                    named_hours=None,
                    duration=duration,
                )

                if fallback is not None:
                    brief["attestationHours"] = fallback

        elif explicit_hours is not None:
            # Методист явно указал часы аттестации.
            # Сохраняем их, даже если форма пока неизвестна.
            brief["attestationHours"] = explicit_hours

            if current_status == "specified":
                # Форма уже определена — сохраняем её.
                brief["attestationForm"] = current["attestationForm"]
                brief["attestationStatus"] = "specified"
            else:
                # Часы известны, но форму ещё нужно уточнить.
                brief.pop("attestationForm", None)
                brief["attestationStatus"] = "unset"

        else:
            # Нет нового указания — сохраняем текущее состояние.
            brief.pop("attestationForm", None)
            brief.pop("attestationHours", None)
            brief.pop("attestationStatus", None)

    first = next(
        (
            text
            for text in user_texts
            if text.strip() and not SERVICE_PROMPT.search(text.strip())
        ),
        "",
    )
    # Protect established title after intake: do not clear it just because an early
    # history message looked offtopic. Decide destructive pops from the LAST turn.
    established = str(current.get("title") or "").strip()
    last_turn = last or (texts[-1] if texts else "")
    if is_offtopic_request(last_turn) and not established:
        brief.pop("title", None)
        brief.pop("goals", None)
    elif not established and not brief.get("title", "").strip():
        # 1) Strict extract from last then first (needs course markers).
        # 2) Soft clarifying accept ONLY for the last turn (answer to «название?»).
        title = ""
        for source in (last_turn, first):
            if source and str(source).strip():
                title = title_from_request(source)
                if title:
                    break
        if not title and last_turn and str(last_turn).strip():
            title = clarifying_title_from_reply(last_turn)
        if title:
            brief["title"] = title
    candidate = str(brief.get("title") or "").strip()
    # Never accept profanity / unusable junk. Soft single-word answer is OK once user replied.
    if candidate and contains_profanity(candidate):
        brief.pop("title", None)
        dropped.append("title")
        candidate = ""
    if candidate and (
        is_offtopic_request(candidate)
        or (
            is_unusable_title(candidate)
            and not has_title_markers(candidate)
            and not any(has_title_markers(item) for item in texts)
        )
    ):
        # Protect established title
        if established and candidate != established:
            brief.pop("title", None)  # reject bad patch; current stays via merge
            dropped.append("title")
        elif not established:
            brief.pop("title", None)
            dropped.append("title")

    # drop profane goals
    goals = list(brief.get("goals") or [])
    clean_goals = [g for g in goals if not contains_profanity(str(g))]
    if len(clean_goals) != len(goals):
        brief["goals"] = clean_goals
        dropped.append("goals")

    if not brief.get("goals") and not current.get("goals"):
        title = str(brief.get("title") or current.get("title") or "").strip()
        if title and not GENERIC_GOAL.search(title) and not is_unusable_title(title):
            brief["goals"] = [f"Подготовить слушателей по теме «{title}»"]

    hours = brief.get("durationHours", current.get("durationHours", 0))
    constraints = list(brief.get("constraints") or current.get("constraints") or [])
    if deadline_volume_conflict(user_texts, hours):
        if VOLUME_CLARIFY_NOTE not in constraints:
            constraints.append(VOLUME_CLARIFY_NOTE)
        brief["constraints"] = constraints[:12]
    else:
        cleaned = [item for item in constraints if item != VOLUME_CLARIFY_NOTE]
        if cleaned != constraints:
            brief["constraints"] = cleaned[:12]
    return brief, dropped


THINKING_LEAK = re.compile(
    r"(?is)"
    r"(?:<think>.*?</think>)|"
    r"(?:^|\n)\s*(?:модель\s+думает|thinking|reasoning)\s*[.…:]*\s*(?=\n|$)|"
    r"^\s*(?:думаю|thinking\s*\.?\.?\.?)\s*$"
)


def strip_assistant_text(text: str) -> str:
    cleaned = THINKING_LEAK.sub("", text or "")
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    return cleaned
