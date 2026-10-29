import { describe, expect, it } from "vitest";
import { applyHourConstraints } from "@/lib/hours-balance";
import type { CourseModule } from "@/lib/course-schema";

const makeModule = (
  id: string,
  hours: number,
  selfStudyHours: number,
): CourseModule => ({
  id,
  title: `Модуль ${id}`,
  hours,
  lectureHours: hours - selfStudyHours,
  practiceHours: 0,
  labHours: 0,
  selfStudyHours,
  topics: ["Тема 1"],
  plan: [],
  learningOutcomes: ["Результат обучения"],
  competencyIds: [],
});

describe("applyHourConstraints", () => {
  it("увеличивает самостоятельную работу до 35 часов", () => {
    const modules = [
      makeModule("m1", 20, 3),
      makeModule("m2", 20, 3),
      makeModule("m3", 20, 3),
      makeModule("m4", 10, 4.5),
    ];

    const result = applyHourConstraints(modules, [
      {
        field: "selfStudyHours",
        operator: "min",
        value: 35,
        source: "methodist",
      },
    ]);

    expect(
      result.reduce((sum, module) => sum + module.selfStudyHours, 0),
    ).toBeGreaterThanOrEqual(35);

    expect(
      result.reduce((sum, module) => sum + module.hours, 0),
    ).toBe(70);

    result.forEach((module) => {
      expect(
        module.lectureHours +
          module.practiceHours +
          module.labHours +
          module.selfStudyHours,
      ).toBe(module.hours);

      expect(
        module.plan.reduce(
          (sum, row) =>
            sum +
            row.lectureHours +
            row.practiceHours +
            row.labHours +
            row.selfStudyHours,
          0,
        ),
      ).toBe(module.hours);
    });
  });

  it("не изменяет курс без ограничений", () => {
    const modules = [makeModule("m1", 20, 3)];

    expect(applyHourConstraints(modules)).toEqual(modules);
  });

  it("отклоняет несовместимые ограничения", () => {
    const modules = [makeModule("m1", 20, 3)];

    expect(() =>
      applyHourConstraints(modules, [
        {
          field: "selfStudyHours",
          operator: "min",
          value: 15,
          source: "methodist",
        },
        {
          field: "lectureHours",
          operator: "min",
          value: 15,
          source: "methodist",
        },
      ]),
    ).toThrow("Ограничения учебной нагрузки несовместимы");
  });
});