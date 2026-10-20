import { describe, expect, it } from "vitest";
import PptxGenJS from "pptxgenjs";

import { SAMPLE_COURSE } from "@/lib/sample-course";
import { courseToPresentation } from "@/lib/presentation/course-to-presentation";
import { renderFlowchart } from "@/lib/presentation/flowchart-renderer";
import { renderPresentationSlide } from "@/lib/presentation/slide-renderer";
import { presentationDocumentSchema } from "@/lib/presentation/slide-schema";

describe("Presentation renderer", () => {
  it("преобразует существующий курс в презентацию", () => {
    const presentation = courseToPresentation(SAMPLE_COURSE);

    expect(presentation.slides.length).toBeGreaterThan(0);
    expect(presentationDocumentSchema.safeParse(presentation).success).toBe(true);
  });

  it("пустые заметки null не ломают предпросмотр", () => {
    const course = structuredClone(SAMPLE_COURSE);
    const lecture = course.lectures[0];
    lecture.slides[1].speakerNotes = null as unknown as string;
    lecture.slides[3].speakerNotes = null as unknown as string;

    const presentation = courseToPresentation(course, lecture.moduleId);

    expect(presentationDocumentSchema.safeParse(presentation).success).toBe(true);
    expect(presentation.slides[1]?.speakerNotes).toBeUndefined();
    expect(presentation.slides[3]?.speakerNotes).toBeUndefined();
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

  it("рисует таблицу, овал и линию", async () => {
    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_WIDE";
    await renderPresentationSlide(pptx, {
      title: "Таблица",
      elements: [
        {
          type: "table",
          x: 0.5,
          y: 0.5,
          w: 6,
          h: 2,
          headers: ["Тема", "Часы"],
          rows: [
            ["Ввод", "2"],
            ["Практика"],
          ],
        },
        { type: "shape", shape: "ellipse", x: 7, y: 0.5, w: 2, h: 1.2, fill: "EEF2F8" },
        { type: "shape", shape: "line", x: 7, y: 2, w: 3, h: 0.2, fill: "1C1614" },
      ],
    });
    const output = await pptx.write({ outputType: "nodebuffer", compression: true });
    expect(Buffer.from(output as ArrayBuffer).length).toBeGreaterThan(1000);
  });

  it("без браузера оставляет заглушку вместо диаграммы", async () => {
    const pptx = new PptxGenJS();
    await renderPresentationSlide(pptx, {
      title: "Схема",
      elements: [{ type: "diagram", mermaid: "flowchart LR\nA-->B", x: 0.5, y: 0.5, w: 6, h: 3 }],
    });
    const output = await pptx.write({ outputType: "nodebuffer", compression: true });
    expect(Buffer.from(output as ArrayBuffer).length).toBeGreaterThan(500);
  });

  it("отклоняет повтор узла и петлю на себя", () => {
    const duplicated = presentationDocumentSchema.safeParse({
      title: "Тест",
      slides: [
        {
          title: "Слайд",
          elements: [
            {
              type: "flowchart",
              x: 0.5,
              y: 0.5,
              w: 6,
              h: 2,
              nodes: [
                { id: "a", label: "А" },
                { id: "a", label: "Б" },
              ],
              edges: [{ from: "a", to: "a" }],
            },
          ],
        },
      ],
    });
    expect(duplicated.success).toBe(false);

    const unknown = presentationDocumentSchema.safeParse({
      title: "Тест",
      slides: [
        {
          title: "Слайд",
          elements: [
            {
              type: "flowchart",
              x: 0.5,
              y: 0.5,
              w: 6,
              h: 2,
              nodes: [
                { id: "a", label: "А" },
                { id: "b", label: "Б" },
              ],
              edges: [{ from: "a", to: "нет" }],
            },
          ],
        },
      ],
    });
    expect(unknown.success).toBe(false);
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

  it("рисует вертикальную схему с ромбом и обратной стрелкой", async () => {
    const pptx = new PptxGenJS();
    await renderPresentationSlide(pptx, {
      title: "Вертикально",
      elements: [
        {
          type: "flowchart",
          direction: "vertical",
          x: 0.5,
          y: 0.4,
          w: 4,
          h: 6,
          nodes: [
            { id: "a", label: "Старт", shape: "diamond" },
            { id: "b", label: "Шаг", shape: "rect" },
          ],
          edges: [
            { from: "a", to: "b" },
            { from: "b", to: "a", label: "назад" },
          ],
        },
      ],
    });
    const slide = pptx.addSlide();
    expect(() =>
      renderFlowchart(pptx, slide, {
        type: "flowchart",
        x: 0.5,
        y: 0.5,
        w: 0.6,
        h: 2,
        nodes: [
          { id: "a", label: "А", shape: "roundRect" },
          { id: "b", label: "Б", shape: "roundRect" },
        ],
        edges: [{ from: "a", to: "b" }],
      }),
    ).toThrow(/места/);
    expect(() =>
      renderFlowchart(pptx, slide, {
        type: "flowchart",
        x: 0.5,
        y: 0.5,
        w: 6,
        h: 2,
        nodes: [
          { id: "a", label: "А", shape: "roundRect" },
          { id: "b", label: "Б", shape: "roundRect" },
        ],
        edges: [{ from: "a", to: "нет" }],
      }),
    ).toThrow(/неизвестный/);
  });
});
