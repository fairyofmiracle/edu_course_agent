import os
import tempfile
from pathlib import Path

_db = Path(tempfile.gettempdir()) / "edu-course-agent-test.db"
os.environ["DATABASE_URL"] = f"sqlite:///{_db.as_posix()}"
os.environ["REDIS_URL"] = ""
# Isolate identity from host/docker prod env so pytest is deterministic.
# Do not read or write the on-disk .env; only process env for this session.
_test_jwt = "edu-course-agent-pytest-only-jwt-secret"
os.environ["STUDIO_JWT_SECRET"] = _test_jwt
os.environ.pop("STUDIO_API_TOKEN", None)
os.environ.pop("STUDIO_ENV", None)
os.environ.pop("ENVIRONMENT", None)


def pytest_sessionstart(session) -> None:
    try:
        from backend.app.database import init_database
    except ModuleNotFoundError:
        return
    init_database()
