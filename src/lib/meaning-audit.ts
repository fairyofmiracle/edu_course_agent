import type { CourseDocument } from "@/lib/course-schema";

export type MeaningHit = {
  id: string;
  kind: "empty" | "template" | "title-as-body" | "duplicate";
  label: string;
  details: string;
  moduleId?: string;
  severity: "warning" | "fail";
};

const TEMPLATE_PHRASES = [
  "будет описано",
  "будет добавлено",
  "заполнить позже",
  "текст лекции",
  "lorem ipsum",
  "lorem",
  "placeholder",
  "todo",
  "tbd",
  "coming soon",
  "в разработке",
  "пример текста",
  "insert text",
  "добавить содержание",
];

function norm(value: string): string {
  return value
    .toLocaleLowerCase("ru-RU")
    .replaceAll("ё", "е")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string): string[] {
  return norm(value)
    .split(" ")
    .filter((part) => part.length > 2);
}

/** Jaccard overlap on token sets; 1 = identical bags. */
export function textSimilarity(a: string, b: string): number {
  const left = new Set(tokens(a));
  const right = new Set(tokens(b));
  if (left.size === 0 || right.size === 0) return 0;
  let inter = 0;
  for (const token of left) {
    if (right.has(token)) inter += 1;
  }
  return inter / (left.size + right.size - inter);
}

function findTemplate(text: string): string | null {
  const n = norm(text);
  if (!n) return null;
  for (const phrase of TEMPLATE_PHRASES) {
    if (n.includes(norm(phrase))) return phrase;
  }
  return null;
}

function isTitleAsBody(title: string, body: string): boolean {
  const t = norm(title);
  const b = norm(body);
  if (!t || !b) return false;
  if (b === t) return true;
  if (b.length <= t.length + 8 && b.startsWith(t)) return true;
  return false;
}

type Block = {
  id: string;
  moduleId?: string;
  place: string;
  title: string;
  body: string;
};

function collectBlocks(course: CourseDocument): Block[] {
  const blocks: Block[] = [];

  for (const lecture of course.lectures) {
    const outline = lecture.outline.map((line) => line.trim()).filter(Boolean).join("\n");
    blocks.push({
      id: `lecture.${lecture.moduleId}.outline`,
      moduleId: lecture.moduleId,
      place: `Лекция модуля ${lecture.moduleId}: план`,
      title: "План лекции",
      body: outline,
    });
    lecture.slides.forEach((slide, index) => {
      const body = [...slide.bullets, slide.speakerNotes ?? ""].join("\n").trim();
      blocks.push({
        id: `lecture.${lecture.moduleId}.slide.${index}`,
        moduleId: lecture.moduleId,
        place: `Слайд «${slide.title}»`,
        title: slide.title,
        body,
      });
    });
  }

  for (const seminar of course.seminars) {
    seminar.tasks.forEach((task, index) => {
      const body = [task.prompt, ...task.steps, ...task.criteria].join("\n").trim();
      blocks.push({
        id: `seminar.${seminar.moduleId}.task.${index}`,
        moduleId: seminar.moduleId,
        place: `Задание «${task.title}»`,
        title: task.title,
        body,
      });
    });
  }

  for (const assessment of course.assessments) {
    assessment.questions.forEach((question, index) => {
      const body = [
        question.stem,
        ...(question.options ?? []),
        question.answer,
        question.explanation,
      ]
        .join("\n")
        .trim();
      blocks.push({
        id: `assessment.${assessment.moduleId}.q.${index}`,
        moduleId: assessment.moduleId,
        place: `Вопрос ${index + 1}`,
        title: question.stem.slice(0, 80),
        body,
      });
    });
  }

  for (const courseModule of course.modules) {
    const body = [...courseModule.topics, ...courseModule.learningOutcomes].join("\n").trim();
    blocks.push({
      id: `module.${courseModule.id}.topics`,
      moduleId: courseModule.id,
      place: `Модуль «${courseModule.title}»`,
      title: courseModule.title,
      body,
    });
  }

  return blocks;
}

/** Детерминированный чеклист смысла: пустое, шаблон, заголовок=тело, дубли. */
export function meaningHits(course: CourseDocument): MeaningHit[] {
  const hits: MeaningHit[] = [];
  const blocks = collectBlocks(course);

  for (const block of blocks) {
    if (!block.body.trim()) {
      hits.push({
        id: `meaning.empty.${block.id}`,
        kind: "empty",
        label: `Пустой блок: ${block.place}`,
        details: "Нет связного текста — методист или модель должны заполнить содержание.",
        moduleId: block.moduleId,
        severity: "fail",
      });
      continue;
    }

    const template = findTemplate(block.body);
    if (template) {
      hits.push({
        id: `meaning.template.${block.id}`,
        kind: "template",
        label: `Шаблонная фраза в «${block.place}»`,
        details: `Найдено: «${template}». Замените на содержательный текст.`,
        moduleId: block.moduleId,
        severity: "fail",
      });
    }

    if (isTitleAsBody(block.title, block.body)) {
      hits.push({
        id: `meaning.titlebody.${block.id}`,
        kind: "title-as-body",
        label: `Заголовок повторён как тело: ${block.place}`,
        details: "Текст совпадает с названием — это не содержание.",
        moduleId: block.moduleId,
        severity: "warning",
      });
    }
  }

  const comparable = blocks.filter((block) => tokens(block.body).length >= 6);
  for (let i = 0; i < comparable.length; i += 1) {
    for (let j = i + 1; j < comparable.length; j += 1) {
      const left = comparable[i];
      const right = comparable[j];
      if (left.moduleId && right.moduleId && left.moduleId === right.moduleId) {
        if (left.id.startsWith("lecture.") && right.id.startsWith("lecture.")) continue;
      }
      const score = textSimilarity(left.body, right.body);
      if (score < 0.82) continue;
      hits.push({
        id: `meaning.dup.${left.id}.${right.id}`,
        kind: "duplicate",
        label: "Похожие тексты в разных блоках",
        details: `${left.place} ≈ ${right.place} (сходство ${(score * 100).toFixed(0)}%).`,
        moduleId: left.moduleId,
        severity: "warning",
      });
    }
  }

  return hits;
}
