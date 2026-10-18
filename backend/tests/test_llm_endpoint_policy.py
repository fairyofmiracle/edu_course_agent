
import pytest

from backend.app.cloud import validate_llm_endpoint


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
