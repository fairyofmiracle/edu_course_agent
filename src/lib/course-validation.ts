import type { CourseDocument } from "./course-schema";

function isHalfHour(value: number) {
  return Number.isFinite(value) && Math.abs(value * 2 - Math.round(value * 2)) < 0.001;
}

function hourText(value: number) {
  return String(Math.round(value * 2) / 2).replace(".", ",");
}

export function briefGaps(course: CourseDocument): string[] {
  const gaps: string[] = [];
  if (!course.brief.audience.trim()) gaps.push("аудитория");
  if (course.brief.durationHours <= 0) gaps.push("часы");
  if (course.brief.programKind === "unset") gaps.push("шаблон");
  return gaps;
}

export function moduleKindsGap(module: CourseDocument["modules"][number]): string | null {
  const kinds =
    module.lectureHours + module.practiceHours + module.labHours + module.selfStudyHours;
  const delta = Math.round((module.hours - kinds) * 2) / 2;
  if (Math.abs(delta) < 0.001) return null;
  const amount = hourText(Math.abs(delta));
  const spread = `лекции ${hourText(module.lectureHours)}, практика ${hourText(module.practiceHours)}`;
  return delta > 0 ? `${spread}: не хватает ${amount} ч` : `${spread}: лишние ${amount} ч`;
}

export function programBalanceNote(course: CourseDocument): string | null {
  if (course.brief.durationHours <= 0 || course.modules.length === 0) return null;
  const learning = course.modules.reduce((sum, module) => sum + module.hours, 0);
  const total = Math.round((learning + course.brief.attestationHours) * 2) / 2;
  const delta = Math.round((course.brief.durationHours - total) * 2) / 2;
  if (Math.abs(delta) < 0.001) return null;
  const amount = hourText(Math.abs(delta));
  const attestation = hourText(course.brief.attestationHours);
  return delta > 0
    ? `Аттестация ${attestation} ч. До объёма не хватает ${amount} ч.`
    : `Аттестация ${attestation} ч. Сверх объёма ${amount} ч.`;
}

export function validateCourseHours(course: CourseDocument): string[] {
  const errors: string[] = [];
  const { durationHours, attestationHours } = course.brief;

  if (!isHalfHour(durationHours) || durationHours < 16) {
    errors.push("Общая продолжительность должна быть от 16 часов с шагом 0,5.");
  }

  if (!isHalfHour(attestationHours) || attestationHours < 0) {
    errors.push("Часы аттестации должны быть неотрицательными и кратны 0,5.");
  }

  if (attestationHours > durationHours) {
    errors.push("Аттестация не может превышать продолжительность курса.");
  }

  const learningHours = course.modules.reduce(
    (sum, module) => sum + module.hours,
    0,
  );

  if (learningHours + attestationHours !== durationHours) {
    errors.push(
      `Общий баланс: ${learningHours} ч обучения + ` +
      `${attestationHours} ч аттестации ≠ ${durationHours} ч.`,
    );
  }

  for (const courseModule of course.modules) {
    const kindsTotal =
      courseModule.lectureHours +
      courseModule.practiceHours +
      courseModule.labHours +
      courseModule.selfStudyHours;

    if (!isHalfHour(courseModule.hours) || courseModule.hours <= 0) {
      errors.push(`Модуль "${courseModule.title}": часы должны быть больше нуля и кратны 0,5.`);
    }

    if (kindsTotal !== courseModule.hours) {
      errors.push(
        `Модуль "${courseModule.title}": виды занятий дают ` +
        `${kindsTotal} ч вместо ${courseModule.hours} ч.`,
      );
    }

    if (courseModule.plan.length === 0) {
      errors.push(`Модуль "${courseModule.title}": отсутствует план тем.`);
      continue;
    }

    const topicTotal = courseModule.plan.reduce(
      (sum, topic) =>
        sum +
        topic.lectureHours +
        topic.practiceHours +
        topic.labHours +
        topic.selfStudyHours,
      0,
    );

    if (topicTotal !== courseModule.hours) {
      errors.push(
        `Модуль "${courseModule.title}": сумма часов тем ` +
        `${topicTotal} ч вместо ${courseModule.hours} ч.`,
      );
    }
  }

  return errors;
}
