import { describe, expect, it } from "vitest";
import { SAMPLE_COURSE } from "@/lib/sample-course";
import { courseReadiness, formatKitLegend } from "@/lib/course-readiness";

describe("courseReadiness", () => {
  it("returns stage badges and kit legend for sample course", () => {
    const readiness = courseReadiness(SAMPLE_COURSE);
    expect(["ready", "partial", "empty"]).toContain(readiness.framework);
    expect(["ready", "partial", "empty"]).toContain(readiness.materials);
    expect(["pass", "warning", "fail", "empty"]).toContain(readiness.checks);
    expect(readiness.kit.lecture.need).toBeGreaterThanOrEqual(0);
    expect(formatKitLegend(readiness.kit)).toMatch(/Л \d+\/\d+/);
    expect(formatKitLegend(readiness.kit)).toMatch(/З \d+\/\d+/);
    expect(formatKitLegend(readiness.kit)).toMatch(/Т \d+\/\d+/);
  });

  it("marks empty course as empty stages", () => {
    const empty = {
      ...SAMPLE_COURSE,
      modules: [],
      lectures: [],
      seminars: [],
      assessments: [],
      frameworkApproved: false,
    };
    const readiness = courseReadiness(empty);
    expect(readiness.framework).toBe("empty");
    expect(readiness.materials).toBe("empty");
    expect(readiness.checks).toBe("empty");
  });
});
