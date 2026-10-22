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
import time
from enum import Enum
from typing import Any, Literal

from fastapi import APIRouter, Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field

router = APIRouter(prefix="/api/auth", tags=["identity"])

JWT_TTL = 900
STUB_DETAIL = (
    "Заглушка дорожной карты. Это JWT HS256, остальные маршруты его не принимают. "
    "Доступ к API по-прежнему задаёт STUDIO_API_TOKEN."
)
roadmap_jwt = HTTPBearer(
    auto_error=False,
    scheme_name="roadmapJwt",
    bearerFormat="JWT",
    description=(
        "JWT HS256 заглушки. Подпись проверяет только GET /api/auth/me. "
        "Остальные маршруты этот заголовок как сессию пользователя не читают."
    ),
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
        description="Почта учётной записи. Заглушка её не ищет.",
    )
    password: str = Field(
        min_length=1,
        max_length=200,
        examples=["не-проверяется"],
        description="Пароль. Заглушка его не проверяет и не сохраняет.",
    )
    role: StudioRole = Field(
        default=StudioRole.author,
        description="Какую роль показать в ответе. На остальные маршруты не влияет.",
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
    detail: str = "Сессии нет. Это пример роли из дорожной карты, не текущий пользователь."

    model_config = ConfigDict(populate_by_name=True)


class StubLogout(BaseModel):
    stub: Literal[True] = True
    enforced: Literal[False] = False
    closed: Literal[False] = False
    detail: str = "Выход ничего не закрывает: пользовательской сессии нет."


class RoleCard(BaseModel):
    id: StudioRole
    title: str
    summary: str
    actions: list[str]


class RoleMap(BaseModel):
    stub: Literal[True] = True
    enforced: Literal[False] = False
    detail: str = "Матрица ролей для дорожной карты. Код эти действия не запрещает."
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
    description="Четыре роли из продуктовой схемы. Проверка прав не включена.",
)
def auth_roles() -> RoleMap:
    return RoleMap(roles=list(ROLES))


@router.post(
    "/login",
    response_model=StubSession,
    summary="Вход, заглушка",
    operation_id="authLogin",
    description=(
        "Отдаёт JWT HS256 с ролью в payload. Пароль в токен не попадает и не проверяется. "
        "Рабочие маршруты этот JWT не принимают."
    ),
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
    summary="Текущий пользователь по JWT",
    operation_id="authMe",
    description=(
        "Если прислан подписанный JWT заглушки, возвращает роль из токена. "
        "Без токена или с чужой подписью отдаёт пример методиста программы. "
        "Доступ к остальным маршрутам не меняется."
    ),
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
        detail="JWT заглушки разобран. Доступ к остальным маршрутам он не открывает.",
    )


@router.post(
    "/logout",
    response_model=StubLogout,
    summary="Выход, заглушка",
    operation_id="authLogout",
    description="Ничего не закрывает: пользовательской сессии в этой сборке нет.",
)
def auth_logout() -> StubLogout:
    return StubLogout()


def jwt_secret() -> bytes:
    raw = os.environ.get("STUDIO_JWT_SECRET", "").strip() or "roadmap-stub-jwt"
    return raw.encode("utf-8")


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
