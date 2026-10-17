import type { CourseDocument } from "./course-schema";

function isHalfHour(value: number) {
  return Number.isFinite(value) && Math.abs(value * 2 - Math.round(value * 2)) < 0.001;
}

export function validateCourseHours(course: CourseDocument): string[] {
  const errors: string[] = [];
  const { durationHours, attestationHours } = course.brief;

  if (!isHalfHour(durationHours) || durationHours < 16 || durationHours > 500) {
    errors.push("Общая продолжительность должна быть от 16 до 500 часов с шагом 0,5.");
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
