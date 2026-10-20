from __future__ import annotations

import os

from starlette.requests import Request
from starlette.responses import JSONResponse

_OPEN = {"/health", "/openapi.json", "/docs", "/redoc"}
_LOCAL = {"127.0.0.1", "::1", "localhost", "testclient"}


def studio_token() -> str:
    """Только переменная процесса. Файл .env сам по себе API не открывает."""
    return os.environ.get("STUDIO_API_TOKEN", "").strip()


def request_allowed(request: Request) -> bool:
    path = request.url.path
    if request.method == "OPTIONS" or path in _OPEN or path.startswith("/docs"):
        return True
    if not path.startswith("/api"):
        return True
    token = studio_token()
    header = request.headers.get("authorization", "")
    supplied = header[7:].strip() if header.lower().startswith("bearer ") else ""
    if token:
        return supplied == token
    host = request.client.host if request.client else ""
    return host in _LOCAL


def access_denied() -> JSONResponse:
    return JSONResponse(
        {"detail": "API студии закрыт. Откройте программу через сайт."},
        status_code=401,
    )
