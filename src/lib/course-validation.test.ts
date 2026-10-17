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

  it("принимает часы с шагом 0,5", () => {
    const course = createEmptyCourse();
    course.brief.durationHours = 16;
    course.brief.attestationHours = 0.5;
    course.modules = [
      {
        id: "module-1",
        title: "Основы Python",
        hours: 15.5,
        lectureHours: 4,
        practiceHours: 8,
        labHours: 1.5,
        selfStudyHours: 2,
        topics: ["Введение в Python"],
        plan: [
          {
            title: "Введение в Python",
            lectureHours: 4,
            practiceHours: 8,
            labHours: 1.5,
            selfStudyHours: 2,
          },
        ],
        learningOutcomes: ["Пишет простые программы на Python"],
        competencyIds: [],
      },
    ];

    expect(validateCourseHours(course)).toEqual([]);
  });

  it("показывает сбой шага, видов занятий и плана тем", () => {
    const course = createEmptyCourse();
    course.brief.durationHours = 15.2;
    course.brief.attestationHours = Number.NaN;
    course.modules = [
      {
        id: "module-1",
        title: "Основы",
        hours: 0.2,
        lectureHours: 1,
        practiceHours: 0,
        labHours: 0,
        selfStudyHours: 0,
        topics: ["Вводная"],
        plan: [],
        learningOutcomes: ["Смотрит"],
        competencyIds: [],
      },
      {
        id: "module-2",
        title: "Практика",
        hours: 2,
        lectureHours: 2,
        practiceHours: 0,
        labHours: 0,
        selfStudyHours: 0,
        topics: ["Задача"],
        plan: [
          {
            title: "Задача",
            lectureHours: 1,
            practiceHours: 0,
            labHours: 0,
            selfStudyHours: 0,
          },
        ],
        learningOutcomes: ["Решает"],
        competencyIds: [],
      },
    ];
    const errors = validateCourseHours(course).join("\n");
    expect(errors).toContain("шагом 0,5");
    expect(errors).toContain("кратны 0,5");
    expect(errors).toContain("больше нуля");
    expect(errors).toContain("отсутствует план");
    expect(errors).toContain("сумма часов тем");
  });
});
