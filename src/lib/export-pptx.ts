import PptxGenJS from "pptxgenjs";
import type { CourseDocument } from "@/lib/course-schema";

function slug(title: string) {
  return (title.trim() || "course")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export function buildCoursePptx(course: CourseDocument, moduleId?: string) {
  const lectures = moduleId
    ? course.lectures.filter((lecture) => lecture.moduleId === moduleId)
    : course.lectures;
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

  const cover = pptx.addSlide();
  cover.background = { color: "F7F8FA" };
  cover.addText(course.brief.title || "Образовательная программа", {
    x: 0.8,
    y: 1.55,
    w: 11.7,
    h: 1.1,
    fontFace: "Aptos Display",
    fontSize: 28,
    bold: true,
    color: "18233B",
    margin: 0,
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
  cover.addShape(pptx.ShapeType.line, {
    x: 0.8,
    y: 3.55,
    w: 4.8,
    h: 0,
    line: { color: "2456D8", width: 3 },
  });

  for (const lecture of lectures) {
    const courseModule = course.modules.find((entry) => entry.id === lecture.moduleId);
    lecture.slides.forEach((source, index) => {
      const slide = pptx.addSlide();
      slide.background = { color: "FFFFFF" };
      slide.addText(courseModule?.title ?? lecture.moduleId, {
        x: 0.65,
        y: 0.35,
        w: 10.9,
        h: 0.3,
        fontSize: 9,
        bold: true,
        color: "2456D8",
        charSpacing: 1.2,
        margin: 0,
      });
      slide.addText(`${index + 1} / ${lecture.slides.length}`, {
        x: 11.7,
        y: 0.35,
        w: 0.9,
        h: 0.3,
        fontSize: 9,
        color: "6B7280",
        align: "right",
        margin: 0,
      });
      slide.addText(source.title, {
        x: 0.65,
        y: 0.95,
        w: 11.7,
        h: 0.8,
        fontFace: "Aptos Display",
        fontSize: 26,
        bold: true,
        color: "18233B",
        breakLine: false,
        fit: "shrink",
        margin: 0,
      });
      slide.addShape(pptx.ShapeType.line, {
        x: 0.65,
        y: 1.9,
        w: 4.8,
        h: 0,
        line: { color: "2456D8", width: 2.5 },
      });
      slide.addText(source.bullets.map((bullet) => `• ${bullet}`).join("\n"), {
        x: 0.85,
        y: 2.25,
        w: 11,
        h: source.visualPrompt || source.mermaid ? 2.6 : 3.8,
        fontSize: 20,
        color: "384253",
        breakLine: false,
        fit: "shrink",
        margin: 0.05,
        paraSpaceAfter: 14,
      });
      const support = source.mermaid || source.visualPrompt;
      if (support) {
        slide.addShape(pptx.ShapeType.rect, {
          x: 0.85,
          y: 5.15,
          w: 11,
          h: 1.15,
          fill: { color: "EEF2F8" },
          line: { color: "D5DBE5", width: 1 },
        });
        slide.addText(
          source.mermaid
            ? `Схема для визуализации:\n${source.mermaid}`
            : `Визуал: ${source.visualPrompt}`,
          {
            x: 1.05,
            y: 5.35,
            w: 10.6,
            h: 0.75,
            fontSize: source.mermaid ? 9 : 14,
            color: "4F5B6B",
            fontFace: source.mermaid ? "Aptos Mono" : "Aptos",
            fit: "shrink",
            margin: 0,
          },
        );
      }
      if (source.speakerNotes) slide.addNotes(source.speakerNotes);
    });
  }
  return pptx;
}

export async function exportCoursePptx(course: CourseDocument, moduleId?: string) {
  const pptx = buildCoursePptx(course, moduleId);
  const moduleTitle = moduleId
    ? course.modules.find((entry) => entry.id === moduleId)?.title ?? moduleId
    : "lectures";
  await pptx.writeFile({
    fileName: `${slug(course.brief.title)}-${slug(moduleTitle)}.pptx`,
    compression: true,
  });
}
