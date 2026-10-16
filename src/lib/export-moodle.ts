import type { CourseDocument } from "@/lib/course-schema";

function cdata(value: string) {
  return `<![CDATA[${value.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
}

function htmlParagraph(value: string) {
  const safe = value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return cdata(`<p>${safe}</p>`);
}

function textElement(value: string) {
  return `<text>${htmlParagraph(value)}</text>`;
}

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

function categoryName(courseTitle: string, moduleTitle: string) {
  const clean = (value: string) => value.replaceAll("/", " / ").trim() || "Без названия";
  return `$course$/${clean(courseTitle)}/${clean(moduleTitle)}`;
}

function questionName(moduleTitle: string, index: number, stem: string) {
  const short = stem.replace(/\s+/g, " ").trim().slice(0, 80);
  return `${moduleTitle}. ${index}. ${short}`.slice(0, 250);
}

function tags(values: string[]) {
  const items = values
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => `      <tag>${textElement(value)}</tag>`);
  if (items.length === 0) return "";
  return `    <tags>\n${items.join("\n")}\n    </tags>\n`;
}

function choiceQuestion(options: {
  name: string;
  stem: string;
  answer: string;
  explanation: string;
  choices: string[];
  tags: string[];
}) {
  const correct = options.answer.trim();
  const distractors = options.choices
    .map((choice) => choice.trim())
    .filter((choice) => choice && choice !== correct);
  const answers = correct ? [correct, ...distractors] : distractors;
  const blocks = answers.map((choice, index) => `    <answer fraction="${correct && index === 0 ? "100" : "0"}" format="html">
      ${textElement(choice)}
    </answer>`);
  return `  <question type="multichoice">
    <name>${textElement(options.name)}</name>
    <questiontext format="html">${textElement(options.stem)}</questiontext>
    <generalfeedback format="html">${textElement(options.explanation)}</generalfeedback>
    <defaultgrade>1</defaultgrade>
    <penalty>0.3333333</penalty>
    <hidden>0</hidden>
    <single>true</single>
    <shuffleanswers>true</shuffleanswers>
    <answernumbering>abc</answernumbering>
${blocks.join("\n")}
${tags(options.tags)}  </question>`;
}

function openQuestion(options: {
  name: string;
  stem: string;
  answer: string;
  explanation: string;
  tags: string[];
}) {
  return `  <question type="essay">
    <name>${textElement(options.name)}</name>
    <questiontext format="html">${textElement(options.stem)}</questiontext>
    <generalfeedback format="html">${textElement(options.explanation)}</generalfeedback>
    <defaultgrade>1</defaultgrade>
    <penalty>0</penalty>
    <hidden>0</hidden>
    <responseformat>editor</responseformat>
    <responserequired>1</responserequired>
    <responsefieldlines>10</responsefieldlines>
    <attachments>0</attachments>
    <attachmentsrequired>0</attachmentsrequired>
    <graderinfo format="html">${textElement(`Ключ: ${options.answer}`)}</graderinfo>
${tags(options.tags)}  </question>`;
}

export function courseToMoodleXml(course: CourseDocument) {
  const courseTitle = asText(course.brief?.title).trim() || "Программа";
  const blocks: string[] = [];
  for (const assessment of course.assessments ?? []) {
    const courseModule = (course.modules ?? []).find((item) => item.id === assessment.moduleId);
    const moduleTitle = asText(courseModule?.title).trim() || asText(assessment.moduleId);
    blocks.push(`  <question type="category">
    <category>
      ${textElement(categoryName(courseTitle, moduleTitle))}
    </category>
  </question>`);
    (assessment.questions ?? []).forEach((question, index) => {
      const common = {
        name: questionName(moduleTitle, index + 1, asText(question.stem)),
        stem: asText(question.stem),
        answer: asText(question.answer),
        explanation: asText(question.explanation),
        tags: [asText(question.learningOutcome), asText(question.competencyId)],
      };
      blocks.push(
        question.type === "mcq"
          ? choiceQuestion({ ...common, choices: asLines(question.options) })
          : openQuestion(common),
      );
    });
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<quiz>
${blocks.join("\n")}
</quiz>
`;
}

export function exportCourseMoodle(course: CourseDocument) {
  const content = courseToMoodleXml(course);
  const blob = new Blob([content], { type: "application/xml" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slug(asText(course.brief?.title))}-moodle.xml`;
  link.click();
  URL.revokeObjectURL(url);
}
