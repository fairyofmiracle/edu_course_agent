from __future__ import annotations

from urllib.parse import quote

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from .exports import build_artifact
from .models import CourseDocument

router = APIRouter(tags=["export"])


_ASCII_NAME = {
    "moodle": "program.xml",
    "gift": "program.gift.txt",
    "csv": "program.csv",
    "html": "program.html",
}


def file_response(kind: str, course: CourseDocument) -> Response:
    try:
        payload, media, filename = build_artifact(kind, course)
    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail="Этот формат не собираем. Нужны json, docx, pptx, zip, moodle, gift, csv или html.",
        ) from error
    headers = {
        "Content-Disposition": (
            f'attachment; filename="{_ASCII_NAME.get(kind.lower().strip(), f"program.{kind.lower().strip()}")}"; '
            f"filename*=UTF-8''{quote(filename)}"
        ),
        "Cache-Control": "no-store",
        "X-Studio-Export": "ready",
    }
    if kind.lower().strip() == "zip":
        try:
            from .artifacts import remember_zip

            digest = remember_zip(course, payload, filename)
        except Exception:
            digest = None
        if digest:
            headers["X-Studio-Sha256"] = digest
    return Response(content=payload, media_type=media, headers=headers)


@router.post(
    "/api/export/{kind}",
    summary="Выгрузить программу с сервера",
    description="Форматы: json, docx, pptx, zip, moodle, gift, csv, html. Тело — текущий документ курса. Файл собирает FastAPI.",
    operation_id="exportCourse",
)
def export_course(kind: str, course: CourseDocument) -> Response:
    return file_response(kind, course)
