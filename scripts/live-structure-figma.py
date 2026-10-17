from __future__ import annotations

import asyncio
import json
from pathlib import Path

from backend.app.agent import run_turn
from backend.app.cloud import CloudRuClient
from backend.app.domain import apply_patch
from backend.app.models import empty_course
from backend.app.tools import execute_tool

ROOT = Path(__file__).resolve().parents[1]
TEXT = (
    "Нужна общеразвивающая программа «Основы Figma для музея» на 20 часов, "
    "очно. Слушатели — сотрудники музея без опыта дизайна. "
    "В конце защита макета афиши."
)


async def main() -> None:
    client = CloudRuClient()
    course = empty_course()
    brief = execute_tool("update_brief", {}, course, [TEXT])
    if brief.get("type") != "tool_error":
        course = apply_patch(course, brief)
    result = await run_turn(
        course,
        user_texts=[TEXT],
        model_messages=[{"role": "user", "content": TEXT}],
        client=client,
    )
    out = ROOT / "logs" / "cases" / "live-figma-structure.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(
            {
                "steps": result["steps"],
                "calls": [item.get("tool") for item in result["calls"]],
                "usage": result["usage"],
                "modules": [
                    {"title": module.title, "hours": module.hours}
                    for module in result["course"].modules
                ],
                "kind": result["course"].brief.program_kind,
                "hours": result["course"].brief.duration_hours,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"steps={result['steps']}")
    print(f"modules={[module.title for module in result['course'].modules]}")
    print(f"usage={result['usage']}")
    print(f"wrote={out}")


if __name__ == "__main__":
    asyncio.run(main())
