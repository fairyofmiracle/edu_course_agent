import type { CourseDocument } from "@/lib/course-schema";

function asText(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asLines(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function slug(title: string) {
  const cleaned = title
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return cleaned || "course";
}

function oneLine(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function giftText(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("~", "\\~")
    .replaceAll("=", "\\=")
    .replaceAll("#", "\\#")
    .replaceAll("{", "\\{")
    .replaceAll("}", "\\}");
}

function giftTitle(moduleTitle: string, index: number, stem: string) {
  return oneLine(`${moduleTitle}. ${index}. ${stem}`)
    .replaceAll(":", "—")
    .slice(0, 180);
}

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function courseToGift(course: CourseDocument) {
  const courseTitle = oneLine(asText(course.brief?.title)) || "Программа";
  const blocks: string[] = [
    "// GIFT. Строки // Moodle при импорте отбрасывает: в них ключ открытого вопроса и результат обучения.",
  ];
  for (const assessment of course.assessments ?? []) {
    const courseModule = (course.modules ?? []).find((item) => item.id === assessment.moduleId);
    const moduleTitle = asText(courseModule?.title).trim() || asText(assessment.moduleId) || "Без названия";
    blocks.push(`$CATEGORY: ${courseTitle}/${moduleTitle}`);
    (assessment.questions ?? []).forEach((question, index) => {
      const title = giftTitle(moduleTitle, index + 1, asText(question.stem));
      const stem = giftText(asText(question.stem).trim());
      const outcome = oneLine(asText(question.learningOutcome));
      const explanation = oneLine(asText(question.explanation));
      if (question.type === "mcq") {
        const correct = oneLine(asText(question.answer));
        const distractors = asLines(question.options)
          .map((option) => oneLine(option))
          .filter((option) => option && option !== correct);
        const choices = correct ? [correct, ...distractors] : distractors;
        const lines = choices.map((choice, choiceIndex) => {
          const mark = correct && choiceIndex === 0 ? "=" : "~";
          const feedback = correct && choiceIndex === 0 ? ` #${giftText(explanation)}` : "";
          return `${mark}${giftText(choice)}${feedback}`;
        });
        blocks.push(
          [
            `::${title}::`,
            stem,
            "{",
            ...lines,
            "}",
            `// Результат: ${outcome}`,
            `// Компетенция: ${asText(question.competencyId)}`,
          ].join("\n"),
        );
      } else {
        blocks.push(
          [
            `::${title}::`,
            stem,
            "{",
            "}",
            `####${giftText(explanation)}`,
            `// Ключ: ${oneLine(asText(question.answer))}`,
            `// Результат: ${outcome}`,
            `// Компетенция: ${asText(question.competencyId)}`,
          ].join("\n"),
        );
      }
    });
  }
  return `${blocks.join("\n\n")}\n`;
}

function csvCell(value: string) {
  const text = value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

export function courseToCsv(course: CourseDocument) {
  const header = [
    "module",
    "type",
    "stem",
    "option_1",
    "option_2",
    "option_3",
    "option_4",
    "option_5",
    "option_6",
    "answer",
    "explanation",
    "learning_outcome",
    "competency",
  ];
  const rows = [header.join(",")];
  for (const assessment of course.assessments ?? []) {
    const courseModule = (course.modules ?? []).find((item) => item.id === assessment.moduleId);
    const moduleTitle = asText(courseModule?.title).trim() || asText(assessment.moduleId);
    for (const question of assessment.questions ?? []) {
      const options = asLines(question.options);
      while (options.length < 6) options.push("");
      rows.push(
        [
          moduleTitle,
          asText(question.type),
          asText(question.stem),
          ...options.slice(0, 6),
          asText(question.answer),
          asText(question.explanation),
          asText(question.learningOutcome),
          asText(question.competencyId),
        ]
          .map((value) => csvCell(value))
          .join(","),
      );
    }
  }
  return `\uFEFF${rows.join("\n")}\n`;
}

export function exportCourseGift(course: CourseDocument) {
  download(
    `${slug(asText(course.brief?.title))}-tests.gift.txt`,
    courseToGift(course),
    "text/plain;charset=utf-8",
  );
}

export function exportCourseCsv(course: CourseDocument) {
  download(
    `${slug(asText(course.brief?.title))}-tests.csv`,
    courseToCsv(course),
    "text/csv;charset=utf-8",
  );
}
