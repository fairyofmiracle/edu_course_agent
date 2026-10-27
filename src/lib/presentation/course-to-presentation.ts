import type { CourseDocument, CourseModule } from "@/lib/course-schema";

import {
  presentationDocumentSchema,
  type PresentationDocument,
  type SlideElement,
} from "@/lib/presentation/slide-schema";

type DeckSlide = {
  kicker: string;
  title: string;
  bullets: string[];
  mermaid?: string;
  visualPrompt?: string;
  speakerNotes?: string;
  table?: string[][];
};

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function label(text: string): string {
  const cleaned = text.replace(/["[\]]/g, " ").replace(/\s+/g, " ").trim();
  return (cleaned || "Тема").slice(0, 42);
}

export function moduleFlowChart(module: CourseModule): string {
  const topics = module.topics.slice(0, 6);
  const lines = ["flowchart LR"];
  topics.forEach((topic, index) => {
    lines.push(`  t${index}["${label(topic)}"]`);
    if (index > 0) lines.push(`  t${index - 1} --> t${index}`);
  });
  if (topics.length < 2) {
    lines.push('  t1["Практика"]');
    lines.push("  t0 --> t1");
  }
  return lines.join("\n");
}

function topicBullets(bullets: string[]): string[] {
  const kept = bullets.filter(
    (item) =>
      item !== "Дальше темы, схема хода и таблица часов." &&
      item !== "Часы темы собраны в таблицу на слайде." &&
      item !== "Сумма совпадает с учебным планом модуля." &&
      item !== "Часы темы собраны в таблицу." &&
      item !== "Таблица стоит на слайде." &&
      !item.startsWith("На лекцию отведено "),
  );
  return kept.length > 0 ? kept : bullets;
}

function lectureSlide(slide: { title: string; table?: string[][] | null }): boolean {
  return slide.title !== "Часы модуля" && slide.title !== "Учебный план" && !(slide.table && slide.table.length > 1);
}

function paint(source: DeckSlide, index: number, total: number): PresentationDocument["slides"][number] {
  const elements: SlideElement[] = [
    {
      type: "text",
      text: source.kicker,
      x: 0.65,
      y: 0.32,
      w: 10.6,
      h: 0.28,
      fontSize: 13,
      bold: false,
      color: "6E2432",
    },
    {
      type: "text",
      text: `${index + 1} / ${total}`,
      x: 11.5,
      y: 0.32,
      w: 1.2,
      h: 0.28,
      fontSize: 13,
      bold: false,
      color: "5C534C",
    },
    {
      type: "text",
      text: source.title,
      x: 0.65,
      y: 0.72,
      w: 12,
      h: 0.7,
      fontSize: 32,
      bold: false,
      color: "1C1614",
    },
    {
      type: "shape",
      shape: "rect",
      x: 0.65,
      y: 1.55,
      w: 2.1,
      h: 0.04,
      fill: "6E2432",
    },
  ];

  if (source.table && source.table.length > 1) {
    const [headers, ...rows] = source.table;
    elements.push({
      type: "table",
      headers: headers.slice(0, 6),
      rows: rows.slice(0, 8).map((row) => headers.slice(0, 6).map((_, cell) => row[cell] || "—")),
      x: 0.65,
      y: 1.9,
      w: 12,
      h: 5.1,
    });
  } else if (source.mermaid && source.bullets.length <= 2) {
    elements.push({
      type: "text",
      text: source.bullets[0] ?? "Схема занятия",
      x: 0.65,
      y: 1.8,
      w: 12,
      h: 0.4,
      fontSize: 16,
      bold: false,
      color: "5C534C",
    });
    elements.push({
      type: "diagram",
      mermaid: source.mermaid,
      x: 0.7,
      y: 2.35,
      w: 11.9,
      h: 4.7,
    });
  } else if (source.mermaid) {
    elements.push({
      type: "text",
      text: source.bullets.map((bullet) => `• ${bullet}`).join("\n"),
      x: 0.65,
      y: 1.85,
      w: 6.1,
      h: 5,
      fontSize: 18,
      bold: false,
      color: "1C1614",
    });
    elements.push({
      type: "diagram",
      mermaid: source.mermaid,
      x: 6.95,
      y: 1.9,
      w: 5.7,
      h: 4.9,
    });
  } else {
    elements.push({
      type: "text",
      text: source.bullets.map((bullet) => `• ${bullet}`).join("\n"),
      x: 0.75,
      y: 1.9,
      w: 11.8,
      h: source.visualPrompt ? 3.4 : 4.8,
      fontSize: 20,
      bold: false,
      color: "1C1614",
    });
    if (source.visualPrompt) {
      elements.push({
        type: "shape",
        shape: "roundRect",
        x: 0.75,
        y: 5.5,
        w: 11.8,
        h: 1.4,
        fill: "F7F3F0",
      });
      elements.push({
        type: "text",
        text: source.visualPrompt,
        x: 0.95,
        y: 5.7,
        w: 11.4,
        h: 1,
        fontSize: 16,
        bold: false,
        color: "5C534C",
      });
    }
  }

  return {
    title: source.title,
    elements,
    speakerNotes: text(source.speakerNotes),
  };
}

export function courseToPresentation(
  course: CourseDocument,
  moduleId?: string,
): PresentationDocument {
  const lectures = moduleId
    ? course.lectures.filter((lecture) => lecture.moduleId === moduleId)
    : course.lectures;
  const deck: DeckSlide[] = [];

  for (const lecture of lectures) {
    const courseModule = course.modules.find((entry) => entry.id === lecture.moduleId);
    const kicker = courseModule?.title ?? lecture.moduleId;
    const sources: DeckSlide[] = lecture.slides.filter(lectureSlide).map((slide) => ({
      kicker,
      title: slide.title,
      bullets: topicBullets(slide.bullets),
      mermaid: text(slide.mermaid),
      visualPrompt: text(slide.visualPrompt),
      speakerNotes: text(slide.speakerNotes),
    }));
    deck.push(...sources);
  }

  const slides = deck.map((source, index) => paint(source, index, deck.length));

  return presentationDocumentSchema.parse({
    title: course.brief.title || "Материалы лекций",
    slides,
  });
}
