import type { CourseDocument } from "@/lib/course-schema";

const ORDER = /№\s*(\d+)/gi;
const LABOR = /\b([A-ZА-ЯЁ]\/\d{2}\.\d)\b/g;
/** Номера, которые в программу ставит код правовой основы, а не модель. */
const KNOWN_ORDERS = new Set(["629", "266", "499", "273"]);

export function allowedCorpus(course: CourseDocument) {
  const brief = course.brief;
  return [
    brief.title,
    brief.audience,
    ...brief.goals,
    ...brief.constraints,
    ...brief.references.flatMap((reference) => [
      reference.title,
      reference.note ?? "",
      reference.source ?? "",
    ]),
  ]
    .filter(Boolean)
    .join("\n");
}

export function generatedText(course: CourseDocument) {
  const chunks: string[] = [];
  for (const module of course.modules) {
    chunks.push(module.title, ...module.topics, ...module.learningOutcomes);
    for (const row of module.plan) chunks.push(row.title);
  }
  for (const lecture of course.lectures) {
    chunks.push(...lecture.outline);
    for (const slide of lecture.slides) {
      chunks.push(slide.title ?? "", ...slide.bullets, slide.speakerNotes ?? "");
      for (const row of slide.table ?? []) chunks.push(...row);
    }
  }
  for (const seminar of course.seminars) {
    for (const task of seminar.tasks) {
      chunks.push(task.title, task.prompt, ...task.steps, ...task.criteria);
    }
  }
  for (const assessment of course.assessments) {
    for (const question of assessment.questions) {
      chunks.push(
        question.stem,
        question.answer,
        question.explanation,
        ...(question.options ?? []),
      );
    }
  }
  for (const node of course.competencies.nodes) {
    chunks.push(node.name, ...node.knowledge, ...node.skills, ...node.abilities);
  }
  return chunks.filter(Boolean).join("\n");
}

export function laborCodes(course: CourseDocument) {
  const codes: string[] = [];
  for (const node of course.competencies.nodes) {
    const code = node.laborFunctionCode?.trim();
    if (code && !codes.includes(code)) codes.push(code);
  }
  return codes;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Номер из «72 часа» или даты «27.07» приказом не считается. */
export function orderGrounded(number: string, allowed: string) {
  if (KNOWN_ORDERS.has(number)) return true;
  return new RegExp(`№\\s*${number}(?!\\d)`, "i").test(allowed);
}

export function codeGrounded(code: string, allowed: string) {
  return new RegExp(`(?<![\\w/])${escapeRegExp(code)}(?!\\d)`).test(allowed);
}

/** Номера приказов и коды трудовых функций, которых нет у методиста. */
export function inventedRequisites(course: CourseDocument) {
  const allowed = allowedCorpus(course);
  const body = generatedText(course);
  const found: string[] = [];
  for (const match of body.matchAll(ORDER)) {
    const number = match[1];
    if (orderGrounded(number, allowed)) continue;
    const label = `№ ${number}`;
    if (!found.includes(label)) found.push(label);
  }
  for (const match of body.matchAll(LABOR)) {
    const code = match[1];
    if (!codeGrounded(code, allowed) && !found.includes(code)) found.push(code);
  }
  for (const code of laborCodes(course)) {
    if (!codeGrounded(code, allowed) && !found.includes(code)) found.push(code);
  }
  return found;
}
