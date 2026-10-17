from __future__ import annotations

import asyncio
import json
from pathlib import Path

from backend.app.agent import clip_references
from backend.app.agent_api import RunRequest, run_case

ROOT = Path(__file__).resolve().parents[1]
REQUEST = (
    "Программа повышения квалификации «Искусственный интеллект в работе учителя» "
    "для учителей школ Ингушетии, 36 часов, очно-заочно с применением дистанционных "
    "технологий. Учителя должны научиться готовить с помощью нейросетей планы уроков, "
    "задания и проверочные работы, а также понимать риски и правила безопасного "
    "использования ИИ в работе с детьми. Итоговая аттестация в форме зачёта по "
    "портфолио из трёх материалов, созданных с помощью ИИ. Использовать только "
    "сервисы, которые доступны в России."
)
FORMAT_NOTE = (
    "Это только образец оформления ДПП ПК. Не копируй тему, часы, стажировку "
    "и содержание исходного файла. Нужна программа 36 часов для учителей об ИИ, "
    "не 248-часовая стажировка по информационным системам.\n\n"
)


async def main() -> None:
    raw_refs = (ROOT / "materials" / "program-qualification-248h.txt").read_text(
        encoding="utf-8"
    )
    refs = FORMAT_NOTE + clip_references(raw_refs, 500)
    print(f"refs_chars={len(raw_refs)}->{len(refs)}")
    data = await run_case(RunRequest(caseId=2, request=REQUEST, references=refs))
    out_dir = ROOT / "logs" / "cases"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "case-2.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    course = data.get("course") or {}
    brief = course.get("brief") or {}
    modules = course.get("modules") or []
    text = " ".join(
        [
            brief.get("title") or "",
            brief.get("attestationForm") or "",
            *(module.get("title") or "" for module in modules),
            *(" ".join(module.get("topics") or []) for module in modules),
        ]
    ).lower()
    practice = sum(float(module.get("practiceHours") or 0) for module in modules)
    hours = sum(float(module.get("hours") or 0) for module in modules) + float(
        brief.get("attestationHours") or 0
    )
    seminar_titles = [
        task.get("title") or ""
        for item in course.get("seminars") or []
        for task in item.get("tasks") or []
    ]
    usage = data.get("usage") or {}
    print(
        f"template={brief.get('programKind')} hours={hours:g} of "
        f"{brief.get('durationHours')} modules={len(modules)} practice={practice:g}"
    )
    print(f"attestation={brief.get('attestationForm')}")
    print(f"format={brief.get('format')} constraints={brief.get('constraints')}")
    checks = [
        ("ПК", brief.get("programKind") == "qualification"),
        ("36 часов", float(brief.get("durationHours") or 0) == 36),
        ("часы сходятся", abs(hours - 36) < 0.001),
        ("портфолио", "портфолио" in (brief.get("attestationForm") or "").lower()),
        ("риски и данные", "риск" in text and ("персональн" in text or "данн" in text)),
        ("нет python-курса", "python" not in text),
        ("есть семинар учителя", any("план урока" in title.lower() for title in seminar_titles)),
        ("273 или 266 в источниках", any(
            "273" in (item.get("title") or "") or "266" in (item.get("title") or "")
            for item in brief.get("references") or []
        )),
    ]
    print("case2_checks")
    for label, ok in checks:
        print(f"  {'ok' if ok else 'FAIL'}  {label}")
    print("modules:")
    for module in modules:
        print(f"  - {module.get('title')} {module.get('hours')}h")
    print(
        "usage "
        f"calls={usage.get('calls')} "
        f"prompt={usage.get('prompt_tokens')} "
        f"completion={usage.get('completion_tokens')} "
        f"total={usage.get('total_tokens')}"
    )


if __name__ == "__main__":
    asyncio.run(main())
