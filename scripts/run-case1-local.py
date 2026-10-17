from __future__ import annotations

import asyncio
import json
from pathlib import Path

from backend.app.agent import clip_references
from backend.app.agent_api import RunRequest, run_case

ROOT = Path(__file__).resolve().parents[1]
REQUEST = (
    "Нужна дополнительная общеразвивающая программа «Первые шаги в Python» "
    "для школьников 8 и 9 классов без опыта программирования. Объем 16 часов, "
    "занятия очно по 2 часа два раза в неделю. Практики должно быть не меньше "
    "половины всех часов. В конце каждый ученик защищает небольшой проект, "
    "например простую игру или чат-бота. Нужны итоговый тест на 10 вопросов "
    "и слайды для первых двух занятий."
)


async def main() -> None:
    raw_refs = (ROOT / "materials" / "program-general-24h.txt").read_text(encoding="utf-8")
    refs = clip_references(raw_refs)
    print(f"refs_chars={len(raw_refs)}->{len(refs)}")
    data = await run_case(
        RunRequest(caseId=1, request=REQUEST, references=refs)
    )
    out_dir = ROOT / "logs" / "cases"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "case-1.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    course = data.get("course") or {}
    brief = course.get("brief") or {}
    modules = course.get("modules") or []
    report = data.get("report") or {}
    usage = data.get("usage") or {}
    hours = sum(float(module.get("hours") or 0) for module in modules) + float(
        brief.get("attestationHours") or 0
    )
    print(
        f"template={brief.get('programKind')} hours={hours:g} of "
        f"{brief.get('durationHours')} modules={len(modules)}"
    )
    print(
        f"tests={len(course.get('assessments') or [])} "
        f"questions={sum(len(item.get('questions') or []) for item in course.get('assessments') or [])} "
        f"lectures={len(course.get('lectures') or [])}"
    )
    failed = [item.get("label") for item in report.get("checks") or [] if not item.get("ok")]
    print("framework_fail", "; ".join(failed) if failed else "none")
    audit_fail = [
        item.get("label")
        for item in (report.get("audit") or {}).get("items") or []
        if item.get("status") == "fail"
    ]
    print("audit_fail", "; ".join(audit_fail) if audit_fail else "none")
    print("asked", report.get("askedQuestions"))
    practice = sum(float(module.get("practiceHours") or 0) for module in modules)
    questions = sum(
        len(item.get("questions") or []) for item in course.get("assessments") or []
    )
    lectures = course.get("lectures") or []
    case_checks = [
        ("шаблон общеразвивающий", brief.get("programKind") == "general"),
        ("объём 16 часов", float(brief.get("durationHours") or 0) == 16),
        ("практики не меньше 8", practice >= 8),
        ("итоговый тест на 10 вопросов", questions == 10),
        ("слайды на первые два занятия", len(lectures) >= 2),
        ("есть модули", len(modules) >= 3),
        ("каркас утверждён", bool(course.get("frameworkApproved"))),
    ]
    print("case1_checks")
    for label, ok in case_checks:
        print(f"  {'ok' if ok else 'FAIL'}  {label}")
    stems = [
        question.get("stem") or ""
        for item in course.get("assessments") or []
        for question in item.get("questions") or []
    ]
    seminar = ((course.get("seminars") or [{}])[0].get("tasks") or [{}])[0]
    slide = (((lectures[0] or {}).get("slides") or [{}])[0] if lectures else {})
    quality = [
        ("тест не заглушка", bool(stems) and all("Что верно про тему" not in stem for stem in stems)),
        ("есть input или if", any("input" in stem or "if " in stem for stem in stems)),
        ("защита проекта", "проект" in (brief.get("attestationForm") or "").lower()),
        ("есть семинар", bool(seminar.get("criteria"))),
        ("слайд без заглушки", "Практика по теме" not in " ".join(slide.get("bullets") or [])),
    ]
    print("quality")
    for label, ok in quality:
        print(f"  {'ok' if ok else 'FAIL'}  {label}")
    print(
        "usage "
        f"calls={usage.get('calls')} "
        f"prompt={usage.get('prompt_tokens')} "
        f"completion={usage.get('completion_tokens')} "
        f"total={usage.get('total_tokens')}"
    )


if __name__ == "__main__":
    asyncio.run(main())
