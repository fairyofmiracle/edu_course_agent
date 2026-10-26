import os
import tempfile
from pathlib import Path

_db = Path(tempfile.gettempdir()) / "edu-course-agent-test.db"
os.environ["DATABASE_URL"] = f"sqlite:///{_db.as_posix()}"
os.environ["REDIS_URL"] = ""


def pytest_sessionstart(session) -> None:
    try:
        from backend.app.database import init_database
    except ModuleNotFoundError:
        return
    init_database()
