
import PptxGenJS from "pptxgenjs";
import type { CourseDocument } from "@/lib/course-schema";
import { courseToPresentation } from "@/lib/presentation/course-to-presentation";
import { renderPresentationSlide } from "@/lib/presentation/slide-renderer";

function slug(title: string): string {
  return (title.trim() || "course")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function createPresentation(course: CourseDocument): PptxGenJS {
  const pptx = new PptxGenJS();

  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Студия методиста";
  pptx.subject = course.brief.title;
  pptx.title = `${course.brief.title}: материалы лекций`;
  pptx.company = "Академия цифрового развития";

  pptx.theme = {
    headFontFace: "Georgia",
    bodyFontFace: "Calibri",
  };

  return pptx;
}

function addCover(pptx: PptxGenJS, title: string): void {
  const cover = pptx.addSlide();
  cover.background = { color: "F6F4F1" };

  cover.addText("СТУДИЯ МЕТОДИСТА", {
    x: 0.75,
    y: 1.35,
    w: 11.5,
    h: 0.35,
    fontFace: "Calibri",
    fontSize: 14,
    color: "6E2432",
    margin: 0,
  });

  cover.addText(title, {
    x: 0.75,
    y: 1.85,
    w: 11.5,
    h: 1.5,
    fontFace: "Georgia",
    fontSize: 40,
    color: "1C1614",
    margin: 0,
    fit: "shrink",
  });

  cover.addShape(pptx.ShapeType.rect, {
    x: 0.75,
    y: 3.55,
    w: 2.2,
    h: 0.045,
    fill: { color: "6E2432" },
    line: { color: "6E2432", width: 0 },
  });

  cover.addText("Материалы лекций", {
    x: 0.75,
    y: 3.8,
    w: 11.5,
    h: 0.45,
    fontFace: "Calibri",
    fontSize: 18,
    color: "5C534C",
    margin: 0,
  });
}

/**
 * Совместимый синхронный экспорт для существующих тестов.
 *
 * Важно: не подходит для слайдов с асинхронной
 * обработкой Mermaid-диаграмм.
 */
export function buildCoursePptx(
  course: CourseDocument,
  moduleId?: string,
): PptxGenJS {
  const presentation = courseToPresentation(course, moduleId);
  const pptx = createPresentation(course);

  addCover(pptx, presentation.title);

  // Синхронный интерфейс нельзя безопасно использовать
  // с асинхронным renderPresentationSlide().
  // Поэтому вместо незавершённой генерации сообщаем об ошибке.
  if (presentation.slides.length > 0) {
    throw new Error(
      "Используйте асинхронный buildCoursePptxAsync()",
    );
  }

  return pptx;
}

export async function buildCoursePptxAsync(
  course: CourseDocument,
  moduleId?: string,
): Promise<PptxGenJS> {
  const presentation = courseToPresentation(course, moduleId);
  const pptx = createPresentation(course);

  addCover(pptx, presentation.title);

  for (const slide of presentation.slides) {
    await renderPresentationSlide(pptx, slide);
  }

  return pptx;
}

export async function exportCoursePptx(
  course: CourseDocument,
  moduleId?: string,
): Promise<void> {
  const pptx = await buildCoursePptxAsync(course, moduleId);

  const moduleTitle = moduleId
    ? course.modules.find((entry) => entry.id === moduleId)?.title ?? moduleId
    : "lectures";

  await pptx.writeFile({
    fileName: `${slug(course.brief.title)}-${slug(moduleTitle)}.pptx`,
    compression: true,
  });
}
