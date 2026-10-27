from __future__ import annotations

import re
from typing import Any

MARKERS = (
    ("flash", re.compile(r"adobe\s*flash|flash\s*player|shockwave", re.I), "Adobe Flash"),
    ("silverlight", re.compile(r"silverlight", re.I), "Microsoft Silverlight"),
    ("internet-explorer", re.compile(r"internet\s*explorer|\bie11\b|\bie\s*11\b", re.I), "Internet Explorer"),
    ("windows-xp", re.compile(r"windows\s*xp", re.I), "Windows XP"),
    ("python2", re.compile(r"python\s*2(?:\.7)?(?!\d)", re.I), "Python 2"),
    ("angularjs", re.compile(r"angular\s*js", re.I), "AngularJS"),
    ("centos6", re.compile(r"centos\s*[67](?!\d)", re.I), "CentOS 6 или 7"),
    ("tensorflow1", re.compile(r"tensorflow\s*1(?!\d)", re.I), "TensorFlow 1"),
    ("nodejs-old", re.compile(r"node(?:\.js)?\s*(?:10|12|14)(?!\d)", re.I), "Node.js 10/12/14"),
    ("jquery1", re.compile(r"jquery\s*1(?:\.\d+)?(?!\d)", re.I), "jQuery 1"),
    ("bootstrap3", re.compile(r"bootstrap\s*3(?!\d)", re.I), "Bootstrap 3"),
)


def find_outdated(course: dict[str, Any]) -> list[dict[str, str]]:
    hits: list[dict[str, str]] = []
    seen: set[str] = set()
    for module in course.get("modules") or []:
        title = str(module.get("title") or "")
        rows = [("название модуля", title)]
        rows.extend(("тема", str(topic)) for topic in module.get("topics") or [])
        rows.extend(
            ("тема плана", str(row.get("title") or ""))
            for row in module.get("plan") or []
            if isinstance(row, dict)
        )
        rows.extend(
            ("результат", str(outcome)) for outcome in module.get("learningOutcomes") or []
        )
        for kind, text in rows:
            for marker_id, pattern, label in MARKERS:
                if not text or not pattern.search(text):
                    continue
                place = f"Модуль «{title}», {kind}: {text}"
                key = f"{marker_id}:{place}"
                if key in seen:
                    continue
                seen.add(key)
                hits.append({"id": marker_id, "label": label, "place": place})
    return hits
