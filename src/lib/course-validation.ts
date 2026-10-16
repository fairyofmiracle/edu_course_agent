import type { CourseDocument } from "./course-schema";

export function validateCourseHours(course: CourseDocument): string[] {
  const errors: string[] = [];
  const { durationHours, attestationHours } = course.brief;

  if (!Number.isInteger(durationHours) || durationHours < 16 || durationHours > 500) {
    errors.push("Общая продолжительность должна быть от 16 до 500 целых часов.");
  }

  if (!Number.isInteger(attestationHours) || attestationHours < 0) {
    errors.push("Часы аттестации должны быть неотрицательным целым числом.");
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

    if (!Number.isInteger(courseModule.hours) || courseModule.hours <= 0) {
      errors.push(`Модуль "${courseModule.title}": некорректное количество часов.`);
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
