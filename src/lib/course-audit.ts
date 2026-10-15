import type { CourseDocument } from "@/lib/course-schema";
import { frameworkItems } from "@/lib/framework-check";

export type AuditStatus = "pass" | "warning" | "fail";
export type AuditSection = "framework" | "content" | "sources" | "case";
export type OpenCaseId = 1 | 2 | 3 | 4 | 5;

export type AuditItem = {
  id: string;
  label: string;
  status: AuditStatus;
  section: AuditSection;
  details?: string;
  moduleId?: string;
};

export type CourseAudit = {
  caseId?: OpenCaseId;
  summary: Record<AuditStatus, number>;
  items: AuditItem[];
};

const status = (ok: boolean): AuditStatus => (ok ? "pass" : "fail");
const normalized = (value: string) => value.toLocaleLowerCase("ru-RU").replaceAll("ё", "е");
const allText = (course: CourseDocument) =>
  normalized(
    [
      course.brief.title,
      course.brief.audience,
      course.brief.attestationForm,
      ...course.brief.goals,
      ...course.brief.constraints,
      ...course.modules.flatMap((module) => [
        module.title,
        ...module.topics,
        ...module.plan.map((row) => row.title),
        ...module.learningOutcomes,
      ]),
    ].join("\n"),
  );

function item(
  id: string,
  label: string,
  ok: boolean,
  section: AuditSection,
  details?: string,
): AuditItem {
  return { id, label, status: status(ok), section, details };
}

function warning(id: string, label: string, section: AuditSection, details?: string): AuditItem {
  return { id, label, status: "warning", section, details };
}

function questionOutcomes(course: CourseDocument, moduleId: string) {
  return new Set(
    course.assessments
      .filter((assessment) => assessment.moduleId === moduleId)
      .flatMap((assessment) =>
        assessment.questions.map((question) => question.learningOutcome?.trim()).filter(Boolean),
      ),
  );
}

function taskOutcomes(course: CourseDocument, moduleId: string) {
  return new Set(
    course.seminars
      .filter((seminar) => seminar.moduleId === moduleId)
      .flatMap((seminar) =>
        seminar.tasks.map((task) => task.learningOutcome?.trim()).filter(Boolean),
      ),
  );
}

export function outcomeInstrumentGaps(course: CourseDocument) {
  return course.modules.flatMap((module) => {
    const questions = questionOutcomes(course, module.id);
    const tasks = taskOutcomes(course, module.id);
    return module.learningOutcomes.flatMap((outcome) => {
      const missing = [
        !questions.has(outcome) ? "тест" : "",
        !tasks.has(outcome) ? "практическое задание" : "",
      ].filter(Boolean);
      return missing.length
        ? [{ moduleId: module.id, outcome, missing }]
        : [];
    });
  });
}

function genericItems(course: CourseDocument): AuditItem[] {
  const items: AuditItem[] = frameworkItems(course).map((check) => ({
    id: `framework.${check.id}`,
    label: check.label,
    status: status(check.ok),
    section: "framework",
  }));

  for (const courseModule of course.modules) {
    const hasLecture = course.lectures.some((entry) => entry.moduleId === courseModule.id);
    const hasSeminar = course.seminars.some((entry) => entry.moduleId === courseModule.id);
    const hasAssessment = course.assessments.some((entry) => entry.moduleId === courseModule.id);
    items.push({
      id: `content.${courseModule.id}`,
      label: `${courseModule.title}: лекция, практическое задание и тест`,
      status: status(hasLecture && hasSeminar && hasAssessment),
      section: "content",
      moduleId: courseModule.id,
      details: [
        hasLecture ? "" : "нет лекции",
        hasSeminar ? "" : "нет задания",
        hasAssessment ? "" : "нет теста",
      ]
        .filter(Boolean)
        .join(", ") || undefined,
    });
  }

  for (const gap of outcomeInstrumentGaps(course)) {
    items.push({
      id: `outcome.${gap.moduleId}.${gap.outcome}`,
      label: `Результат «${gap.outcome}» проверяется двумя способами`,
      status: "fail",
      section: "content",
      moduleId: gap.moduleId,
      details: `Не хватает: ${gap.missing.join(" и ")}`,
    });
  }
  const outcomeCount = course.modules.reduce(
    (total, module) => total + module.learningOutcomes.length,
    0,
  );
  if (outcomeCount > 0 && outcomeInstrumentGaps(course).length === 0) {
    items.push(
      item(
        "outcomes.coverage",
        "Каждый результат обучения проверяется тестом и практическим заданием",
        true,
        "content",
      ),
    );
  }

  items.push(
    course.brief.references.length > 0
      ? item("sources.present", "Источники и референсы указаны", true, "sources")
      : warning(
          "sources.present",
          "Источники и референсы не указаны",
          "sources",
          "Нормативные документы нельзя добавлять без файла или проверяемой ссылки.",
        ),
  );

  const laborCodes = course.competencies.nodes
    .map((node) => node.laborFunctionCode?.trim())
    .filter(Boolean);
  if (laborCodes.length > 0) {
    items.push(
      course.brief.references.length > 0
        ? warning(
            "sources.codes",
            "Коды трудовых функций требуют ручной сверки с приложенным профстандартом",
            "sources",
            laborCodes.join(", "),
          )
        : item(
            "sources.codes",
            "Коды трудовых функций указаны без источника",
            false,
            "sources",
            laborCodes.join(", "),
          ),
    );
  }

  return items;
}

function caseItems(course: CourseDocument, caseId: OpenCaseId): AuditItem[] {
  const text = allText(course);
  const totalQuestions = course.assessments.reduce(
    (total, assessment) => total + assessment.questions.length,
    0,
  );
  const totals = course.modules.reduce(
    (sum, module) => ({
      lecture: sum.lecture + module.lectureHours,
      practice: sum.practice + module.practiceHours,
      lab: sum.lab + module.labHours,
      selfStudy: sum.selfStudy + module.selfStudyHours,
    }),
    { lecture: 0, practice: 0, lab: 0, selfStudy: 0 },
  );
  const has = (...words: string[]) => words.every((word) => text.includes(normalized(word)));

  if (caseId === 1) {
    return [
      item("case.1.kind", "Выбран общеразвивающий шаблон", course.brief.programKind === "general", "case"),
      item("case.1.hours", "Объём программы — 16 часов", course.brief.durationHours === 16, "case"),
      item("case.1.practice", "Практики не меньше 8 часов", totals.practice >= 8, "case"),
      item("case.1.questions", "Итоговый тест содержит 10 вопросов", totalQuestions === 10, "case"),
      warning(
        "case.1.calendar",
        "График 8 × 2 часа за 4 недели проверяется вручную",
        "case",
        "В текущей модели данных нет календарного графика.",
      ),
    ];
  }

  if (caseId === 2) {
    return [
      item("case.2.kind", "Выбран шаблон повышения квалификации", course.brief.programKind === "qualification", "case"),
      item("case.2.hours", "Объём программы — 36 часов", course.brief.durationHours === 36, "case"),
      item("case.2.portfolio", "Аттестация — портфолио", normalized(course.brief.attestationForm).includes("портфолио"), "case"),
      item("case.2.risks", "Есть тема о рисках и защите данных", has("риск") && (has("персональн") || has("данн")), "case"),
      warning(
        "case.2.services",
        "Доступность упомянутых сервисов в России проверяется вручную",
        "case",
      ),
    ];
  }

  if (caseId === 3) {
    const pandasLecture = course.lectures.some((lecture) => {
      const courseModule = course.modules.find((entry) => entry.id === lecture.moduleId);
      return normalized(courseModule?.title ?? "").includes("pandas");
    });
    return [
      item("case.3.hours", "Объём программы — 72 часа", course.brief.durationHours === 72, "case"),
      item("case.3.python", "Есть вводный блок по Python", has("python"), "case"),
      item("case.3.topics", "Есть pandas, визуализация, SQL и статистика", has("pandas", "визуализац", "sql", "статист"), "case"),
      item("case.3.slides", "Есть слайды для модуля pandas", pandasLecture, "case"),
      warning(
        "case.3.copy",
        "Отсутствие дословного копирования проверяется после генерации",
        "case",
      ),
    ];
  }

  if (caseId === 4) {
    return [
      item("case.4.kind", "После уточнений выбран шаблон повышения квалификации", course.brief.programKind === "qualification", "case"),
      item("case.4.hours", "После уточнений задано ровно 72 часа", course.brief.durationHours === 72, "case"),
      item("case.4.audience", "Указан входной уровень студентов колледжа", /колледж|3 курс|сет|linux/.test(text), "case"),
      item("case.4.exam", "Аттестация — практический экзамен", /экзамен|практическ/.test(normalized(course.brief.attestationForm)), "case"),
      warning(
        "case.4.questions",
        "Не больше пяти уточняющих вопросов проверяется по протоколу прогона",
        "case",
      ),
    ];
  }

  return [
    item("case.5.kind", "Выбран шаблон повышения квалификации", course.brief.programKind === "qualification", "case"),
    item("case.5.hours", "Объём программы — 256 часов", course.brief.durationHours === 256, "case"),
    item("case.5.attestation", "Итоговая аттестация занимает 2 часа", course.brief.attestationHours === 2, "case"),
    item("case.5.self", "Самостоятельная работа занимает 254 часа", totals.selfStudy === 254, "case"),
    item("case.5.zero", "Лекции, практика и лабораторные равны нулю", totals.lecture === 0 && totals.practice === 0 && totals.lab === 0, "case"),
    item("case.5.topics", "Темы покрывают Linux, сети, контейнеры, CI/CD, мониторинг и IaC", has("linux", "сет", "контейнер", "ci/cd", "мониторинг") && (/iac|инфраструктур/.test(text)), "case"),
    warning(
      "case.5.calendar",
      "Нагрузка не больше 4 часов в день проверяется вручную",
      "case",
      "В текущей модели данных нет календарного графика.",
    ),
  ];
}

export function auditCourse(course: CourseDocument, caseId?: OpenCaseId): CourseAudit {
  const items = [...genericItems(course), ...(caseId ? caseItems(course, caseId) : [])];
  const summary = items.reduce<Record<AuditStatus, number>>(
    (totals, entry) => {
      totals[entry.status] += 1;
      return totals;
    },
    { pass: 0, warning: 0, fail: 0 },
  );
  return { caseId, summary, items };
}
