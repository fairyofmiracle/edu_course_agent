import asyncio
import os

from fastapi.testclient import TestClient

import backend.app.speech as speech_module
from backend.app.main import app
from backend.app.speech import SpeechError, audio_kind, transcribe


def test_audio_kind_ignores_codec_parameter() -> None:
    assert audio_kind("audio/webm;codecs=opus") == "webm"
    assert audio_kind("audio/wav") == "wav"
    assert audio_kind("application/pdf") is None


def test_transcribe_calls_gigaam_and_deletes_the_file(monkeypatch) -> None:
    seen: dict[str, object] = {}

    class Model:
        def transcribe(self, path: str):
            seen["exists"] = os.path.exists(path)
            seen["path"] = path
            with open(path, "rb") as handle:
                seen["bytes"] = handle.read()
            return type("Result", (), {"text": "  курс на 72 часа  "})()

    monkeypatch.setattr(speech_module, "load_gigaam", lambda: Model())
    text = asyncio.run(transcribe(b"abc", "audio/webm;codecs=opus"))
    assert text == "курс на 72 часа"
    assert seen["exists"] is True
    assert seen["bytes"] == b"abc"
    assert not os.path.exists(str(seen["path"]))


def test_long_recording_stays_a_short_russian_error(monkeypatch) -> None:
    class Model:
        def transcribe(self, _path: str):
            raise ValueError("Too long wav file, use 'transcribe_longform' method.")

    monkeypatch.setattr(speech_module, "load_gigaam", lambda: Model())
    try:
        asyncio.run(transcribe(b"abc", "audio/webm"))
    except SpeechError as error:
        assert error.status == 400
        assert "25" in str(error)
        assert "Too long" not in str(error)
    else:
        raise AssertionError("длинная запись должна остановиться")


def test_missing_ffmpeg_does_not_leak_the_library_text(monkeypatch) -> None:
    class Model:
        def transcribe(self, _path: str):
            raise RuntimeError("Failed to load audio")

    monkeypatch.setattr(speech_module, "load_gigaam", lambda: Model())
    try:
        asyncio.run(transcribe(b"abc", "audio/wav"))
    except SpeechError as error:
        assert error.status == 503
        assert "ffmpeg" in str(error)
        assert "Failed" not in str(error)
    else:
        raise AssertionError("без ffmpeg запись не разбирается")


def test_gigaam_package_is_optional(monkeypatch) -> None:
    monkeypatch.setattr(speech_module, "_model", None)
    real_import = __import__

    def fake_import(name, globals=None, locals=None, fromlist=(), level=0):
        if name == "gigaam":
            raise ImportError("no module")
        return real_import(name, globals, locals, fromlist, level)

    monkeypatch.setattr("builtins.__import__", fake_import)
    try:
        speech_module.load_gigaam()
    except SpeechError as error:
        assert error.status == 503
        assert "не установлена" in str(error)
    else:
        raise AssertionError("без пакета голос не должен молча падать")


def test_transcribe_route_returns_text(monkeypatch) -> None:
    async def fake(data, content_type):
        assert data == b"sound"
        assert content_type.startswith("audio/webm")
        return "курс на 16 часов"

    monkeypatch.setattr("backend.app.agent_api.transcribe", fake)
    with TestClient(app) as client:
        response = client.post(
            "/api/transcribe",
            files={"file": ("speech.webm", b"sound", "audio/webm")},
        )
    assert response.status_code == 200
    assert response.json() == {"text": "курс на 16 часов"}


def test_transcribe_route_rejects_a_document() -> None:
    with TestClient(app) as client:
        response = client.post(
            "/api/transcribe",
            files={"file": ("notes.pdf", b"%PDF", "application/pdf")},
        )
    assert response.status_code == 400
    assert "webm" in response.json()["detail"]


def test_transcribe_route_reports_a_missing_model(monkeypatch) -> None:
    async def fake(_data, _content_type):
        raise SpeechError(
            "Голосовая модель GigaAM не установлена. Чат при этом работает.",
            status=503,
        )

    monkeypatch.setattr("backend.app.agent_api.transcribe", fake)
    with TestClient(app) as client:
        response = client.post(
            "/api/transcribe",
            files={"file": ("speech.webm", b"sound", "audio/webm")},
        )
    assert response.status_code == 503
    assert "GigaAM" in response.json()["detail"]
    assert "шлюз" not in response.json()["detail"].lower()
