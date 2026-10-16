import PptxGenJS from "pptxgenjs";
import type { CourseDocument } from "@/lib/course-schema";
import { renderMermaidToSvg } from "@/lib/presentation/mermaid-svg";
import { addFourCardsLayout } from "@/lib/presentation/layouts";

function svgToDataUri(svg: string): string {
  const bytes = new TextEncoder().encode(svg);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

function slug(title: string) {
  return (title.trim() || "course")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

type PreparedDiagram = {
  lectureIndex: number;
  slideIndex: number;
  svg: string;
};

type PptxOptions = {
  diagrams?: PreparedDiagram[];
};

export function buildCoursePptx(
  course: CourseDocument,
  moduleId?: string,
  options: PptxOptions = {},
) {
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

  for (const [lectureIndex, lecture] of lectures.entries()) {
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

      const useFourCards =
        source.bullets.length === 4 &&
        !source.mermaid &&
        !source.visualPrompt;

      if (useFourCards) {
        addFourCardsLayout(pptx, slide, source.bullets);
      } else {
        slide.addText(
          source.bullets.map((bullet) => `• ${bullet}`).join("\n"),
          {
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
          },
        );
      }

      const preparedDiagram = options.diagrams?.find(
        (diagram) =>
        diagram.lectureIndex === lectureIndex &&
        diagram.slideIndex === index,
      );
      const support = source.mermaid || source.visualPrompt;

      if (preparedDiagram){
        slide.addImage({
          data: svgToDataUri(preparedDiagram.svg),
          x: 1.0,
          y: 4.7,
          w: 10.8,
          h: 1.8,
        });
      } else if (support) {
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

//последовательная обработка схем
async function prepareDiagrams(
  course: CourseDocument,
  moduleId?: string,
): Promise<PreparedDiagram[]> {
  const lectures = moduleId
    ? course.lectures.filter(
        (lecture) => lecture.moduleId === moduleId,
      )
    : course.lectures;

  const diagrams: PreparedDiagram[] = [];

  for (const [lectureIndex, lecture] of lectures.entries()) {
    for (const [slideIndex, slide] of lecture.slides.entries()) {
      if (!slide.mermaid) continue;

      try {
        const svg = await renderMermaidToSvg(slide.mermaid);

        diagrams.push({
          lectureIndex,
          slideIndex,
          svg,
        });
      } catch (error) {
        console.warn(
          `Не удалось подготовить схему для слайда ${slideIndex + 1}`,
          error,
        );
      }
    }
  }

  return diagrams;
}

export async function exportCoursePptx(
  course: CourseDocument,
  moduleId?: string,
) {
  const diagrams = await prepareDiagrams(course, moduleId);
  const pptx = buildCoursePptx(course, moduleId, {
    diagrams,
  });
  const moduleTitle = moduleId
    ? course.modules.find((entry) => entry.id === moduleId)?.title ?? moduleId
    : "lectures";
  await pptx.writeFile({
    fileName: `${slug(course.brief.title)}-${slug(moduleTitle)}.pptx`,
    compression: true,
  });
}
