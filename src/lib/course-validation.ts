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

  for (const module of course.modules) {
    const kindsTotal =
      module.lectureHours +
      module.practiceHours +
      module.labHours +
      module.selfStudyHours;

    if (!Number.isInteger(module.hours) || module.hours <= 0) {
      errors.push(`Модуль "${module.title}": некорректное количество часов.`);
    }

    if (kindsTotal !== module.hours) {
      errors.push(
        `Модуль "${module.title}": виды занятий дают ` +
        `${kindsTotal} ч вместо ${module.hours} ч.`,
      );
    }

    if (module.plan.length === 0) {
      errors.push(`Модуль "${module.title}": отсутствует план тем.`);
      continue;
    }

    const topicTotal = module.plan.reduce(
      (sum, topic) =>
        sum +
        topic.lectureHours +
        topic.practiceHours +
        topic.labHours +
        topic.selfStudyHours,
      0,
    );

    if (topicTotal !== module.hours) {
      errors.push(
        `Модуль "${module.title}": сумма часов тем ` +
        `${topicTotal} ч вместо ${module.hours} ч.`,
      );
    }
  }

  return errors;
}
