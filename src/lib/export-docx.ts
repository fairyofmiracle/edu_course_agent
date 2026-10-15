import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import {
  BLOOM_LABELS,
  FORMAT_LABELS,
  LEVEL_LABELS,
  PROGRAM_KIND_LABELS,
  type CourseDocument,
} from "@/lib/course-schema";

function slug(title: string) {
  return (title.trim() || "course")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function paragraph(text: string, heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel]) {
  return new Paragraph({
    text,
    heading,
    spacing: { after: heading ? 160 : 100 },
  });
}

function bullet(text: string) {
  return new Paragraph({ text, bullet: { level: 0 }, spacing: { after: 60 } });
}

function cell(text: string, bold = false) {
  return new TableCell({
    children: [
      new Paragraph({
        children: [new TextRun({ text: text || "—", bold })],
      }),
    ],
  });
}

function table(headers: string[], rows: string[][]) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: headers.map((header) => cell(header, true)) }),
      ...rows.map((row) => new TableRow({ children: row.map((value) => cell(value)) })),
    ],
  });
}

export function buildCourseDocx(course: CourseDocument) {
  const { brief } = course;
  const children: Array<Paragraph | Table> = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 180 },
      children: [
        new TextRun({
          text:
            brief.programKind === "qualification"
              ? "ДОПОЛНИТЕЛЬНАЯ ПРОФЕССИОНАЛЬНАЯ ПРОГРАММА ПОВЫШЕНИЯ КВАЛИФИКАЦИИ"
              : "ДОПОЛНИТЕЛЬНАЯ ОБЩЕРАЗВИВАЮЩАЯ ПРОГРАММА",
          bold: true,
          size: 28,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 360 },
      children: [new TextRun({ text: `«${brief.title || "Без названия"}»`, bold: true, size: 34 })],
    }),
    paragraph("1. Общая характеристика программы", HeadingLevel.HEADING_1),
    table(
      ["Параметр", "Значение"],
      [
        ["Вид программы", PROGRAM_KIND_LABELS[brief.programKind]],
        ["Аудитория", brief.audience],
        ["Уровень", LEVEL_LABELS[brief.level]],
        ["Форма обучения", FORMAT_LABELS[brief.format]],
        ["Объём", `${brief.durationHours} академических часов`],
        ["Итоговая аттестация", `${brief.attestationForm || "—"} · ${brief.attestationHours} ч`],
      ],
    ),
    paragraph("1.1. Цель и планируемые результаты", HeadingLevel.HEADING_2),
    ...(brief.goals.length ? brief.goals.map(bullet) : [paragraph("Цели не заполнены.")]),
    paragraph("1.2. Ограничения и условия", HeadingLevel.HEADING_2),
    ...(brief.constraints.length ? brief.constraints.map(bullet) : [paragraph("Ограничения не указаны.")]),
    paragraph("2. Карта компетенций", HeadingLevel.HEADING_1),
    table(
      ["Код", "Компетенция", "Уровень", "Знания", "Умения", "Навыки", "Трудовая функция"],
      course.competencies.nodes.map((node) => [
        node.id,
        node.name,
        BLOOM_LABELS[node.bloomLevel],
        node.knowledge.join("; "),
        node.skills.join("; "),
        node.abilities.join("; "),
        node.laborFunctionCode || "—",
      ]),
    ),
    paragraph("3. Учебный план", HeadingLevel.HEADING_1),
    table(
      ["Модуль", "Лекции", "Практика", "Лаб.", "СРС", "Всего"],
      [
        ...course.modules.map((module) => [
          module.title,
          String(module.lectureHours),
          String(module.practiceHours),
          String(module.labHours),
          String(module.selfStudyHours),
          String(module.hours),
        ]),
        [
          "Итоговая аттестация",
          "0",
          "0",
          "0",
          "0",
          String(brief.attestationHours),
        ],
        [
          "Итого",
          String(course.modules.reduce((sum, module) => sum + module.lectureHours, 0)),
          String(course.modules.reduce((sum, module) => sum + module.practiceHours, 0)),
          String(course.modules.reduce((sum, module) => sum + module.labHours, 0)),
          String(course.modules.reduce((sum, module) => sum + module.selfStudyHours, 0)),
          String(brief.durationHours),
        ],
      ],
    ),
    paragraph("4. Учебно-тематический план", HeadingLevel.HEADING_1),
  ];

  for (const courseModule of course.modules) {
    children.push(
      paragraph(`${courseModule.title} · ${courseModule.hours} ч`, HeadingLevel.HEADING_2),
    );
    children.push(
      table(
        ["Тема", "Лекции", "Практика", "Лаб.", "СРС"],
        courseModule.plan.map((row) => [
          row.title,
          String(row.lectureHours),
          String(row.practiceHours),
          String(row.labHours),
          String(row.selfStudyHours),
        ]),
      ),
    );
    children.push(paragraph("Результаты обучения", HeadingLevel.HEADING_3));
    children.push(...courseModule.learningOutcomes.map(bullet));
  }

  children.push(paragraph("5. Оценочные материалы", HeadingLevel.HEADING_1));
  for (const assessment of course.assessments) {
    const courseModule = course.modules.find((entry) => entry.id === assessment.moduleId);
    children.push(
      paragraph(courseModule?.title ?? assessment.moduleId, HeadingLevel.HEADING_2),
    );
    assessment.questions.forEach((question, index) => {
      children.push(paragraph(`${index + 1}. ${question.stem}`));
      if (question.options?.length) children.push(...question.options.map(bullet));
      children.push(paragraph(`Ответ: ${question.answer}`));
      children.push(
        paragraph(`Результат обучения: ${question.learningOutcome || "не указан"}`),
      );
    });
  }

  children.push(paragraph("6. Практические задания", HeadingLevel.HEADING_1));
  for (const seminar of course.seminars) {
    const courseModule = course.modules.find((entry) => entry.id === seminar.moduleId);
    children.push(paragraph(courseModule?.title ?? seminar.moduleId, HeadingLevel.HEADING_2));
    for (const task of seminar.tasks) {
      children.push(paragraph(`${task.title} · ${task.timeMin} мин`, HeadingLevel.HEADING_3));
      children.push(paragraph(task.prompt));
      children.push(...task.steps.map((step, index) => paragraph(`${index + 1}. ${step}`)));
      children.push(paragraph("Критерии"));
      children.push(...task.criteria.map(bullet));
      children.push(paragraph(`Результат обучения: ${task.learningOutcome || "не указан"}`));
    }
  }

  children.push(paragraph("7. Источники и референсы", HeadingLevel.HEADING_1));
  children.push(
    ...(brief.references.length
      ? brief.references.map((reference) =>
          bullet(
            [reference.title, reference.source, reference.note].filter(Boolean).join(" · "),
          ),
        )
      : [paragraph("Источники не указаны. Нормативные документы требуют ручной проверки.")]),
  );
  children.push(paragraph("Реквизиты приказа: ____________________"));
  children.push(paragraph("Преподаватели: ____________________"));
  children.push(paragraph("Подпись: ____________________"));

  return new Document({
    creator: "Студия методиста",
    title: brief.title,
    description: "Проект образовательной программы",
    sections: [{ properties: {}, children }],
  });
}

export async function exportCourseDocx(course: CourseDocument) {
  const blob = await Packer.toBlob(buildCourseDocx(course));
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slug(course.brief.title)}.docx`;
  link.click();
  URL.revokeObjectURL(url);
}
