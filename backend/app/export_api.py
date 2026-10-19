from __future__ import annotations

from urllib.parse import quote

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from .exports import build_artifact
from .models import CourseDocument

router = APIRouter(tags=["export"])


def file_response(kind: str, course: CourseDocument) -> Response:
    try:
        payload, media, filename = build_artifact(kind, course)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    ascii_name = f"program.{kind.lower().strip()}"
    return Response(
        content=payload,
        media_type=media,
        headers={
            "Content-Disposition": (
                f'attachment; filename="{ascii_name}"; '
                f"filename*=UTF-8''{quote(filename)}"
            ),
            "Cache-Control": "no-store",
        },
    )


@router.post(
    "/api/export/{kind}",
    summary="Выгрузить программу с сервера",
    description="Форматы: json, docx, pptx. Тело — текущий документ курса. Файл собирает FastAPI.",
    operation_id="exportCourse",
)
def export_course(kind: str, course: CourseDocument) -> Response:
    return file_response(kind, course)
