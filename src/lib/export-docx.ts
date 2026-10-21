import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  PageBreak,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import {
  FORMAT_LABELS,
  LEVEL_LABELS,
  type CourseDocument,
  type CourseModule,
} from "@/lib/course-schema";
import { triggerBrowserDownload } from "@/lib/browser-download";
import { ORDER_266, ORDER_499, requiredLegalBasis, type LegalDocument } from "@/lib/legal-basis";
import { moduleRationales, resultPassport } from "@/lib/module-rationale";

const LETTERHEAD = [
  "Автономная некоммерческая организация",
  "дополнительного профессионального образования",
  "«Академия Информационных Технологий»",
  "ОГРН: 1230600003457, ИНН/КПП: 0600010064/060001001",
  "Российская Федерация, 386001, Республика Ингушетия, городской округ Магас,",
  "город Магас, улица Н.С. Хрущева, дом 10",
];

const BORDER = { style: BorderStyle.SINGLE, size: 4, color: "666666" };
const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };
type KindKey = "lectureHours" | "practiceHours" | "labHours" | "selfStudyHours";

type Block = Paragraph | Table;

function hours(value: number) {
  return String(Math.round(value * 2) / 2).replace(".", ",");
}

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

function centered(text: string, bold = false, size = 24) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 60 },
    children: [new TextRun({ text, bold, size, font: "Times New Roman" })],
  });
}

function right(text: string) {
  return new Paragraph({
    alignment: AlignmentType.RIGHT,
    spacing: { after: 40 },
    children: [new TextRun({ text, font: "Times New Roman", size: 24 })],
  });
}

function bullet(text: string) {
  return new Paragraph({ text, bullet: { level: 0 }, spacing: { after: 40 } });
}

function cell(text: string, bold = false) {
  return new TableCell({
    borders: BORDERS,
    width: { size: 100, type: WidthType.PERCENTAGE },
    children: [
      new Paragraph({
        children: [new TextRun({ text: text || "—", bold, font: "Times New Roman", size: 20 })],
      }),
    ],
  });
}

function table(headers: string[], rows: string[][]) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: headers.map((header) => cell(header, true)), tableHeader: true }),
      ...rows.map((row) => new TableRow({ children: row.map((value) => cell(value)) })),
    ],
  });
}

function kindSum(modules: CourseModule[], key: KindKey) {
  return modules.reduce((total, courseModule) => total + courseModule[key], 0);
}

function moduleTitle(course: CourseDocument, moduleId: string) {
  return course.modules.find((courseModule) => courseModule.id === moduleId)?.title ?? moduleId;
}

function linesOrBlank(lines: string[], blank: string) {
  return lines.length ? lines.map(bullet) : [paragraph(blank)];
}

export function courseDocxHeadings(course: CourseDocument) {
  return composeCourseDocx(course).headings;
}

function composeCourseDocx(course: CourseDocument) {
  const headings: string[] = [];
  const mark = (text: string, heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel]) => {
    headings.push(text);
    return paragraph(text, heading);
  };
  const { brief } = course;
  const qualification = brief.programKind === "qualification";
  const programTitle =
    brief.programKind === "qualification"
      ? "ДОПОЛНИТЕЛЬНАЯ ПРОФЕССИОНАЛЬНАЯ ПРОГРАММА ПОВЫШЕНИЯ КВАЛИФИКАЦИИ"
      : brief.programKind === "general"
        ? "ДОПОЛНИТЕЛЬНАЯ ОБЩЕОБРАЗОВАТЕЛЬНАЯ ОБЩЕРАЗВИВАЮЩАЯ ПРОГРАММА"
        : "ДОПОЛНИТЕЛЬНАЯ ОБРАЗОВАТЕЛЬНАЯ ПРОГРАММА";
  const year = new Date().getFullYear();
  const children: Block[] = [
    ...LETTERHEAD.map((line) => centered(line, line.startsWith("«"))),
    right("УТВЕРЖДЕНО"),
    right("Приказом № ____-ОБР от «___» __________ ______ г."),
    centered(programTitle, true, 28),
    centered(`«${brief.title || "Без названия"}»`, true, 32),
    centered(`Магас, ${year}`),
    new Paragraph({ children: [new PageBreak()] }),
  ];
  headings.push(programTitle, "Приказом № ____-ОБР от «___» __________ ______ г.");

  if (qualification) children.push(...qualificationCharacteristic(course, mark));
  else children.push(...generalCharacteristic(course, mark));

  children.push(
    mark("2. Содержание программы", HeadingLevel.HEADING_1),
    mark("2.1. Учебный план", HeadingLevel.HEADING_2),
    studyPlan(course),
    mark("Паспорт результата", HeadingLevel.HEADING_2),
    paragraph(
      "Этот блок считает код. Формулировки лекций в него не входят и при новом прогоне модели могут отличаться.",
    ),
    paragraph(resultPassport(course)),
    mark("Почему план такой", HeadingLevel.HEADING_2),
    paragraph(
      "Формулировки лекций при новом прогоне модели могут отличаться. Часы, результаты и связь со средствами проверки считает код.",
    ),
    ...moduleRationales(course).map((row) => bullet(row.text)),
    mark("2.2. Учебно-тематический план", HeadingLevel.HEADING_2),
    ...thematicPlan(course, mark),
    mark("2.3. Календарный учебный график", HeadingLevel.HEADING_2),
    paragraph(
      `Объём программы: ${hours(brief.durationHours)} академических часов, из них итоговая аттестация ${hours(brief.attestationHours)} ч.`,
    ),
    paragraph(
      "Срок обучения, число учебных дней и режим занятий устанавливаются расписанием и приказом организации о зачислении.",
    ),
    ...assessmentAppendix(course, mark),
    ...conditions(course, mark),
  );

  return { children, headings };
}

function generalCharacteristic(
  course: CourseDocument,
  mark: (text: string, heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel]) => Paragraph,
) {
  const { brief } = course;
  const knowledge = course.competencies.nodes.flatMap((node) => node.knowledge);
  const skills = course.competencies.nodes.flatMap((node) => node.skills);
  const abilities = course.competencies.nodes.flatMap((node) => node.abilities);
  return [
    mark("Пояснительная записка", HeadingLevel.HEADING_1),
    paragraph(
      `${brief.title || "Программа"} реализуется как ${LEVEL_LABELS[brief.level].toLocaleLowerCase("ru-RU")} уровень. Форма обучения: ${FORMAT_LABELS[brief.format]}.`,
    ),
    paragraph(`Категория обучающихся: ${brief.audience || "____________________"}.`),
    paragraph(
      `Документ по итогам обучения: ${brief.attestationForm || "____________________"}.`,
    ),
    mark("1.1. Актуальность программы", HeadingLevel.HEADING_2),
    ...linesOrBlank(brief.goals, "Актуальность заполняет методист."),
    mark("1.2. Категории обучающихся", HeadingLevel.HEADING_2),
    paragraph(brief.audience || "____________________"),
    mark("1.3. Цель и задачи программы", HeadingLevel.HEADING_2),
    ...linesOrBlank(brief.goals, "Цель не заполнена."),
    ...(brief.constraints.length
      ? [paragraph("Условия и ограничения"), ...brief.constraints.map(bullet)]
      : []),
    mark("1.4. Сроки реализации", HeadingLevel.HEADING_2),
    paragraph(`Трудоёмкость: ${hours(brief.durationHours)} академических часов.`),
    paragraph("Даты начала и окончания устанавливаются приказом организации о зачислении."),
    mark("1.5. Планируемые результаты обучения", HeadingLevel.HEADING_2),
    paragraph("Знания"),
    ...linesOrBlank(knowledge, "Знания не заполнены."),
    paragraph("Умения"),
    ...linesOrBlank(skills, "Умения не заполнены."),
    paragraph("Навыки"),
    ...linesOrBlank(abilities, "Навыки не заполнены."),
    mark("1.6. Нормативные основания", HeadingLevel.HEADING_2),
    ...basisLines(course),
  ];
}

function qualificationCharacteristic(
  course: CourseDocument,
  mark: (text: string, heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel]) => Paragraph,
) {
  const { brief } = course;
  return [
    mark(
      "1. Общая характеристика дополнительной профессиональной программы",
      HeadingLevel.HEADING_1,
    ),
    mark("1.1. Аннотация программы", HeadingLevel.HEADING_2),
    ...linesOrBlank(brief.goals, "Аннотация не заполнена."),
    mark("1.2. Цель реализации программы", HeadingLevel.HEADING_2),
    ...linesOrBlank(brief.goals, "Цель не заполнена."),
    mark("1.3. Планируемые результаты обучения", HeadingLevel.HEADING_2),
    competencyTable(course),
    mark("1.4. Программа разработана на основе", HeadingLevel.HEADING_2),
    ...basisLines(course),
    mark(
      `${ORDER_499.title} назван в исходном требовании и утратил силу с 01.09.2025. Действующий порядок — ${ORDER_266.title}. Методист подтверждает, какой документ оставить.`,
    ),
    mark("1.5. Профессиональные компетенции", HeadingLevel.HEADING_2),
    ...linesOrBlank(
      course.competencies.nodes.map((node) =>
        [node.laborFunctionCode, node.name].filter(Boolean).join(" "),
      ),
      "Код трудовой функции заполняет методист по профстандарту.",
    ),
    mark("1.6. Требования к слушателям", HeadingLevel.HEADING_2),
    paragraph(brief.audience || "____________________"),
    mark("1.7. Форма обучения", HeadingLevel.HEADING_2),
    paragraph(FORMAT_LABELS[brief.format]),
    mark("1.8. Объём программы", HeadingLevel.HEADING_2),
    paragraph(`${hours(brief.durationHours)} академических часов.`),
    paragraph(
      `Контактная работа учитывается по учебному плану. Итоговая аттестация: ${hours(brief.attestationHours)} ч.`,
    ),
    mark("1.9. Выдаваемый документ", HeadingLevel.HEADING_2),
    paragraph(brief.attestationForm || "____________________"),
  ];
}

function basisLines(course: CourseDocument) {
  const documents = new Map<string, LegalDocument | { title: string; source?: string; note?: string }>();
  for (const document of requiredLegalBasis(course.brief.programKind)) {
    documents.set(document.source, document);
  }
  for (const reference of course.brief.references) {
    const key = reference.source || reference.title;
    if (!documents.has(key)) documents.set(key, reference);
  }
  const lines = [...documents.values()].map((document) => {
    const source = "source" in document ? document.source : undefined;
    const pending = /^https?:\/\//i.test(source?.trim() ?? "");
    return [document.title, source, document.note, pending ? "не подтверждён" : ""]
      .filter(Boolean)
      .join(" · ");
  });
  return linesOrBlank(lines, "Нормативное основание не указано.");
}

function competencyTable(course: CourseDocument) {
  const rows = course.competencies.nodes.map((node) => [
    node.name,
    node.laborFunctionCode || "—",
    node.abilities.join("; ") || "—",
    node.skills.join("; ") || "—",
    node.knowledge.join("; ") || "—",
  ]);
  return table(
    ["Компетенция", "Трудовая функция", "Практический опыт", "Умения", "Знания"],
    rows.length ? rows : [["—", "—", "—", "—", "—"]],
  );
}

function studyPlan(course: CourseDocument) {
  const { brief } = course;
  const rows = course.modules.map((courseModule, index) => [
    String(index + 1),
    courseModule.title,
    hours(courseModule.hours),
    hours(courseModule.lectureHours),
    hours(courseModule.practiceHours),
    hours(courseModule.labHours),
    hours(courseModule.selfStudyHours),
    "—",
  ]);
  rows.push([
    "",
    "Итоговая аттестация",
    hours(brief.attestationHours),
    "0",
    "0",
    "0",
    "0",
    brief.attestationForm || "—",
  ]);
  rows.push([
    "",
    "Итого",
    hours(
      course.modules.reduce((total, courseModule) => total + courseModule.hours, 0) +
        brief.attestationHours,
    ),
    hours(kindSum(course.modules, "lectureHours")),
    hours(kindSum(course.modules, "practiceHours")),
    hours(kindSum(course.modules, "labHours")),
    hours(kindSum(course.modules, "selfStudyHours")),
    "",
  ]);
  return table(["№", "Наименование", "Всего", "ЛК", "ПР", "ЛБ", "СРС", "Форма контроля"], rows);
}

function thematicPlan(
  course: CourseDocument,
  mark: (text: string, heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel]) => Paragraph,
) {
  if (course.modules.length === 0) return [paragraph("Модули не заполнены.")];
  return course.modules.flatMap((courseModule, index) => {
    const topicRows = courseModule.plan.length
      ? courseModule.plan.map((row, topicIndex) => [
          `${index + 1}.${topicIndex + 1}`,
          row.title,
          hours(row.lectureHours + row.practiceHours + row.labHours + row.selfStudyHours),
          hours(row.lectureHours),
          hours(row.practiceHours),
          hours(row.labHours),
          hours(row.selfStudyHours),
        ])
      : courseModule.topics.map((topic, topicIndex) => [
          `${index + 1}.${topicIndex + 1}`,
          topic,
          "—",
          "—",
          "—",
          "—",
          "—",
        ]);
    return [
      mark(`${index + 1}. ${courseModule.title}`, HeadingLevel.HEADING_3),
      table(["№", "Тема", "Всего", "ЛК", "ПР", "ЛБ", "СРС"], topicRows),
      paragraph("Результаты обучения"),
      ...courseModule.learningOutcomes.map(bullet),
    ];
  });
}

function assessmentAppendix(
  course: CourseDocument,
  mark: (text: string, heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel]) => Paragraph,
) {
  const blocks: Block[] = [mark("Приложение 1. Оценочные материалы", HeadingLevel.HEADING_1)];
  const questions = course.assessments.flatMap((assessment) =>
    assessment.questions.map((question) => ({ ...question, moduleId: assessment.moduleId })),
  );
  if (questions.length === 0) {
    blocks.push(paragraph("Вопросы заполняются после утверждения каркаса."));
  }
  questions.forEach((question, index) => {
    blocks.push(paragraph(`${index + 1}. ${question.stem}`));
    blocks.push(paragraph(`Модуль: ${moduleTitle(course, question.moduleId)}`));
    if (question.options?.length) blocks.push(...question.options.map(bullet));
    blocks.push(paragraph(`Ключ: ${question.answer}`));
    blocks.push(paragraph(`Результат обучения: ${question.learningOutcome}`));
  });

  blocks.push(mark("Приложение 2. Практические задания", HeadingLevel.HEADING_1));
  const tasks = course.seminars.flatMap((seminar) =>
    seminar.tasks.map((task) => ({ ...task, moduleId: seminar.moduleId })),
  );
  if (tasks.length === 0) {
    blocks.push(paragraph("Задания заполняются после утверждения каркаса."));
  }
  for (const task of tasks) {
    blocks.push(paragraph(`${task.title} · ${task.timeMin} мин`, HeadingLevel.HEADING_2));
    blocks.push(paragraph(`Модуль: ${moduleTitle(course, task.moduleId)}`));
    blocks.push(paragraph(task.prompt));
    blocks.push(...task.steps.map((step, index) => paragraph(`${index + 1}. ${step}`)));
    blocks.push(paragraph("Критерии"));
    blocks.push(...task.criteria.map(bullet));
    if (task.learningOutcome) blocks.push(paragraph(`Результат обучения: ${task.learningOutcome}`));
  }
  return blocks;
}

function conditions(
  course: CourseDocument,
  mark: (text: string, heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel]) => Paragraph,
) {
  const staffRows = [
    ...course.modules.map((courseModule, index) => [
      String(index + 1),
      courseModule.title,
      "____________________",
      "____________________",
      "____________________",
    ]),
    ["", "Итоговая аттестация", "____________________", "____________________", "____________________"],
  ];
  return [
    mark("3. Организационно-педагогические условия", HeadingLevel.HEADING_1),
    mark("3.1. Материально-техническое обеспечение", HeadingLevel.HEADING_2),
    ...linesOrBlank(
      course.brief.constraints,
      "Материально-технические условия заполняет методист: ____________________",
    ),
    mark("3.2. Учебно-методическое и информационное обеспечение", HeadingLevel.HEADING_2),
    mark("3.2.1. Нормативно-правовые документы", HeadingLevel.HEADING_3),
    ...basisLines(course),
    mark("3.4. Кадровое обеспечение", HeadingLevel.HEADING_2),
    paragraph("ФИО, учёную степень и должность преподавателя заполняет методист."),
    table(["№", "Модуль", "ФИО", "Учёная степень, звание", "Должность"], staffRows),
    paragraph("Разработчик программы: ____________________"),
    paragraph("Подпись: ____________________"),
    paragraph("Дата: «___» __________ ______ г."),
  ];
}

export function buildCourseDocx(course: CourseDocument) {
  const { children } = composeCourseDocx(course);
  return new Document({
    creator: "Студия методиста",
    title: course.brief.title,
    description: "Проект образовательной программы по структуре примеров АЦР",
    styles: {
      default: {
        document: {
          run: { font: "Times New Roman", size: 24 },
        },
      },
    },
    sections: [{ properties: {}, children }],
  });
}

export async function exportCourseDocx(course: CourseDocument) {
  const blob = await Packer.toBlob(buildCourseDocx(course));
  triggerBrowserDownload(`${slug(course.brief.title)}.docx`, blob);
}

export async function exportSeminarDocx(course: CourseDocument, moduleId: string) {
  const seminar = course.seminars.find((item) => item.moduleId === moduleId);
  if (!seminar) return;
  const title = moduleTitle(course, moduleId);
  const children: Block[] = [
    paragraph(course.brief.title || "Программа", HeadingLevel.HEADING_1),
    paragraph(title, HeadingLevel.HEADING_2),
    paragraph("Практическое занятие"),
  ];
  for (const task of seminar.tasks) {
    children.push(paragraph(task.title, HeadingLevel.HEADING_3));
    children.push(paragraph(`${task.timeMin} мин`));
    children.push(paragraph(task.prompt));
    if (task.learningOutcome) children.push(paragraph(`Результат: ${task.learningOutcome}`));
    children.push(paragraph("Ход работы"));
    task.steps.forEach((step) => children.push(bullet(step)));
    children.push(paragraph("Критерии"));
    task.criteria.forEach((item) => children.push(bullet(item)));
  }
  const docxFile = new Document({
    creator: "Студия методиста",
    title,
    styles: {
      default: {
        document: {
          run: { font: "Times New Roman", size: 24 },
        },
      },
    },
    sections: [{ properties: {}, children }],
  });
  const blob = await Packer.toBlob(docxFile);
  triggerBrowserDownload(`${slug(title)}-семинар.docx`, blob);
}

export async function exportAssessmentDocx(course: CourseDocument, moduleId: string) {
  const assessment = course.assessments.find((item) => item.moduleId === moduleId);
  if (!assessment) return;
  const title = moduleTitle(course, moduleId);
  const children: Block[] = [
    paragraph(course.brief.title || "Программа", HeadingLevel.HEADING_1),
    paragraph(title, HeadingLevel.HEADING_2),
    paragraph("Проверочная работа"),
  ];
  assessment.questions.forEach((question, index) => {
    children.push(paragraph(`${index + 1}. ${question.stem}`, HeadingLevel.HEADING_3));
    if (question.options?.length) {
      question.options.forEach((option) => children.push(bullet(option)));
    }
    children.push(paragraph(`Ключ: ${question.answer}`));
    if (question.explanation) children.push(paragraph(question.explanation));
    if (question.learningOutcome) children.push(paragraph(`Результат: ${question.learningOutcome}`));
  });
  const docxFile = new Document({
    creator: "Студия методиста",
    title,
    styles: {
      default: {
        document: {
          run: { font: "Times New Roman", size: 24 },
        },
      },
    },
    sections: [{ properties: {}, children }],
  });
  const blob = await Packer.toBlob(docxFile);
  triggerBrowserDownload(`${slug(title)}-тест.docx`, blob);
}
