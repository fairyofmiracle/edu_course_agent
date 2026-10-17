
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
    headFontFace: "Aptos Display",
    bodyFontFace: "Aptos",
  };

  return pptx;
}

function addCover(pptx: PptxGenJS, title: string): void {
  const cover = pptx.addSlide();
  cover.background = { color: "F7F8FA" };

  cover.addText(title, {
    x: 0.8,
    y: 1.55,
    w: 11.7,
    h: 1.1,
    fontFace: "Aptos Display",
    fontSize: 28,
    bold: true,
    color: "18233B",
    margin: 0,
    fit: "shrink",
  });

  cover.addText("Материалы лекций", {
    x: 0.8,
    y: 2.85,
    w: 11.7,
    h: 0.5,
    fontSize: 18,
    color: "4F5B6B",
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
