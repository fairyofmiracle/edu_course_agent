import { inventedRequisites, laborCodes } from "@/lib/claims";
import type { CourseDocument } from "@/lib/course-schema";
import { frameworkItems } from "@/lib/framework-check";
import { ORDER_266, citesRepealedOrder499, isOfficialPublication, missingLegalBasis } from "@/lib/legal-basis";
import { moduleRationales } from "@/lib/module-rationale";
import { findOutdated } from "@/lib/outdated";
import { meaningHits } from "@/lib/meaning-audit";
import { referenceNotes, verbatimSpans } from "@/lib/verbatim";

export type AuditStatus = "pass" | "warning" | "fail" | "disabled";
export type AuditSection = "framework" | "content" | "sources" | "freshness" | "case" | "meaning";
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

function unconfirmedItem(course: CourseDocument): AuditItem | null {
  const pending = course.brief.references
    .filter((reference) => {
      const source = reference.source?.trim() ?? "";
      if (!source) return true;
      return /^https?:\/\//i.test(source) && !isOfficialPublication(source);
    })
    .map((reference) => reference.title);
  if (course.brief.references.length === 0) return null;
  if (pending.length === 0) {
    return item("sources.unconfirmed", "Официальные публикации и файлы на месте", true, "sources");
  }
  return warning(
    "sources.unconfirmed",
    `Не подтверждено источников: ${pending.length}`,
    "sources",
    `Чужая ссылка не подтверждает документ, пока на странице не найден номер. ${pending.join("; ")}`,
  );
}

function verbatimItem(course: CourseDocument): AuditItem | null {
  if (course.brief.references.length === 0) return null;
  const notes = referenceNotes(course).trim();
  if (notes.split(/\s+/).length < 12) {
    return warning(
      "sources.verbatim",
      "Дословное копирование не с чем сравнить: в референсе нет связного текста",
      "sources",
    );
  }
  const hits = verbatimSpans(course);
  return hits.length
    ? item(
        "sources.verbatim",
        "В комплекте есть дословный фрагмент референса",
        false,
        "sources",
        hits[0],
      )
    : item(
        "sources.verbatim",
        "Дословных фрагментов референса в комплекте нет",
        true,
        "sources",
      );
}

function moduleOutcomes(course: CourseDocument, moduleId: string) {
  return new Set(
    course.modules
      .find((module) => module.id === moduleId)
      ?.learningOutcomes.map((outcome) => outcome.trim()) ?? [],
  );
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
    const needsLecture = courseModule.lectureHours > 0;
    const hasLecture = course.lectures.some((entry) => entry.moduleId === courseModule.id);
    const hasSeminar = course.seminars.some((entry) => entry.moduleId === courseModule.id);
    const hasAssessment = course.assessments.some((entry) => entry.moduleId === courseModule.id);
    const missing = [
      hasLecture || !needsLecture ? "" : "нет лекции",
      hasSeminar ? "" : "нет задания",
      hasAssessment ? "" : "нет теста",
    ].filter(Boolean);
    const complete = missing.length === 0;
    const partial = hasLecture || hasSeminar || hasAssessment;
    items.push({
      id: `content.${courseModule.id}`,
      label: `${courseModule.title}: лекция, практическое задание и тест`,
      status: complete ? "pass" : partial ? "warning" : "fail",
      section: "content",
      moduleId: courseModule.id,
      details: missing.join(", ") || undefined,
    });
  }

  for (const assessment of course.assessments) {
    const outcomes = moduleOutcomes(course, assessment.moduleId);
    for (const question of assessment.questions) {
      const outcome = question.learningOutcome?.trim() ?? "";
      const linked = outcomes.has(outcome);
      const hasAnswer = question.answer.trim().length > 0;
      if (!hasAnswer || !linked) {
        items.push(
          item(
            `question.${assessment.moduleId}.${outcome || "missing"}`,
            `Вопрос «${question.stem}» имеет ключ и результат обучения`,
            false,
            "content",
            [
              hasAnswer ? "" : "нет ключа",
              linked ? "" : "результат не найден в модуле",
            ]
              .filter(Boolean)
              .join(", "),
          ),
        );
      }
    }
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

  const outdated = findOutdated(course);
  if (course.modules.length > 0 && outdated.length === 0) {
    items.push(
      item(
        "freshness.clear",
        "В темах и результатах нет инструментов из списка снятых с поддержки",
        true,
        "freshness",
        "Список короткий: Flash, Internet Explorer, Windows XP, Python 2, AngularJS, CentOS 6/7, TensorFlow 1, Silverlight. Он не заменяет решение методиста.",
      ),
    );
  }
  for (const document of missingLegalBasis(course)) {
    items.push(
      item(
        `basis.${document.id}`,
        `Нет обязательного источника: ${document.title}`,
        false,
        "sources",
        document.source,
      ),
    );
  }
  if (course.brief.programKind === "qualification") {
    items.push(
      warning(
        "basis.order-499",
        "Приказ № 499 утратил силу с 01.09.2025",
        "freshness",
        citesRepealedOrder499(course)
          ? `Он указан в источниках. Действующий порядок — ${ORDER_266.title}: ${ORDER_266.source}. Методист подтверждает, какой документ ставить в программу.`
          : `В требовании он назван основанием программ повышения квалификации. Действующий порядок — ${ORDER_266.title}: ${ORDER_266.source}. Методист подтверждает применимость.`,
      ),
    );
  }
  if (course.brief.programKind === "qualification" && course.competencies.nodes.length > 0) {
    const withoutCode = course.competencies.nodes.filter((node) => !node.laborFunctionCode?.trim());
    if (withoutCode.length > 0) {
      items.push(
        warning(
          "basis.labor-codes",
          "У компетенций повышения квалификации нет кода трудовой функции",
          "sources",
          `${withoutCode.map((node) => node.id).join(", ")}. Код берётся из профстандарта методиста и не придумывается.`,
        ),
      );
    }
  }

  for (const hit of outdated) {
    items.push(
      warning(
        `freshness.${hit.id}.${hit.place}`,
        `Устаревший инструмент: ${hit.label}`,
        "freshness",
        `${hit.place}. ${hit.note}`,
      ),
    );
  }

  for (const row of moduleRationales(course)) {
    items.push(
      item(
        `framework.why.${row.id}`,
        "Модуль обоснован часами и результатами",
        true,
        "framework",
        row.text,
      ),
    );
  }
  items.push(
    item(
      "framework.passport",
      "Паспорт результата считает код, формулировки модели в него не входят",
      true,
      "framework",
      "Считает вид программы, часы и состав модулей. Текст лекции в этот расчёт не входит.",
    ),
  );

  const calendarLine = course.brief.constraints.find((line) => /календарн/i.test(line));
  if (course.brief.durationHours > 0) {
    items.push(
      calendarLine
        ? item("framework.calendar", "Календарный график указан", true, "framework", calendarLine)
        : warning(
            "framework.calendar",
            "Календарный график не указан",
            "framework",
            "Срок и нагрузка пишутся в условиях программы, не выдумываются.",
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
  const pendingSources = unconfirmedItem(course);
  if (pendingSources) items.push(pendingSources);
  const copiedText = verbatimItem(course);
  if (copiedText) items.push(copiedText);

  const codes = laborCodes(course);
  const invented = inventedRequisites(course);
  if (codes.length > 0) {
    const grounded = codes.every((code) => !invented.includes(code));
    items.push(
      item(
        "sources.codes",
        grounded
          ? "Код трудовой функции есть в тексте методиста"
          : "Код трудовой функции не найден в источниках методиста",
        grounded,
        "sources",
        codes.join(", "),
      ),
    );
  }
  items.push(
    item(
      "sources.requisites",
      invented.length === 0
        ? "Выдуманных номеров и кодов в комплекте нет"
        : "В комплекте есть реквизит, которого нет у методиста",
      invented.length === 0,
      "sources",
      invented.length > 0
        ? invented.join(", ")
        : "Номер приказа и код трудовой функции сверяются с файлом и условиями запроса.",
    ),
  );

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
      item("case.1.questions", "Итоговый тест содержит не меньше 10 вопросов", totalQuestions >= 10, "case"),
      item(
        "case.1.calendar",
        "График 8 занятий по 2 часа за 4 недели",
        /8 занят/.test(text) && /4 недел/.test(text),
        "case",
        course.brief.constraints.find((line) => /календарн/i.test(line)),
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
      {
        ...(verbatimItem(course) ??
          warning(
            "sources.verbatim",
            "Дословное копирование не с чем сравнить: в референсе нет связного текста",
            "sources",
          )),
        id: "case.3.copy",
        section: "case",
      },
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
    item(
      "case.5.calendar",
      "Нагрузка не больше 4 часов в день",
      /4 ч/.test(text) && /день/.test(text),
      "case",
      course.brief.constraints.find((line) => /календарн|4 ч/i.test(line)),
    ),
  ];
}

export function methodistNotes(course: CourseDocument): string[] {
  const text = allText(course);
  const notes: string[] = [];
  const calendar = course.brief.constraints.find((line) => /календарн/i.test(line));
  if (calendar) notes.push(calendar);
  if (/пойти работать|работать в эту сферу/.test(text)) {
    notes.push(
      "Пожелание заказчика «пойти работать в сферу» шире объёма курса. Результаты — начальный уровень, без обещания трудоустройства.",
    );
  }
  if (/стажиров|аудиторных нет/.test(text)) {
    notes.push("Если в образце итоговая строка часов не сходится, ошибку не переносим.");
  }
  if (/приложен|образец|референс/.test(text) && /pandas|анализ данных|sql/.test(text)) {
    notes.push("Старую программу используем как каркас разделов, текст и часы пишем заново.");
  }
  return listUnique(notes);
}

function listUnique(values: string[]): string[] {
  return [...new Set(values)];
}


function meaningItems(course: CourseDocument): AuditItem[] {
  const hits = meaningHits(course);
  const items: AuditItem[] = hits.map((hit) => ({
    id: hit.id,
    label: hit.label,
    status: hit.severity,
    section: "meaning",
    details: hit.details,
    moduleId: hit.moduleId,
  }));
  if (hits.length === 0) {
    items.push({
      id: "meaning.clear",
      label: "Пустых и шаблонных блоков не найдено",
      status: "pass",
      section: "meaning",
      details: "Детерминированный чеклист: пустое, шаблонные фразы, дубли.",
    });
  }
  items.push({
    id: "meaning.llm",
    label: "LLM-ревью смысла",
    status: "disabled",
    section: "meaning",
    details:
      "Опционально: кнопка «LLM-ревью» во вкладке Проверка. Без ключа шлюза — disabled, выгрузку не блокирует.",
  });
  return items;
}

export function auditCourse(course: CourseDocument, caseId?: OpenCaseId): CourseAudit {
  const items = [...genericItems(course), ...meaningItems(course), ...(caseId ? caseItems(course, caseId) : [])];
  const summary = items.reduce<Record<AuditStatus, number>>(
    (totals, entry) => {
      totals[entry.status] += 1;
      return totals;
    },
    { pass: 0, warning: 0, fail: 0, disabled: 0 },
  );
  return { caseId, summary, items };
}
