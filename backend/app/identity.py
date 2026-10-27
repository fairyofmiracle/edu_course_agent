"""Заглушки входа и ролей для Swagger.

Сессия дорожной карты — JWT HS256. Пароль не проверяется и не сохраняется.
Подпись читает только /api/auth/me. Остальные маршруты этот токен не принимают:
доступ к API по-прежнему задаёт STUDIO_API_TOKEN.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
import warnings
from enum import Enum
from typing import Any, Literal

from fastapi import APIRouter, Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field

router = APIRouter(prefix="/api/auth", tags=["identity"])

JWT_TTL = 900
STUB_DETAIL = (
    "JWT дорожной карты. Курсы, аудит и выгрузку он не открывает: "
    "их открывает STUDIO_API_TOKEN."
)
roadmap_jwt = HTTPBearer(
    auto_error=False,
    scheme_name="roadmapJwt",
    bearerFormat="JWT",
    description="JWT дорожной карты. Подпись читает GET /api/auth/me.",
)


class StudioRole(str, Enum):
    intake = "intake"
    author = "author"
    compliance = "compliance"
    lead = "lead"


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(
        min_length=3,
        max_length=200,
        examples=["methodist@example.local"],
        description="Почта для будущего входа. Сейчас учётка не ищется.",
    )
    password: str = Field(
        min_length=1,
        max_length=200,
        examples=["не-проверяется"],
        description="В токен не входит и никуда не отправляется.",
    )
    role: StudioRole = Field(
        default=StudioRole.author,
        description="Роль в JWT. Курсы и выгрузку она не закрывает.",
    )


class StubSession(BaseModel):
    stub: Literal[True] = True
    enforced: Literal[False] = False
    token: str = Field(description="JWT HS256. В payload есть stub=true, role и sub.")
    token_type: Literal["Bearer"] = Field(default="Bearer", alias="tokenType")
    expires_in: int = Field(default=JWT_TTL, alias="expiresIn")
    email: str
    role: StudioRole
    detail: str = STUB_DETAIL

    model_config = ConfigDict(populate_by_name=True)


class StubUser(BaseModel):
    stub: Literal[True] = True
    enforced: Literal[False] = False
    email: str = "methodist@example.local"
    display_name: str = Field(default="Методист программы", alias="displayName")
    role: StudioRole = StudioRole.author
    detail: str = "Пример роли. Сессии методиста в этой сборке нет."

    model_config = ConfigDict(populate_by_name=True)


class StubLogout(BaseModel):
    stub: Literal[True] = True
    enforced: Literal[False] = False
    closed: Literal[False] = False
    detail: str = "Сессии нет, выход ничего не закрывает."


class RoleCard(BaseModel):
    id: StudioRole
    title: str
    summary: str
    actions: list[str]


class RoleMap(BaseModel):
    stub: Literal[True] = True
    enforced: Literal[False] = False
    detail: str = "Роли дорожной карты. Сейчас код эти действия не запрещает."
    roles: list[RoleCard]


ROLES: tuple[RoleCard, ...] = (
    RoleCard(
        id=StudioRole.intake,
        title="Методист на входе",
        summary="Принимает сырой запрос и отвечает на уточнения студии.",
        actions=["course.create", "brief.answer"],
    ),
    RoleCard(
        id=StudioRole.author,
        title="Методист программы",
        summary="Прикладывает образец, утверждает каркас и собирает комплект.",
        actions=["framework.approve", "kit.build"],
    ),
    RoleCard(
        id=StudioRole.compliance,
        title="Нормоконтроль",
        summary="Смотрит проверку источников. Ссылка сама документ не подтверждает.",
        actions=["audit.read"],
    ),
    RoleCard(
        id=StudioRole.lead,
        title="Руководитель направления",
        summary="Делает копию под новую аудиторию и забирает выгрузку.",
        actions=["course.copy", "export.read"],
    ),
)


@router.get(
    "/roles",
    response_model=RoleMap,
    summary="Роли дорожной карты",
    operation_id="authRoles",
    description="Четыре роли из продуктовой схемы. Проверка прав ещё не включена.",
)
def auth_roles() -> RoleMap:
    return RoleMap(roles=list(ROLES))


@router.post(
    "/login",
    response_model=StubSession,
    summary="Вход по JWT",
    operation_id="authLogin",
    description="Отдаёт JWT с почтой и ролью. Пароль в токен не входит. Курсы этот токен не открывают.",
)
def auth_login(body: LoginRequest) -> StubSession:
    return StubSession(
        token=issue_jwt(body.email, body.role),
        email=body.email,
        role=body.role,
    )


@router.get(
    "/me",
    response_model=StubUser,
    summary="Кто в JWT",
    operation_id="authMe",
    description="С подписанным JWT возвращает роль из токена. Без подписи показывает пример методиста программы.",
)
def auth_me(
    credentials: HTTPAuthorizationCredentials | None = Depends(roadmap_jwt),
) -> StubUser:
    claims = read_jwt(credentials.credentials) if credentials else None
    if claims is None:
        return StubUser()
    role = StudioRole(claims["role"])
    return StubUser(
        email=str(claims["sub"]),
        role=role,
        display_name=role_title(role),
        detail="Роль взята из JWT. Остальные маршруты этот токен не открывают.",
    )


@router.post(
    "/logout",
    response_model=StubLogout,
    summary="Выход",
    operation_id="authLogout",
    description="Сессии методиста нет, поэтому выход ничего не закрывает.",
)
def auth_logout() -> StubLogout:
    return StubLogout()


_WEAK_JWT_SECRETS = frozenset(
    {
        "roadmap-stub-jwt",
        "secret",
        "changeme",
        "studio",
        "password",
        "jwt-secret",
    }
)
_generated_jwt_secret: bytes | None = None


def _studio_is_production() -> bool:
    flag = os.environ.get("STUDIO_ENV", os.environ.get("ENVIRONMENT", "")).strip().lower()
    return flag in {"prod", "production"}


def jwt_secret() -> bytes:
    """HS256 secret for the roadmap JWT stub.

    Production (STUDIO_ENV=production) requires a strong STUDIO_JWT_SECRET.
    Dev/test without the variable get a per-process random secret and a warning —
    never the old hardcoded roadmap-stub-jwt default.
    """
    global _generated_jwt_secret

    raw = os.environ.get("STUDIO_JWT_SECRET", "").strip()
    if raw:
        if raw in _WEAK_JWT_SECRETS or len(raw) < 16:
            if _studio_is_production():
                raise RuntimeError(
                    "STUDIO_JWT_SECRET слишком слабый для production "
                    "(минимум 16 символов, не словарный дефолт)."
                )
            warnings.warn(
                "STUDIO_JWT_SECRET слабый; допустим только для локальной разработки.",
                stacklevel=2,
            )
        return raw.encode("utf-8")
    if _studio_is_production():
        raise RuntimeError("Задайте STUDIO_JWT_SECRET в окружении production.")
    if _generated_jwt_secret is None:
        _generated_jwt_secret = secrets.token_urlsafe(32).encode("ascii")
        warnings.warn(
            "STUDIO_JWT_SECRET не задан: сгенерирован временный секрет на процесс "
            "(только разработка/тесты).",
            stacklevel=2,
        )
    return _generated_jwt_secret


def issue_jwt(email: str, role: StudioRole, ttl: int = JWT_TTL) -> str:
    now = int(time.time())
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "iss": "studio-roadmap",
        "sub": email,
        "role": role.value,
        "stub": True,
        "iat": now,
        "exp": now + ttl,
    }
    signing = f"{_b64(header)}.{_b64(payload)}"
    signature = hmac.new(jwt_secret(), signing.encode("ascii"), hashlib.sha256).digest()
    return f"{signing}.{_b64_bytes(signature)}"


def read_jwt(token: str) -> dict[str, Any] | None:
    parts = token.split(".")
    if len(parts) != 3:
        return None
    try:
        header = json.loads(_b64decode(parts[0]))
        if not isinstance(header, dict) or header.get("alg") != "HS256":
            return None
        expected = hmac.new(
            jwt_secret(),
            f"{parts[0]}.{parts[1]}".encode("ascii"),
            hashlib.sha256,
        ).digest()
        if not hmac.compare_digest(expected, _b64decode(parts[2])):
            return None
        payload = json.loads(_b64decode(parts[1]))
    except (json.JSONDecodeError, ValueError, UnicodeError):
        return None
    if not isinstance(payload, dict) or payload.get("stub") is not True:
        return None
    exp = payload.get("exp")
    role = payload.get("role")
    email = payload.get("sub")
    if not isinstance(exp, int) or exp < int(time.time()):
        return None
    if not isinstance(email, str) or not email:
        return None
    if role not in {item.value for item in StudioRole}:
        return None
    return payload


def role_title(role: StudioRole) -> str:
    for card in ROLES:
        if card.id == role:
            return card.title
    return "Методист программы"


def _b64(value: dict[str, Any]) -> str:
    raw = json.dumps(value, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    return _b64_bytes(raw)


def _b64_bytes(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
