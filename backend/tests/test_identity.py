import pytest
from fastapi.testclient import TestClient

from backend.app.identity import StudioRole, issue_jwt
from backend.app.main import app


def test_openapi_lists_auth_stubs() -> None:
    schema = TestClient(app).get("/openapi.json").json()
    paths = schema["paths"]
    assert set(paths) >= {
        "/api/auth/roles",
        "/api/auth/login",
        "/api/auth/me",
        "/api/auth/logout",
    }
    tag = next(item for item in schema["tags"] if item["name"] == "identity")
    assert "JWT" in tag["description"]
    assert "STUDIO_API_TOKEN" in tag["description"]
    scheme = schema["components"]["securitySchemes"]["roadmapJwt"]
    assert scheme["type"] == "http"
    assert scheme["scheme"] == "bearer"
    assert scheme["bearerFormat"] == "JWT"
    assert "security" not in paths["/api/auth/login"]["post"]
    assert paths["/api/auth/me"]["get"]["security"] == [{"roadmapJwt": []}]
    assert "security" not in paths["/health"]["get"]
    assert "security" not in paths["/api/audit"]["post"]


def test_login_stub_discards_password_and_does_not_open_the_api(monkeypatch: pytest.MonkeyPatch) -> None:
    client = TestClient(app)
    response = client.post(
        "/api/auth/login",
        json={"email": "lead@example.local", "password": "secret-phrase", "role": "lead"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["stub"] is True
    assert payload["enforced"] is False
    assert payload["tokenType"] == "Bearer"
    assert payload["expiresIn"] == 900
    assert payload["token"].count(".") == 2
    assert payload["role"] == "lead"
    assert payload["email"] == "lead@example.local"
    assert "secret-phrase" not in response.text
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {payload['token']}"})
    assert me.status_code == 200
    assert me.json()["email"] == "lead@example.local"
    assert me.json()["role"] == "lead"
    assert me.json()["displayName"] == "Руководитель направления"
    assert me.json()["enforced"] is False
    broken = payload["token"][:-1] + ("A" if payload["token"][-1] != "A" else "B")
    forged = client.get("/api/auth/me", headers={"Authorization": f"Bearer {broken}"})
    assert forged.json()["email"] == "methodist@example.local"
    expired = issue_jwt("lead@example.local", StudioRole.lead, ttl=-30)
    stale = client.get("/api/auth/me", headers={"Authorization": f"Bearer {expired}"})
    assert stale.json()["email"] == "methodist@example.local"

    monkeypatch.setenv("STUDIO_API_TOKEN", "secret")
    remote = TestClient(app, client=("8.8.8.8", 9))
    stub_header = {"Authorization": f"Bearer {payload['token']}"}
    assert remote.get("/api/auth/roles", headers=stub_header).status_code == 401
    assert remote.post("/api/audit", headers=stub_header, json={}).status_code == 401
    assert remote.get("/health", headers=stub_header).status_code == 200
    opened = remote.post("/api/audit", headers={"Authorization": "Bearer secret"}, json={})
    assert opened.status_code != 401


def test_roles_me_and_logout_are_fixed_examples() -> None:
    client = TestClient(app)
    roles = client.get("/api/auth/roles")
    assert roles.status_code == 200
    body = roles.json()
    assert body["enforced"] is False
    assert [item["id"] for item in body["roles"]] == [
        "intake",
        "author",
        "compliance",
        "lead",
    ]
    assert body["roles"][0]["title"] == "Методист на входе"
    assert body["roles"][2]["title"] == "Нормоконтроль"

    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["displayName"] == "Методист программы"
    assert me.json()["enforced"] is False

    logout = client.post("/api/auth/logout")
    assert logout.status_code == 200
    assert logout.json()["closed"] is False


def test_jwt_secret_rejects_default_in_production(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STUDIO_ENV", "production")
    monkeypatch.delenv("STUDIO_JWT_SECRET", raising=False)
    from backend.app import identity as identity_mod

    identity_mod._generated_jwt_secret = None
    with pytest.raises(RuntimeError, match="STUDIO_JWT_SECRET"):
        identity_mod.jwt_secret()


def test_jwt_secret_rejects_weak_secret_in_production(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STUDIO_ENV", "production")
    monkeypatch.setenv("STUDIO_JWT_SECRET", "roadmap-stub-jwt")
    from backend.app import identity as identity_mod

    with pytest.raises(RuntimeError, match="слабый"):
        identity_mod.jwt_secret()


def test_jwt_secret_generates_dev_secret_without_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("STUDIO_ENV", raising=False)
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    monkeypatch.delenv("STUDIO_JWT_SECRET", raising=False)
    from backend.app import identity as identity_mod

    identity_mod._generated_jwt_secret = None
    first = identity_mod.jwt_secret()
    second = identity_mod.jwt_secret()
    assert first == second
    assert len(first) >= 32
    assert first != b"roadmap-stub-jwt"
