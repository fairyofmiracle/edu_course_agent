import { describe, expect, it } from "vitest";
import PptxGenJS from "pptxgenjs";

import { SAMPLE_COURSE } from "@/lib/sample-course";
import { courseToPresentation } from "@/lib/presentation/course-to-presentation";
import { renderPresentationSlide } from "@/lib/presentation/slide-renderer";
import { presentationDocumentSchema } from "@/lib/presentation/slide-schema";

describe("Presentation renderer", () => {
  it("преобразует существующий курс в презентацию", () => {
    const presentation = courseToPresentation(SAMPLE_COURSE);

    expect(presentation.slides.length).toBeGreaterThan(0);
    expect(presentationDocumentSchema.safeParse(presentation).success).toBe(true);
  });

  it("создаёт PPTX из универсальных элементов", async () => {
    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_WIDE";

    await renderPresentationSlide(pptx, {
      title: "Тестовый слайд",
      elements: [
        {
          type: "text",
          text: "Основы кибербезопасности",
          x: 0.8,
          y: 1,
          w: 10,
          h: 1,
          fontSize: 28,
          bold: true,
          color: "18233B",
        },
        {
          type: "shape",
          shape: "rect",
          x: 0.8,
          y: 2.5,
          w: 5,
          h: 1.5,
          fill: "EEF2F8",
        },
      ],
      speakerNotes: "Объяснить основные понятия.",
    });

    const result = await pptx.write({
      outputType: "nodebuffer",
      compression: true,
    });

    expect(Buffer.from(result as ArrayBuffer).length).toBeGreaterThan(1000);
  });

  it("отклоняет элементы за границами слайда", () => {
    const result = presentationDocumentSchema.safeParse({
      title: "Тест",
      slides: [
        {
          title: "Слайд",
          elements: [
            {
              type: "text",
              text: "Некорректный блок",
              x: 12,
              y: 1,
              w: 3,
              h: 1,
            },
          ],
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("создаёт редактируемую диаграмму из JSON", async () => {
    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_WIDE";

    await renderPresentationSlide(pptx, {
      title: "Этапы обработки данных",
      elements: [
        {
          type: "flowchart",
          x: 0.8,
          y: 2,
          w: 11.5,
          h: 2.5,
          direction: "horizontal",
          nodes: [
            { id: "input", label: "Сбор данных", shape: "roundRect" },
            { id: "process", label: "Обработка", shape: "roundRect" },
            { id: "result", label: "Результат", shape: "roundRect" },
          ],
          edges: [
            { from: "input", to: "process" },
            { from: "process", to: "result" },
          ],
        },
      ],
    });

    const output = await pptx.write({
      outputType: "nodebuffer",
      compression: true,
    });

    const buffer = Buffer.from(output as ArrayBuffer);

    expect(buffer.length).toBeGreaterThan(1000);
  });
});
