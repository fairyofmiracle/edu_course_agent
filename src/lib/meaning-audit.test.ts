import { describe, expect, it } from "vitest";
import { auditCourse } from "@/lib/course-audit";
import { meaningHits, textSimilarity } from "@/lib/meaning-audit";
import { SAMPLE_COURSE } from "@/lib/sample-course";

const copy = () => structuredClone(SAMPLE_COURSE);

describe("meaningHits", () => {
  it("пример без шаблонов и пустых блоков не даёт fail по смыслу", () => {
    const hits = meaningHits(copy());
    expect(hits.filter((hit) => hit.severity === "fail")).toEqual([]);
    const report = auditCourse(copy());
    const meaningFails = report.items.filter(
      (item) => item.section === "meaning" && item.status === "fail",
    );
    expect(meaningFails).toEqual([]);
  });

  it("ловит шаблонную фразу «будет описано»", () => {
    const course = copy();
    course.lectures[0].slides[0].bullets[0] = "Материал будет описано позже";
    const hits = meaningHits(course);
    expect(hits.some((hit) => hit.kind === "template" && /будет описано/i.test(hit.details))).toBe(
      true,
    );
    const item = auditCourse(course).items.find((entry) => entry.id.includes("meaning.template"));
    expect(item?.status).toBe("fail");
    expect(item?.section).toBe("meaning");
  });

  it("ловит lorem в задании", () => {
    const course = copy();
    course.seminars[0].tasks[0].prompt = "Lorem ipsum dolor sit amet для практики";
    const hits = meaningHits(course);
    expect(hits.some((hit) => hit.kind === "template")).toBe(true);
  });

  it("ловит дубли между модулями", () => {
    const course = copy();
    if (course.modules.length < 2) {
      course.modules.push({
        ...course.modules[0],
        id: "m2",
        title: "Второй модуль",
      });
    }
    const shared =
      "слушатель собирает учебный план и сверяет часы модулей с объёмом программы перед печатью комплекта";
    course.modules[0].topics = [shared, "доп тема один"];
    course.modules[1].topics = [shared, "доп тема два"];
    course.modules[0].learningOutcomes = [`${shared} один`];
    course.modules[1].learningOutcomes = [`${shared} два`];
    expect(textSimilarity(shared, shared)).toBe(1);
    const hits = meaningHits(course);
    expect(hits.some((hit) => hit.kind === "duplicate")).toBe(true);
  });

  it("LLM-ревью в отчёте — disabled без асинхронного результата", () => {
    const item = auditCourse(copy()).items.find((entry) => entry.id === "meaning.llm");
    expect(item?.status).toBe("disabled");
    expect(item?.section).toBe("meaning");
    expect(item?.details).toMatch(/LLM|ревью|недоступ/i);
  });
});
