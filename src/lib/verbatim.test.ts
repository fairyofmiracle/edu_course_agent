import { describe, expect, it } from "vitest";
import { SAMPLE_COURSE } from "@/lib/sample-course";
import { sourceConfidence, verbatimSpans } from "@/lib/verbatim";

describe("verbatimSpans", () => {
  it("ловит дословное окно из примечания референса", () => {
    const course = structuredClone(SAMPLE_COURSE);
    const fragment =
      "слушатель собирает учебный план и сверяет часы модулей с объёмом программы перед печатью";
    course.brief.references[0].note = fragment;
    course.lectures[0].slides[0].bullets[0] = fragment;
    const hits = verbatimSpans(course);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]).toContain("учебный план");
  });

  it("не считает ссылку подтверждённым источником", () => {
    const confidence = sourceConfidence(SAMPLE_COURSE);
    expect(confidence.level).toBe("средняя");
    expect(confidence.summary).toContain("Не подтверждены");
    expect(confidence.copies).toEqual([]);
  });
});
