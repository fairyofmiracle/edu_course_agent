from __future__ import annotations

import re
from typing import Any

LAW_273 = {
    "id": "fz-273",
    "title": "Федеральный закон от 29.12.2012 № 273-ФЗ «Об образовании в Российской Федерации»",
    "source": "http://publication.pravo.gov.ru/document/0001201212300007",
    "note": "Официальное опубликование 30.12.2012, номер 0001201212300007. Основание программ повышения квалификации.",
}

ORDER_629 = {
    "id": "order-629",
    "title": "Приказ Минпросвещения России от 27.07.2022 № 629",
    "source": "http://publication.pravo.gov.ru/document/0001202209270013",
    "note": "Порядок по дополнительным общеобразовательным программам. Официальное опубликование 27.09.2022, регистрация Минюста 26.09.2022 № 70226.",
}

ORDER_266 = {
    "id": "order-266",
    "title": "Приказ Минобрнауки России от 24.03.2025 № 266",
    "source": "http://publication.pravo.gov.ru/document/0001202504230011",
    "note": "Порядок по дополнительным профессиональным программам. Официальное опубликование 23.04.2025. Действует с 01.09.2025 и признаёт утратившим силу приказ от 01.07.2013 № 499. Методист подтверждает применимость.",
}

_MARKERS = {
    "fz-273": re.compile(r"273-фз"),
    "order-629": re.compile(r"№\s*629(?!\d)"),
    "order-266": re.compile(r"№\s*266(?!\d)"),
    "order-499": re.compile(r"№\s*499(?!\d)"),
}


def is_official_publication(source: str | None) -> bool:
    text = (source or "").strip().rstrip("/").lower()
    if text.startswith("https://"):
        text = "http://" + text[len("https://") :]
    known = {
        item["source"].rstrip("/").lower()
        for item in (LAW_273, ORDER_629, ORDER_266)
    }
    return text in known


def required_legal_basis(kind: str | None) -> list[dict[str, str]]:
    if kind == "general":
        return [ORDER_629]
    if kind == "qualification":
        return [LAW_273, ORDER_266]
    return []


def _mentioned(references: list[Any], document: dict[str, str]) -> bool:
    source = document["source"].lower()
    marker = _MARKERS[document["id"]]
    for reference in references:
        if not isinstance(reference, dict):
            continue
        reference_source = str(reference.get("source") or "").lower()
        if source in reference_source:
            return True
        if marker.search(str(reference.get("title") or "").lower()):
            return True
    return False


def merge_legal_basis(brief: dict[str, Any]) -> None:
    required = required_legal_basis(str(brief.get("programKind") or ""))
    if not required:
        return
    references = [item for item in (brief.get("references") or []) if isinstance(item, dict)]
    for document in reversed(required):
        if _mentioned(references, document):
            continue
        references.insert(
            0,
            {
                "title": document["title"],
                "source": document["source"],
                "note": document["note"],
            },
        )
    brief["references"] = references[:20]


def _cites_order_499(references: list[Any]) -> bool:
    for reference in references:
        if not isinstance(reference, dict):
            continue
        if str(reference.get("source") or "") == ORDER_266["source"]:
            continue
        title = str(reference.get("title") or "")
        if re.search(r"№\s*266(?!\d)", title):
            continue
        if re.search(r"№\s*499(?!\d)", title):
            return True
    return False


def legal_basis_items(course: dict[str, Any]) -> list[dict[str, Any]]:
    brief = course.get("brief") if isinstance(course.get("brief"), dict) else {}
    kind = str(brief.get("programKind") or "")
    references = brief.get("references") or []
    items: list[dict[str, Any]] = []
    for document in required_legal_basis(kind):
        if _mentioned(references, document):
            continue
        items.append(
            {
                "id": f"basis.{document['id']}",
                "label": f"Нет обязательного источника: {document['title']}",
                "status": "fail",
                "section": "sources",
                "details": document["source"],
            }
        )
    if kind != "qualification":
        return items
    cited = _cites_order_499(references)
    items.append(
        {
            "id": "basis.order-499",
            "label": "Приказ № 499 утратил силу с 01.09.2025",
            "status": "warning",
            "section": "freshness",
            "details": (
                f"Он указан в источниках. Действующий порядок — {ORDER_266['title']}: {ORDER_266['source']}. Методист подтверждает, какой документ ставить в программу."
                if cited
                else f"В требовании он назван основанием программ повышения квалификации. Действующий порядок — {ORDER_266['title']}: {ORDER_266['source']}. Методист подтверждает применимость."
            ),
        }
    )
    nodes = (course.get("competencies") or {}).get("nodes") or []
    missing = [
        str(node.get("id") or "")
        for node in nodes
        if isinstance(node, dict) and not str(node.get("laborFunctionCode") or "").strip()
    ]
    if nodes and missing:
        items.append(
            {
                "id": "basis.labor-codes",
                "label": "У компетенций повышения квалификации нет кода трудовой функции",
                "status": "warning",
                "section": "sources",
                "details": f"{', '.join(missing)}. Код берётся из профстандарта методиста и не придумывается.",
            }
        )
    return items
