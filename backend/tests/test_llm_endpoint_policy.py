
import pytest

from backend.app.cloud import validate_llm_endpoint
from backend.app.cloud import resolve_llm_gateway


@pytest.mark.parametrize("url", [
    "https://foundation-models.api.cloud.ru/v1",
    "https://hub.gigaschool.ru/api/v1/llm/v1",
])
def test_allowed_llm_endpoint(url):
    assert validate_llm_endpoint(url) == url


@pytest.mark.parametrize("url", [
    "https://api.openai.com/v1",
    "https://api.anthropic.com/v1",
    "https://generativelanguage.googleapis.com/v1beta",
    "http://foundation-models.api.cloud.ru/v1",
    "https://hub.gigaschool.ru.evil.example/api/v1/llm/v1",
    "https://hub.gigaschool.ru:8443/api/v1/llm/v1",
])
def test_forbidden_llm_endpoint(url):
    with pytest.raises(ValueError):
        validate_llm_endpoint(url)


def test_broken_llm_address_is_rejected() -> None:
    with pytest.raises(ValueError, match="Некорректный"):
        validate_llm_endpoint("https://foundation-models.api.cloud.ru:99999/v1")

from backend.app.cloud import resolve_llm_gateway


def test_cloudru_gateway_has_priority(monkeypatch):
    monkeypatch.setenv("CLOUDRU_BASE_URL", "")
    monkeypatch.setenv("GIGASCHOOL_BASE_URL", "")
    monkeypatch.setenv("CLOUDRU_API_KEY", "cloud-key")
    monkeypatch.setenv("GIGASCHOOL_API_KEY", "giga-key")

    key, url = resolve_llm_gateway()

    assert key == "cloud-key"
    assert url == "https://foundation-models.api.cloud.ru/v1"


def test_gigaschool_gateway(monkeypatch):
    monkeypatch.setenv("CLOUDRU_BASE_URL", "")
    monkeypatch.setenv("GIGASCHOOL_BASE_URL", "")
    monkeypatch.setenv("CLOUDRU_API_KEY", "")
    monkeypatch.setenv("GIGASCHOOL_API_KEY", "giga-key")

    key, url = resolve_llm_gateway()

    assert key == "giga-key"
    assert url == "https://hub.gigaschool.ru/api/v1/llm/v1"


def test_gigaschool_rejects_foreign_endpoint(monkeypatch):
    monkeypatch.setenv("CLOUDRU_BASE_URL", "")
    monkeypatch.setenv("GIGASCHOOL_BASE_URL", "")
    monkeypatch.setenv("CLOUDRU_API_KEY", "")
    monkeypatch.setenv("GIGASCHOOL_API_KEY", "giga-key")
    monkeypatch.setenv(
        "GIGASCHOOL_BASE_URL",
        "https://api.openai.com/v1",
    )

    with pytest.raises(ValueError, match="LLM API запрещён"):
        resolve_llm_gateway()


def test_no_gateway_key(monkeypatch):
    monkeypatch.setenv("CLOUDRU_BASE_URL", "")
    monkeypatch.setenv("GIGASCHOOL_BASE_URL", "")
    monkeypatch.setenv("CLOUDRU_API_KEY", "")
    monkeypatch.setenv("GIGASCHOOL_API_KEY", "")

    key, url = resolve_llm_gateway()

    assert key == ""
    assert url == "https://foundation-models.api.cloud.ru/v1"

def test_cloudru_key_cannot_be_sent_to_gigaschool(monkeypatch) -> None:
    monkeypatch.setenv("CLOUDRU_API_KEY", "cloud-key")
    monkeypatch.setenv("GIGASCHOOL_API_KEY", "")
    monkeypatch.setenv(
        "CLOUDRU_BASE_URL",
        "https://hub.gigaschool.ru/api/v1/llm/v1",
    )

    with pytest.raises(ValueError):
        resolve_llm_gateway()


def test_gigaschool_key_cannot_be_sent_to_cloudru(monkeypatch) -> None:
    monkeypatch.setenv("CLOUDRU_API_KEY", "")
    monkeypatch.setenv("GIGASCHOOL_API_KEY", "giga-key")
    monkeypatch.setenv(
        "GIGASCHOOL_BASE_URL",
        "https://foundation-models.api.cloud.ru/v1",
    )

    with pytest.raises(ValueError):
        resolve_llm_gateway()