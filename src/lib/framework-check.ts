import type { CourseDocument } from "@/lib/course-schema";
import { resultPassport } from "@/lib/module-rationale";

export type FrameworkItem = {
  id: string;
  label: string;
  ok: boolean;
};

function roundHours(value: number) {
  return Math.round(value * 2) / 2;
}

export function moduleHoursSum(course: CourseDocument) {
  return roundHours(course.modules.reduce((sum, module) => sum + module.hours, 0));
}

export function programHoursSum(course: CourseDocument) {
  return roundHours(moduleHoursSum(course) + course.brief.attestationHours);
}

function kindSum(parts: {
  lectureHours: number;
  practiceHours: number;
  labHours: number;
  selfStudyHours: number;
}) {
  return roundHours(
    parts.lectureHours + parts.practiceHours + parts.labHours + parts.selfStudyHours,
  );
}

export function frameworkFingerprint(course: CourseDocument) {
  return JSON.stringify({
    hours: course.brief.durationHours,
    programKind: course.brief.programKind,
    attestationHours: course.brief.attestationHours,
    modules: course.modules.map((module) => ({
      id: module.id,
      hours: module.hours,
      lectureHours: module.lectureHours,
      practiceHours: module.practiceHours,
      labHours: module.labHours,
      selfStudyHours: module.selfStudyHours,
      competencyIds: [...module.competencyIds].sort(),
    })),
    nodes: course.competencies.nodes.map((node) => ({
      id: node.id,
      moduleIds: [...node.moduleIds].sort(),
    })),
    passport: resultPassport(course),
  });
}

export function frameworkItems(course: CourseDocument): FrameworkItem[] {
  const competencyIds = new Set(course.competencies.nodes.map((node) => node.id));
  const usedIds = new Set(course.modules.flatMap((module) => module.competencyIds));
  const unknown = course.modules.flatMap((module) =>
    module.competencyIds.filter((id) => !competencyIds.has(id)),
  );
  const uncovered = course.competencies.nodes.filter((node) => !usedIds.has(node.id));
  const sum = programHoursSum(course);
  const target = course.brief.durationHours;
  const kindsMatch = course.modules.every(
    (module) => Math.abs(kindSum(module) - module.hours) < 0.001,
  );
  const planMatch = course.modules.every((module) => {
    if (module.plan.length === 0) return false;
    const plan = module.plan.reduce(
      (total, row) => ({
        lectureHours: total.lectureHours + row.lectureHours,
        practiceHours: total.practiceHours + row.practiceHours,
        labHours: total.labHours + row.labHours,
        selfStudyHours: total.selfStudyHours + row.selfStudyHours,
      }),
      { lectureHours: 0, practiceHours: 0, labHours: 0, selfStudyHours: 0 },
    );
    return (
      Math.abs(plan.lectureHours - module.lectureHours) < 0.001 &&
      Math.abs(plan.practiceHours - module.practiceHours) < 0.001 &&
      Math.abs(plan.labHours - module.labHours) < 0.001 &&
      Math.abs(plan.selfStudyHours - module.selfStudyHours) < 0.001
    );
  });
  const zunOk = course.competencies.nodes.every(
    (node) => node.knowledge.length > 0 && node.skills.length > 0 && node.abilities.length > 0,
  );
  const hoursOk =
    course.modules.length > 0 &&
    target > 0 &&
    kindsMatch &&
    planMatch &&
    Math.abs(sum - target) < 0.001;

  return [
    {
      id: "template",
      label:
        course.brief.programKind === "qualification"
          ? "Шаблон: повышение квалификации"
          : course.brief.programKind === "general"
            ? "Шаблон: общеразвивающая программа"
            : "Выбран один из двух шаблонов АЦР",
      ok: course.brief.programKind !== "unset",
    },
    {
      id: "brief",
      label: "Есть название и аудитория",
      ok: Boolean(course.brief.title.trim() && course.brief.audience.trim()),
    },
    {
      id: "duration",
      label: "Задан объём программы",
      ok: target > 0,
    },
    {
      id: "competencies",
      label: zunOk
        ? "У компетенций есть знания, умения и навыки"
        : "У каждой компетенции нужны знания, умения и навыки",
      ok: course.competencies.nodes.length > 0 && zunOk,
    },
    {
      id: "modules",
      label: "Есть учебный план",
      ok: course.modules.length > 0,
    },
    {
      id: "hours",
      label: hoursOk
        ? `Часы сходятся: ${sum} из ${target} ч`
        : `Часы не сходятся: ${sum} из ${target || 0} ч`,
      ok: hoursOk,
    },
    {
      id: "links",
      label: uncovered.length
        ? `Вне модулей: ${uncovered.map((node) => node.id).join(", ")}`
        : "Каждая компетенция входит в модуль",
      ok: course.competencies.nodes.length > 0 && uncovered.length === 0,
    },
    {
      id: "known",
      label: unknown.length
        ? `Неизвестные компетенции: ${unknown.join(", ")}`
        : "Модули ссылаются только на существующие компетенции",
      ok: course.modules.length > 0 && unknown.length === 0,
    },
  ];
}

export function outcomeGaps(course: CourseDocument) {
  const linked = new Set(
    course.assessments.flatMap((assessment) =>
      assessment.questions.map((question) => question.learningOutcome?.trim() ?? ""),
    ),
  );
  linked.delete("");
  return course.modules.flatMap((module) =>
    module.learningOutcomes.filter((outcome) => !linked.has(outcome)),
  );
}

export function contentGaps(course: CourseDocument) {
  const checked = new Set(
    course.assessments.flatMap((assessment) =>
      assessment.questions.map((question) => question.competencyId),
    ),
  );
  return course.competencies.nodes
    .filter((node) => !checked.has(node.id))
    .map((node) => node.id);
}

export function hasBuiltMaterials(course: CourseDocument) {
  return course.lectures.length > 0 || course.seminars.length > 0 || course.assessments.length > 0;
}

export function isKitComplete(course: CourseDocument) {
  if (course.modules.length === 0) return false;
  return course.modules.every((module) => {
    const hasLecture =
      module.lectureHours <= 0 ||
      course.lectures.some((entry) => entry.moduleId === module.id);
    const hasSeminar = course.seminars.some((entry) => entry.moduleId === module.id);
    const hasAssessment = course.assessments.some((entry) => entry.moduleId === module.id);
    return hasLecture && hasSeminar && hasAssessment;
  });
}

export function isFrameworkApproved(course: CourseDocument) {
  return (
    course.frameworkApproved &&
    course.frameworkFingerprint === frameworkFingerprint(course) &&
    frameworkItems(course).every((item) => item.ok)
  );
}
