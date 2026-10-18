from datetime import date

import httpx

from backend.app.stack_freshness import check_stack, find_versions


class Catalog:
    def __init__(self, pages: dict[str, list[dict] | Exception]) -> None:
        self.pages = pages

    def cycles(self, slug: str) -> list[dict]:
        page = self.pages[slug]
        if isinstance(page, Exception):
            raise page
        return page


def test_version_without_a_number_is_not_a_hit() -> None:
    assert find_versions(["Изучаем Python и JavaScript"]) == []
    found = find_versions(["Практика на Python 3.8 и Node.js 18"])
    assert {(item["slug"], item["version"]) for item in found} == {("python", "3.8"), ("nodejs", "18")}


def test_ended_support_is_a_warning_and_a_live_branch_is_not() -> None:
    report = check_stack(
        ["Модуль «Данные»: Python 3.8", "Модуль «Данные»: Python 3.12"],
        today=date(2026, 10, 16),
        source=Catalog(
            {
                "python": [
                    {"cycle": "3.12", "eol": False},
                    {"cycle": "3.8", "eol": "2024-10-07"},
                ]
            }
        ),
    )
    by_id = {hit["id"]: hit for hit in report["hits"]}
    assert by_id["python-3.8"]["status"] == "eol"
    assert "2024-10-07" in by_id["python-3.8"]["detail"]
    assert by_id["python-3.12"]["status"] == "supported"
    assert "3.8" not in report["source"]


def test_more_products_and_catalog_edges() -> None:
    found = find_versions(
        [
            "",
            "PHP 8.2 и PostgreSQL 16, MySQL 8.0, Ubuntu 22.04, Angular 18, .NET 8, Kubernetes 1.30",
        ]
    )
    slugs = {item["slug"] for item in found}
    assert slugs >= {"php", "postgresql", "mysql"}
    assert len(found) <= 6
    report = check_stack(
        ["PHP 8.1", "PHP 8.1"],
        today=date(2026, 10, 16),
        source=Catalog(
            {
                "php": [
                    {"cycle": "8.1", "eol": True},
                    {"cycle": "8.2", "eol": "не дата"},
                    {"cycle": "8.3", "eol": "2029-12-01"},
                ]
            }
        ),
    )
    assert report["hits"][0]["status"] == "eol"
    bad_date = check_stack(
        ["PHP 8.2"],
        today=date(2026, 10, 16),
        source=Catalog({"php": [{"cycle": "8.2", "eol": "не дата"}]}),
    )
    assert bad_date["hits"][0]["status"] == "unknown"
    assert check_stack(["Изучаем Python"])["state"] == "empty"
    missing = check_stack(
        ["PHP 7.4"],
        today=date(2026, 10, 16),
        source=Catalog({"php": [{"cycle": "8.3", "eol": "2029-12-01"}]}),
    )
    assert missing["hits"][0]["status"] == "unknown"


def test_silent_catalog_does_not_become_an_end_of_support() -> None:
    report = check_stack(
        ["Java 17"],
        today=date(2026, 10, 16),
        source=Catalog({"java": httpx.ConnectError("down")}),
    )
    hit = report["hits"][0]
    assert hit["status"] == "unavailable"
    assert "не ответил" in hit["detail"]
    assert hit["status"] != "eol"
