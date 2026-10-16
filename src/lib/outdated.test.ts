import { describe, expect, it } from "vitest";
import { auditCourse } from "@/lib/course-audit";
import { createEmptyCourse } from "@/lib/course-schema";
import { findOutdated } from "@/lib/outdated";
import { SAMPLE_COURSE } from "@/lib/sample-course";

function courseWithTopic(topic: string) {
  const course = createEmptyCourse();
  course.modules = [
    {
      id: "m1",
      title: "Инструменты",
      hours: 16,
      lectureHours: 4,
      practiceHours: 8,
      labHours: 0,
      selfStudyHours: 4,
      topics: [topic],
      plan: [],
      learningOutcomes: ["Выбирает инструмент"],
      competencyIds: [],
    },
  ];
  return course;
}

describe("устаревшие инструменты", () => {
  it("пример 24 часов не помечает текущие темы", () => {
    expect(findOutdated(SAMPLE_COURSE)).toEqual([]);
    expect(auditCourse(SAMPLE_COURSE).items.find((item) => item.id === "freshness.clear")?.status).toBe(
      "pass",
    );
  });

  it("находит снятый с поддержки инструмент и не путает его с новой веткой", () => {
    expect(findOutdated(courseWithTopic("Практика в Adobe Flash Player")).map((hit) => hit.label)).toEqual([
      "Adobe Flash",
    ]);
    expect(findOutdated(courseWithTopic("Python 2.7 и virtualenv"))).toHaveLength(1);
    expect(findOutdated(courseWithTopic("Python 3 и Python 2024"))).toEqual([]);
    expect(findOutdated(courseWithTopic("CentOS 8 и flashlight"))).toEqual([]);
  });

  it("в отчёте это предупреждение, а не провал программы", () => {
    const report = auditCourse(courseWithTopic("Лабораторная в Internet Explorer"));
    const hit = report.items.find((item) => item.id.startsWith("freshness.internet-explorer"));

    expect(hit?.status).toBe("warning");
    expect(hit?.section).toBe("freshness");
    expect(report.summary.fail).toBeGreaterThan(0);
    expect(report.items.some((item) => item.id === "freshness.clear")).toBe(false);
  });
});
