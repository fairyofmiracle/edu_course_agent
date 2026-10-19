import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { courseDocumentSchema, type CourseDocument } from "./course-schema";
import { frameworkItems, isKitComplete } from "./framework-check";

const fixture = JSON.parse(
  readFileSync(resolve("fixtures/course-contract.json"), "utf8"),
);

describe("shared course contract", () => {
  it("accepts the cross-runtime fixture", () => {
    const course = courseDocumentSchema.parse(fixture);
    const results = Object.fromEntries(
      frameworkItems(course).map((item) => [item.id, item.ok]),
    );

    expect(results).toMatchObject({
      template: true,
      brief: true,
      duration: true,
      competencies: true,
      modules: true,
      hours: true,
      links: true,
      known: true,
    });
    expect(isKitComplete(course)).toBe(false);
  });

  it("считает комплект собранным, когда у модуля есть лекция, задание и тест", () => {
    const course = courseDocumentSchema.parse(fixture);
    const lecture = { moduleId: "M1" } as CourseDocument["lectures"][number];
    const seminar = { moduleId: "M1" } as CourseDocument["seminars"][number];
    const assessment = { moduleId: "M1" } as CourseDocument["assessments"][number];

    expect(isKitComplete({ ...course, seminars: [seminar], assessments: [assessment] })).toBe(false);
    expect(isKitComplete({ ...course, lectures: [lecture], seminars: [seminar], assessments: [assessment] })).toBe(true);
  });
});
