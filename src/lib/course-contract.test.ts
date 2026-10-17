import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { courseDocumentSchema } from "./course-schema";
import { frameworkItems } from "./framework-check";

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
  });
});
