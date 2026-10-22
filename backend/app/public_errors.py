from __future__ import annotations

import re

GENERIC = (
    "Шаг не завершился. Каркас на месте — повторите запрос или выгрузите программу кнопкой в студии."
)


def public_error_text(error: Exception) -> str:
    message = str(error).strip()
    raw = f"{type(error).__name__}: {message}" if message else type(error).__name__
    if re.search(r"timeout|abort|timed out", raw, re.I):
        return "Шлюз не ответил за отведённое время. Каркас на месте, шаг можно повторить."
    if re.search(r"fetch failed|ECONNREFUSED|ENOTFOUND|сеть|network|ECONNRESET", raw, re.I):
        return "Студия не достучалась до модели. Повторите шаг."
    if re.search(r"\{|\[|choices|Bearer |api_key|без списка вариантов", message, re.I):
        return "Шлюз ответил не тем форматом. Каркас на месте, шаг можно повторить."
    if re.search(
        r"Traceback|HTTP \d|ValidationError|document is not defined|[A-Za-z]+Error:",
        raw,
        re.I,
    ):
        return GENERIC
    return message or GENERIC
