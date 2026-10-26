"""Сменный голосовой адаптер. Кнопка принимает текст, движок можно заменить.

Сейчас короткую запись разбирает локальная GigaAM, не шлюз чата.

Модель: https://github.com/salute-developers/GigaAM
Короткая расшифровка принимает не больше 25 секунд. Файл записи удаляется сразу.
"""

from __future__ import annotations

import asyncio
import os
import tempfile
import threading

GIGAAM_MODEL = "v3_e2e_rnnt"
MAX_AUDIO_BYTES = 8 * 1024 * 1024
MAX_SECONDS = 25

_KINDS = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
    "audio/wave": "wav",
    "audio/x-wav": "wav",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
}

_model = None
_model_lock = threading.Lock()


class SpeechError(RuntimeError):
    def __init__(self, message: str, status: int = 502) -> None:
        super().__init__(message)
        self.status = status


def audio_kind(content_type: str) -> str | None:
    base = (content_type or "").split(";", 1)[0].strip().lower()
    return _KINDS.get(base)


def load_gigaam():
    """Одна модель на процесс. Первый вызов скачивает веса, если их ещё нет."""
    global _model
    with _model_lock:
        if _model is not None:
            return _model
        try:
            import gigaam
        except ImportError as error:
            raise SpeechError(
                "Голосовая модель GigaAM не установлена. Чат при этом работает.",
                status=503,
            ) from error
        try:
            _model = gigaam.load_model(GIGAAM_MODEL, device="cpu", fp16_encoder=False)
        except Exception as error:
            raise SpeechError(
                "GigaAM не загрузилась. Для первого запуска нужны сеть и ffmpeg."
            ) from error
        return _model


def _text_of(result: object) -> str:
    if isinstance(result, str):
        return result.strip()
    text = getattr(result, "text", "")
    return str(text or "").strip()


def transcribe_file(path: str) -> str:
    model = load_gigaam()
    try:
        result = model.transcribe(path)
    except ValueError as error:
        if "Too long" in str(error):
            raise SpeechError(
                "Запись длиннее 25 секунд. Скажите короче.",
                status=400,
            ) from error
        raise SpeechError("GigaAM не разобрала запись.") from error
    except RuntimeError as error:
        if "Failed to load audio" in str(error):
            raise SpeechError(
                "Нужен ffmpeg в PATH. Без него GigaAM не слышит запись.",
                status=503,
            ) from error
        raise SpeechError("GigaAM не разобрала запись.") from error
    return _text_of(result)


async def transcribe(data: bytes, content_type: str) -> str:
    kind = audio_kind(content_type)
    if kind is None:
        raise SpeechError("Нужна запись webm, ogg, wav или mp3.", status=400)
    if not data:
        raise SpeechError("Запись пустая.", status=400)
    if len(data) > MAX_AUDIO_BYTES:
        raise SpeechError("Запись больше 8 МБ.", status=400)
    handle = tempfile.NamedTemporaryFile(suffix=f".{kind}", delete=False)
    path = handle.name
    handle.write(data)
    handle.close()
    try:
        return await asyncio.to_thread(transcribe_file, path)
    finally:
        if os.path.exists(path):
            os.remove(path)
