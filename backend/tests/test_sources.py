import httpx
import pytest
from fastapi.testclient import TestClient

from backend.app.main import app, courses_router
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


def test_probe_urls_passes_expected_number() -> None:
    from backend.app.source_probe import probe_urls

    page = Page(200, "Приказ № 266".encode(), {"etag": "v1"})
    hits = probe_urls(
        ["https://example.com/order"],
        PageOpener(page),
        expect={"https://example.com/order": "266"},
    )
    assert hits[0]["requisites"] == "found"


def test_number_is_found_beyond_the_last_eighty_characters() -> None:
    body = ("А" * 400 + " Приказ № 629 " + "Б" * 400).encode()
    found = probe_url(
        "https://example.com/order",
        PageOpener(Page(200, body, {"etag": "v1"})),
        expect="629",
    )
    assert found["requisites"] == "found"
    assert "629" not in found["message"]


class SplitPage(Page):
    def __init__(self, chunks: list[bytes]) -> None:
        super().__init__(200, b"".join(chunks), {"etag": "v1"})
        self.chunks = chunks

    def iter_bytes(self):
        yield from self.chunks


def test_number_split_between_large_chunks_is_found() -> None:
    page = SplitPage([("А" * 200 + "62").encode(), ("9" + "Б" * 200).encode()])
    found = probe_url("https://example.com/order", PageOpener(page), expect="629")
    assert found["requisites"] == "found"


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


def test_regulatory_check_marks_number_found_and_missing(monkeypatch) -> None:
    def probe(url, expect=""):
        requisites = "found" if expect == "629" else "missing"
        return {
            "url": url,
            "state": "reachable",
            "message": "Сайт ответил.",
            "requisites": requisites,
        }

    monkeypatch.setattr("backend.app.main.probe_url", probe)
    with TestClient(app) as client:
        found = client.post(
            "/api/regulatory/check",
            json={
                "claims": [
                    {
                        "title": "Приказ",
                        "authority": "Минпросвещения России",
                        "number": "629",
                        "date": "2022-07-27",
                        "source": "https://example.com/order",
                    }
                ]
            },
        )
        missed = client.post(
            "/api/regulatory/check",
            json={
                "claims": [
                    {
                        "title": "Приказ",
                        "authority": "Минпросвещения России",
                        "number": "999",
                        "date": "2022-07-27",
                        "source": "https://example.com/order",
                    }
                ]
            },
        )
    assert found.json()["results"][0]["status"] == "confirmed"
    assert "номер документа на странице есть" in found.json()["results"][0]["message"]
    assert missed.json()["results"][0]["status"] == "unconfirmed"
    assert "не найден" in missed.json()["results"][0]["message"]

    def unchecked(url, expect=""):
        return {
            "url": url,
            "state": "reachable",
            "message": "Сайт ответил 200. Текст не сохранён.",
            "requisites": "unchecked",
        }

    monkeypatch.setattr("backend.app.main.probe_url", unchecked)
    with TestClient(app) as client:
        skipped = client.post(
            "/api/regulatory/check",
            json={
                "claims": [
                    {
                        "title": "Приказ",
                        "authority": "Минпросвещения России",
                        "number": "629",
                        "date": "2022-07-27",
                        "source": "https://example.com/order",
                    }
                ]
            },
        )
    assert skipped.json()["results"][0]["status"] == "unconfirmed"


def test_health_survives_a_broken_gateway(monkeypatch) -> None:
    class Broken:
        def __init__(self) -> None:
            raise RuntimeError("шлюз недоступен")

    monkeypatch.setattr("backend.app.cloud.CloudRuClient", Broken)
    monkeypatch.setenv("STUDIO_CORS_ORIGINS", "https://studio.example, нет, http://ok.example/")
    from backend.app.main import cors_origins

    origins = cors_origins()
    assert "https://studio.example" in origins
    assert "http://ok.example" in origins
    assert all(item != "нет" for item in origins)
    with TestClient(app) as client:
        body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["llmConfigured"] is False
    assert body["llmHost"] == ""



def test_invalid_body_does_not_leak_pydantic() -> None:
    with TestClient(app) as client:
        response = client.post("/api/chat/turn", json={})
    assert response.status_code == 422
    assert "контракт" in response.json()["detail"]
    assert "traceback" not in str(response.json()).lower()


def test_public_error_hides_exception_type() -> None:
    from backend.app.public_errors import public_error_text

    assert "RuntimeError" not in public_error_text(RuntimeError("HTTP 502 Traceback"))
    assert "модели" in public_error_text(RuntimeError("сеть недоступна"))
    dumped = public_error_text(RuntimeError('Cloud.ru вернул ответ без choices: {"secret":"x"}'))
    assert "secret" not in dumped
    assert "choices" not in dumped


def test_health_response_accepts_snake_and_dumps_camel() -> None:
    from backend.app.contracts import HealthResponse

    snake = HealthResponse(
        status="ok",
        service="edu-course-python",
        llm_configured=True,
        llm_host="hub.gigaschool.ru",
    )
    camel = HealthResponse(
        status="ok",
        service="edu-course-python",
        llmConfigured=False,
        llmHost="",
    )
    dumped = snake.model_dump(by_alias=True)
    assert dumped["llmConfigured"] is True
    assert dumped["llmHost"] == "hub.gigaschool.ru"
    assert camel.llm_configured is False


def test_health_reports_configured_gateway(monkeypatch) -> None:
    class Ok:
        def __init__(self) -> None:
            self.api_key = "k"
            self.base_url = "https://hub.gigaschool.ru/api/v1/llm/v1"

    monkeypatch.setattr("backend.app.cloud.CloudRuClient", Ok)
    with TestClient(app) as client:
        body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["llmConfigured"] is True
    assert body["llmHost"] == "hub.gigaschool.ru"


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


def test_redirect_into_the_local_network_is_not_opened() -> None:
    inward = probe_url(
        "https://example.com/start",
        PageOpener(Page(302, b"", {"location": "http://127.0.0.1/secret"})),
    )
    assert inward["state"] == "not_checked"
    missing = probe_url("https://example.com/start", PageOpener(Page(302, b"", {})))
    assert missing["state"] == "unavailable"
    assert "без адреса" in missing["message"]


def test_redirect_hostname_that_resolves_private_is_not_opened(monkeypatch) -> None:
    import socket

    def lookup(host: str, _port: int | None, *_args: object, **_kwargs: object):
        address = "10.9.9.9" if host == "inside.example" else "8.8.8.8"
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, 0))]

    monkeypatch.setattr(socket, "getaddrinfo", lookup)

    class Local(httpx.Client):
        def stream(self, _method: str, _url: str, **_kwargs: object) -> Page:
            return Page(302, b"", {"location": "https://inside.example/secret"})

    with Local() as client:
        closed = probe_url("https://example.com/start", client)
    assert closed["state"] == "not_checked"
    assert "внутренн" in closed["message"]


def test_dns_to_a_private_address_is_not_opened(monkeypatch) -> None:
    import socket

    def private(_host: str, _port: int | None, *_args: object, **_kwargs: object):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.1.2.3", 0))]

    monkeypatch.setattr(socket, "getaddrinfo", private)
    closed = probe_url("https://example.com/order")
    assert closed["state"] == "not_checked"
    assert "внутренн" in closed["message"]


def test_probe_edges_stop_before_the_network(monkeypatch) -> None:
    import socket

    from backend.app.source_probe import host_is_public

    assert not public_http_url("http://[::ffff:127.0.0.1]/secret")
    assert public_http_url("http://[::ffff:8.8.8.8]/order")
    assert host_is_public("https:///order") is False

    def missing(_host: str, _port: int | None, *_args: object, **_kwargs: object):
        raise socket.gaierror("нет такого имени")

    monkeypatch.setattr(socket, "getaddrinfo", missing)
    assert host_is_public("https://missing.example/order") is False

    def broken(_host: str, _port: int | None, *_args: object, **_kwargs: object):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("не-адрес", 0))]

    monkeypatch.setattr(socket, "getaddrinfo", broken)
    assert host_is_public("https://broken.example/order") is False

    class Hop(PageOpener):
        def __init__(self) -> None:
            super().__init__(Page(302, b"", {"location": "https://example.com/next"}))
            self.seen = 0

        def stream(self, _method: str, _url: str) -> Page:
            self.seen += 1
            if self.seen > 4:
                return Page(200, b"ok", {"etag": "v"})
            return Page(302, b"", {"location": f"https://example.com/hop-{self.seen}"})

    too_many = probe_url("https://example.com/start", Hop())
    assert too_many["state"] == "unavailable"
    assert "перенаправлен" in too_many["message"]
    timed = probe_url(
        "https://example.com/order",
        Opener(error=httpx.TimeoutException("slow")),
    )
    assert timed["state"] == "unavailable"
    assert "4 секунды" in timed["message"]


def test_remote_client_cannot_open_the_api() -> None:
    remote = TestClient(app, client=("8.8.8.8", 12345))
    denied = remote.get("/api/courses")
    assert denied.status_code == 401
    assert remote.get("/health").status_code == 200
    assert remote.get("/").status_code != 401


def test_token_closes_the_loopback_api(monkeypatch) -> None:
    if courses_router is None:
        pytest.skip("persistence unavailable")
    monkeypatch.setenv("STUDIO_API_TOKEN", "secret")
    client = TestClient(app)
    assert client.get("/api/courses").status_code == 401
    opened = client.get("/api/courses", headers={"Authorization": "Bearer secret"})
    assert opened.status_code == 200

def test_cgnat_addresses_are_not_public() -> None:
    assert not public_http_url("http://100.64.0.1/order")
    assert not public_http_url("http://100.127.255.254/order")
    assert public_http_url("http://100.63.255.255/order")
    assert public_http_url("http://100.128.0.1/order")
    missed = probe_url("http://100.64.10.10/order")
    assert missed["state"] == "not_checked"


def test_audit_respects_manual_confirmed_reference() -> None:
    from backend.app.audit import audit_course

    course = {
        "brief": {
            "title": "Курс",
            "audience": "Студенты",
            "programKind": "general",
            "durationHours": 16,
            "attestationHours": 0,
            "references": [
                {
                    "title": "Чужая ссылка",
                    "source": "https://example.org/order",
                    "status": "confirmed",
                }
            ],
        },
        "modules": [
            {
                "id": "m1",
                "title": "Модуль",
                "hours": 16,
                "lectureHours": 4,
                "practiceHours": 12,
                "labHours": 0,
                "selfStudyHours": 0,
                "topics": ["Тема"],
                "learningOutcomes": ["Умеет"],
            }
        ],
        "lectures": [{"moduleId": "m1"}],
        "seminars": [{"moduleId": "m1", "tasks": [{"learningOutcome": "Умеет"}]}],
        "assessments": [
            {
                "moduleId": "m1",
                "questions": [{"answer": "Ответ", "learningOutcome": "Умеет"}],
            }
        ],
    }
    pending = [item for item in audit_course(course)["items"] if item["id"] == "sources.unconfirmed"]
    assert pending and pending[0]["status"] == "pass"


def test_effective_reference_status_prefers_explicit_confirmed() -> None:
    from backend.app.verbatim import effective_reference_status, reference_is_confirmed

    assert effective_reference_status({"source": "https://example.org", "status": "confirmed"}) == "confirmed"
    assert reference_is_confirmed({"source": "file.pdf"})
    assert not reference_is_confirmed({"source": "https://example.org"})
