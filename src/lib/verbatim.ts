import type { CourseDocument } from "@/lib/course-schema";
import { isOfficialPublication } from "@/lib/legal-basis";

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

export function generatedFields(course: CourseDocument) {
  const fields: string[] = [];
  for (const lecture of course.lectures) {
    fields.push(...lecture.outline);
    for (const slide of lecture.slides) {
      fields.push(slide.title, ...slide.bullets, slide.speakerNotes ?? "");
    }
  }
  for (const seminar of course.seminars) {
    for (const task of seminar.tasks) {
      fields.push(task.title, task.prompt, ...task.steps, ...task.criteria);
    }
  }
  for (const assessment of course.assessments) {
    for (const question of assessment.questions) {
      fields.push(question.stem, question.answer, question.explanation, ...(question.options ?? []));
    }
  }
  return fields;
}

export function generatedText(course: CourseDocument) {
  return generatedFields(course).join("\n");
}

/** Общие окна из 12 слов между примечанием референса и текстом комплекта. */
export function verbatimSpans(course: CourseDocument, size = SPAN) {
  const reference = spans(referenceNotes(course), size);
  if (reference.size === 0) return [];
  const hits: string[] = [];
  for (const field of generatedFields(course)) {
    for (const span of spans(field, size)) {
      if (!reference.has(span) || hits.includes(span)) continue;
      hits.push(span);
      if (hits.length === 3) return hits;
    }
  }
  return hits;
}

export function isHttpSource(source?: string) {
  return /^https?:\/\//i.test(source?.trim() ?? "");
}

export function isConfirmedStatus(status?: string | null) {
  const value = status?.trim().toLowerCase() ?? "";
  return value === "confirmed" || value === "source_attached";
}

/** Файл методиста или явный confirmed. Официальную публикацию смотрит audit отдельно. */
export function isReferenceConfirmed(reference: {
  source?: string | null;
  status?: string | null;
}) {
  if (isConfirmedStatus(reference.status)) return true;
  const source = reference.source?.trim() ?? "";
  if (!source) return false;
  return !isHttpSource(source);
}

export function unconfirmedReferenceTitles(course: CourseDocument) {
  return course.brief.references
    .filter((reference) => {
      if (isReferenceConfirmed(reference)) return false;
      const source = reference.source?.trim() ?? "";
      if (!source) return true;
      return isHttpSource(source) && !isOfficialPublication(source);
    })
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
