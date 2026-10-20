import httpx
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.source_probe import probe_url, public_http_url


class Response:
    def __init__(self, status_code: int) -> None:
        self.status_code = status_code

    def __enter__(self) -> "Response":
        return self

    def __exit__(self, *_args: object) -> bool:
        return False


class Opener:
    def __init__(self, status_code: int = 200, error: Exception | None = None) -> None:
        self.status_code = status_code
        self.error = error

    def stream(self, _method: str, _url: str) -> Response:
        if self.error:
            raise self.error
        return Response(self.status_code)


def test_private_and_empty_links_are_not_opened() -> None:
    assert public_http_url("https://example.com/order")
    assert not public_http_url("http://127.0.0.1/secret")
    assert not public_http_url("file:///tmp/order.pdf")
    missed = probe_url("http://10.0.0.8/order")
    assert missed["state"] == "not_checked"


class Page(Response):
    def __init__(self, status_code: int, body: bytes, headers: dict[str, str] | None = None) -> None:
        super().__init__(status_code)
        self.body = body
        self.headers = headers or {}

    def iter_bytes(self):
        yield self.body


class PageOpener(Opener):
    def __init__(self, page: Page) -> None:
        super().__init__(page.status_code)
        self.page = page

    def stream(self, _method: str, _url: str) -> Page:
        return self.page


def test_probe_states_do_not_save_page_text() -> None:
    assert probe_url("https://example.com/a", Opener(200))["state"] == "reachable"
    assert probe_url("https://example.com/a", Opener(404))["state"] == "not_found"
    assert probe_url("https://example.com/a", Opener(403))["state"] == "blocked"
    assert probe_url("https://example.com/a", Opener(503))["state"] == "unavailable"
    down = probe_url("https://example.com/a", Opener(error=httpx.ConnectError("dns")))
    assert down["state"] == "unavailable"
    assert "недоступен" in down["message"]
    assert down["fingerprint"] == ""


def test_reachable_page_keeps_stamp_and_drops_text() -> None:
    secret = "СЕКРЕТНЫЙ ТЕКСТ ПРИКАЗА".encode()
    first = probe_url(
        "https://example.com/order",
        PageOpener(Page(200, secret, {"etag": "v1"})),
    )
    second = probe_url(
        "https://example.com/order",
        PageOpener(Page(200, secret, {"etag": "v1"})),
    )
    changed = probe_url(
        "https://example.com/order",
        PageOpener(Page(200, b"other", {"etag": "v2"})),
    )

    assert first["state"] == "reachable"
    assert first["fingerprint"]
    assert first["fingerprint"] == second["fingerprint"]
    assert changed["fingerprint"] != first["fingerprint"]
    assert "СЕКРЕТНЫЙ ТЕКСТ ПРИКАЗА" not in first["message"]
    assert "СЕКРЕТНЫЙ ТЕКСТ ПРИКАЗА" not in first["fingerprint"]


def test_reachable_page_without_document_number_stays_unconfirmed() -> None:
    page = Page(200, "Страница без нужного реквизита".encode(), {"etag": "v1"})
    missed = probe_url("https://example.com/order", PageOpener(page), expect="629")
    assert missed["state"] == "reachable"
    assert missed["requisites"] == "missing"
    assert "не подтверждён" in missed["message"]
    assert "Страница без нужного реквизита" not in missed["message"]

    found = probe_url(
        "https://example.com/order",
        PageOpener(Page(200, "Приказ № 629 опубликован".encode(), {"etag": "v1"})),
        expect="629",
    )
    assert found["requisites"] == "found"
    assert "629" not in found["fingerprint"]


def test_cors_allowlist_has_no_open_regex() -> None:
    from backend.app.main import app

    cors = [
        layer
        for layer in app.user_middleware
        if getattr(layer.cls, "__name__", "") == "CORSMiddleware"
    ]
    assert cors
    assert not cors[0].kwargs.get("allow_origin_regex")
    assert "http://localhost:3000" in cors[0].kwargs["allow_origins"]


def test_regulatory_check_keeps_order_unconfirmed_when_site_is_down(monkeypatch) -> None:
    monkeypatch.setattr(
        "backend.app.main.probe_url",
        lambda url, expect="": {
            "url": url,
            "state": "unavailable",
            "message": "Сайт не ответил за 4 секунды.",
            "requisites": "unchecked",
            "expect": expect,
        },
    )
    with TestClient(app) as client:
        response = client.post(
            "/api/regulatory/check",
            json={
                "claims": [
                    {
                        "title": "Приказ Минпросвещения",
                        "authority": "Минпросвещения России",
                        "number": "123",
                        "date": "2024-01-01",
                        "source": "https://example.com/order",
                    }
                ]
            },
        )

    assert response.status_code == 200
    body = response.json()["results"][0]
    assert body["status"] == "unconfirmed"
    assert body["site"] == "unavailable"


def test_audit_warns_about_retired_tool_without_failing_hours() -> None:
    from backend.app.audit import audit_course

    report = audit_course(
        {
            "brief": {
                "title": "Сети",
                "audience": "Студенты",
                "programKind": "general",
                "durationHours": 16,
                "attestationHours": 0,
                "references": [{"title": "Файл методиста"}],
            },
            "modules": [
                {
                    "id": "m1",
                    "title": "Веб",
                    "hours": 16,
                    "lectureHours": 4,
                    "practiceHours": 12,
                    "labHours": 0,
                    "selfStudyHours": 0,
                    "topics": ["Вёрстка под Internet Explorer"],
                    "learningOutcomes": ["Собирает страницу"],
                }
            ],
            "lectures": [{"moduleId": "m1"}],
            "seminars": [{"moduleId": "m1", "tasks": [{"learningOutcome": "Собирает страницу"}]}],
            "assessments": [
                {
                    "moduleId": "m1",
                    "questions": [
                        {"answer": "Документ", "learningOutcome": "Собирает страницу"}
                    ],
                }
            ],
        }
    )
    freshness = [item for item in report["items"] if item["id"].startswith("freshness.")]
    assert freshness[0]["status"] == "warning"
    assert "Internet Explorer" in freshness[0]["label"]
