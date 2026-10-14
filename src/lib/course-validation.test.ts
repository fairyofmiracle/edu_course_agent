import { describe, expect, it } from "vitest";
import { createEmptyCourse } from "./course-schema";
import { validateCourseHours } from "./course-validation";

describe("Проверка учебных часов", () => {
  it("принимает правильную сумму часов", () => {
    const course = createEmptyCourse();

    course.brief.durationHours = 16;
    course.brief.attestationHours = 2;

    course.modules = [
      {
        id: "module-1",
        title: "Основы Python",
        hours: 14,
        lectureHours: 4,
        practiceHours: 8,
        labHours: 0,
        selfStudyHours: 2,
        topics: ["Введение в Python"],
        plan: [
          {
            title: "Введение в Python",
            lectureHours: 4,
            practiceHours: 8,
            labHours: 0,
            selfStudyHours: 2,
          },
        ],
        learningOutcomes: ["Пишет простые программы на Python"],
        competencyIds: [],
      },
    ];

    expect(validateCourseHours(course)).toEqual([]);
  });

  it("обнаруживает неверную сумму часов", () => {
    const course = createEmptyCourse();

    course.brief.durationHours = 16;
    course.brief.attestationHours = 2;

    expect(validateCourseHours(course)).toContain(
      "Общий баланс: 0 ч обучения + 2 ч аттестации ≠ 16 ч.",
    );
  });

  it("обнаруживает превышение часов аттестации", () => {
    const course = createEmptyCourse();

    course.brief.durationHours = 16;
    course.brief.attestationHours = 20;

    expect(validateCourseHours(course)).toContain(
      "Аттестация не может превышать продолжительность курса.",
    );
  });
});
