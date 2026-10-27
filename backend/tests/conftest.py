import os
import tempfile
from pathlib import Path

_db = Path(tempfile.gettempdir()) / "edu-course-agent-test.db"
os.environ["DATABASE_URL"] = f"sqlite:///{_db.as_posix()}"
os.environ["REDIS_URL"] = ""
# Fixed test-only secret so jwt_secret() does not emit the missing-env UserWarning.
# Intentionally not a production value; tests that clear the env expect the warning.
_test_jwt = "edu-course-agent-pytest-only-jwt-secret"
if len(os.environ.get("STUDIO_JWT_SECRET", "").strip()) < 16:
    os.environ["STUDIO_JWT_SECRET"] = _test_jwt


def pytest_sessionstart(session) -> None:
    try:
        from backend.app.database import init_database
    except ModuleNotFoundError:
        return
    init_database()
