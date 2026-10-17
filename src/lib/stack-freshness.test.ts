import { describe, expect, it } from "vitest";
import { createEmptyCourse } from "@/lib/course-schema";
import { checkStack, stackTexts } from "@/lib/stack-freshness";

describe("сроки поддержки", () => {
  it("собирает темы модулей и не выдумывает версию", () => {
    const course = createEmptyCourse();
    course.modules = [
      {
        id: "m1",
        title: "Данные",
        hours: 16,
        lectureHours: 4,
        practiceHours: 8,
        labHours: 2,
        selfStudyHours: 2,
        topics: ["Python 3.8"],
        plan: [],
        learningOutcomes: ["Готовит выборку"],
        competencyIds: [],
      },
    ];
    expect(stackTexts(course).join("\n")).toContain("Python 3.8");
  });

  it("молчание сервера не превращает версию в снятую с поддержки", async () => {
    const report = await checkStack(["Python 3.8"], {
      base: "http://studio.local",
      fetchImpl: async () => {
        throw new Error("down");
      },
    });
    expect(report.state).toBe("down");
    if (report.state === "down") expect(report.message).toContain("не подтверждены");

    expect(await checkStack([], { fetchImpl: async () => Response.json({}) })).toEqual({ state: "empty" });
    expect(await checkStack(["Python 3.8"], { base: "", fetchImpl: async () => Response.json({}) })).toEqual({
      state: "disabled",
    });
    const http = await checkStack(["Python 3.8"], {
      base: "http://studio.local/",
      fetchImpl: async () => new Response("no", { status: 503 }),
    });
    expect(http.state).toBe("down");
    if (http.state === "down") expect(http.message).toContain("503");
    expect(
      await checkStack(["Python 3.8"], {
        base: "http://studio.local",
        fetchImpl: async () => Response.json({ state: "empty" }),
      }),
    ).toEqual({ state: "empty" });
    const ready = await checkStack(["Python 3.8"], {
      base: "http://studio.local",
      fetchImpl: async () => Response.json({ hits: [{ name: "Python", status: "supported" }] }),
    });
    expect(ready.state).toBe("ready");
  });
});
