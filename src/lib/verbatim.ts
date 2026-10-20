import type { CourseDocument } from "@/lib/course-schema";

const WORD = /[a-zа-яё0-9]+/gi;
const SPAN = 12;

function words(text: string) {
  return (text.toLocaleLowerCase("ru-RU").match(WORD) ?? []).map((word) => word.replaceAll("ё", "е"));
}

function spans(text: string, size = SPAN) {
  const tokens = words(text);
  const found = new Set<string>();
  for (let index = 0; index + size <= tokens.length; index += 1) {
    found.add(tokens.slice(index, index + size).join(" "));
  }
  return found;
}

export function referenceNotes(course: CourseDocument) {
  return course.brief.references.map((reference) => reference.note ?? "").join("\n");
}

export function generatedText(course: CourseDocument) {
  return [
    ...course.lectures.flatMap((lecture) => [
      ...lecture.outline,
      ...lecture.slides.flatMap((slide) => [slide.title, ...slide.bullets, slide.speakerNotes ?? ""]),
    ]),
    ...course.seminars.flatMap((seminar) =>
      seminar.tasks.flatMap((task) => [task.title, task.prompt, ...task.steps]),
    ),
    ...course.assessments.flatMap((assessment) =>
      assessment.questions.flatMap((question) => [question.stem, question.explanation]),
    ),
  ].join("\n");
}

/** Общие окна из 12 слов между примечанием референса и текстом комплекта. */
export function verbatimSpans(course: CourseDocument, size = SPAN) {
  const reference = spans(referenceNotes(course), size);
  if (reference.size === 0) return [];
  const hits: string[] = [];
  for (const span of spans(generatedText(course), size)) {
    if (!reference.has(span)) continue;
    hits.push(span);
    if (hits.length === 3) break;
  }
  return hits;
}

export function isHttpSource(source?: string) {
  return /^https?:\/\//i.test(source?.trim() ?? "");
}

export function unconfirmedReferenceTitles(course: CourseDocument) {
  return course.brief.references
    .filter((reference) => !reference.source?.trim() || isHttpSource(reference.source))
    .map((reference) => reference.title);
}

export function sourceConfidence(course: CourseDocument) {
  const unconfirmed = unconfirmedReferenceTitles(course);
  const copies = verbatimSpans(course);
  const level = copies.length > 0 ? "низкая" : unconfirmed.length > 0 ? "средняя" : "высокая";
  const summary = [
    `Уверенность: ${level}.`,
    unconfirmed.length > 0
      ? `Не подтверждены: ${unconfirmed.join("; ")}. Ссылка сама по себе документ не подтверждает.`
      : "Непроверенных источников нет.",
    copies.length > 0
      ? `Дословный фрагмент референса: «${copies[0]}».`
      : "Дословного копирования референса нет.",
  ].join(" ");
  return { level, summary, unconfirmed, copies };
}
