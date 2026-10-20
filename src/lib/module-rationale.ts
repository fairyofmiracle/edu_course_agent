import type { CourseDocument } from "@/lib/course-schema";

function hoursLabel(value: number) {
  const rounded = Math.round(value * 2) / 2;
  return String(rounded).replace(".", ",");
}

function planFlag(module: CourseDocument["modules"][number]) {
  if (module.plan.length === 0) return "0";
  const totals = module.plan.reduce(
    (sum, row) => ({
      lectureHours: sum.lectureHours + row.lectureHours,
      practiceHours: sum.practiceHours + row.practiceHours,
      labHours: sum.labHours + row.labHours,
      selfStudyHours: sum.selfStudyHours + row.selfStudyHours,
    }),
    { lectureHours: 0, practiceHours: 0, labHours: 0, selfStudyHours: 0 },
  );
  const close = (left: number, right: number) => Math.abs(left - right) < 0.001;
  return close(totals.lectureHours, module.lectureHours) &&
    close(totals.practiceHours, module.practiceHours) &&
    close(totals.labHours, module.labHours) &&
    close(totals.selfStudyHours, module.selfStudyHours)
    ? "1"
    : "0";
}

/** FNV-1a, 32 бита. Тот же штамп, что считает backend. */
export function passportStamp(text: string) {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function moduleRationales(course: CourseDocument) {
  const questions = new Map<string, Set<string>>();
  for (const assessment of course.assessments) {
    const known = questions.get(assessment.moduleId) ?? new Set<string>();
    for (const question of assessment.questions) {
      const outcome = question.learningOutcome?.trim();
      if (outcome) known.add(outcome);
    }
    questions.set(assessment.moduleId, known);
  }
  const tasks = new Map<string, Set<string>>();
  for (const seminar of course.seminars) {
    const known = tasks.get(seminar.moduleId) ?? new Set<string>();
    for (const task of seminar.tasks) {
      const outcome = task.learningOutcome?.trim();
      if (outcome) known.add(outcome);
    }
    tasks.set(seminar.moduleId, known);
  }

  return course.modules.map((module) => {
    const covered = module.learningOutcomes.map((outcome) => {
      const hasQuestion = questions.get(module.id)?.has(outcome) ?? false;
      const hasTask = tasks.get(module.id)?.has(outcome) ?? false;
      if (hasQuestion && hasTask) return `«${outcome}» закрыт тестом и заданием`;
      const missing = [hasQuestion ? "" : "тест", hasTask ? "" : "задание"].filter(Boolean);
      return `«${outcome}»: не хватает ${missing.join(" и ")}`;
    });
    const text = [
      `«${module.title}»: ${hoursLabel(module.hours)} ч`,
      `(лекции ${hoursLabel(module.lectureHours)}, практика ${hoursLabel(module.practiceHours)}, лабораторные ${hoursLabel(module.labHours)}, самостоятельная работа ${hoursLabel(module.selfStudyHours)}).`,
      `Объём ${hoursLabel(course.brief.durationHours)} ч задал методист.`,
      covered.length ? covered.join("; ") + "." : "Результаты задаёт каркас.",
    ].join(" ");
    return { id: module.id, text };
  });
}

/** Вид, часы и штамп. Формулировки модели сюда не входят. */
export function resultPassport(course: CourseDocument) {
  const brief = course.brief;
  const modules = course.modules.map((module) =>
    [
      module.id,
      hoursLabel(module.hours),
      hoursLabel(module.lectureHours),
      hoursLabel(module.practiceHours),
      hoursLabel(module.labHours),
      hoursLabel(module.selfStudyHours),
      String(module.learningOutcomes.length),
      planFlag(module),
    ].join(":"),
  );
  const body = [
    `вид=${brief.programKind}`,
    `объём=${hoursLabel(brief.durationHours)}`,
    `аттестация=${hoursLabel(brief.attestationHours)}`,
    `форма=${brief.format}`,
    `модули=${modules.join(";")}`,
  ].join(" | ");
  return `${body} | штамп=${passportStamp(body)}`;
}
