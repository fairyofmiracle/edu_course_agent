"""Структурированные логи api/worker. Без токенов и текста брифа в записи."""

from __future__ import annotations

import json
import logging
import os
import sys
from contextvars import ContextVar
from datetime import datetime, timezone

request_id_var: ContextVar[str] = ContextVar("request_id", default="")
job_id_var: ContextVar[str] = ContextVar("job_id", default="")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict = {
            "time": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "level": record.levelname,
            "service": getattr(record, "service", None)
            or os.getenv("STUDIO_SERVICE")
            or "api",
            "logger": record.name,
            "msg": record.getMessage(),
        }
        rid = getattr(record, "request_id", None) or request_id_var.get("")
        jid = getattr(record, "job_id", None) or job_id_var.get("")
        if rid:
            payload["requestId"] = rid
        if jid:
            payload["jobId"] = jid
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


class ContextFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get("")
        record.job_id = job_id_var.get("")
        record.service = os.getenv("STUDIO_SERVICE") or "api"
        return True


_configured = False


def configure_logging() -> None:
    """LOG_FORMAT=json|text. Не логировать ключи, Authorization, текст брифа."""
    global _configured
    if _configured:
        return
    fmt = (os.getenv("LOG_FORMAT") or "json").strip().lower()
    level_name = (os.getenv("LOG_LEVEL") or "INFO").strip().upper()
    level = getattr(logging, level_name, logging.INFO)

    root = logging.getLogger()
    root.handlers.clear()
    handler = logging.StreamHandler(sys.stdout)
    handler.addFilter(ContextFilter())
    if fmt == "json":
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s")
        )
    root.addHandler(handler)
    root.setLevel(level)
    _configured = True
