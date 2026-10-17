import { describe, expect, it } from "vitest";
import { decideMode, planStep } from "@/lib/agent/orchestrator";
import { applyPatch } from "@/lib/course-patches";
import { createEmptyCourse } from "@/lib/course-schema";
import { frameworkFingerprint, frameworkItems } from "@/lib/framework-check";
import { SAMPLE_COURSE } from "@/lib/sample-course";

describe("planStep", () => {
  it("на дырявом запросе после брифа задаёт вопросы, а не собирает каркас", () => {
    const course = applyPatch(createEmptyCourse(), {
      type: "update_brief",
      brief: { title: "Кибербезопасность", audience: "студенты колледжа" },
    });
    const first = planStep("intake", createEmptyCourse(), [], 1);
    expect(first).toMatchObject({ kind: "tool", tool: "update_brief" });
    const second = planStep("intake", course, ["update_brief"], 1);
    expect(second.kind).toBe("reply");
    expect(second.task).toContain("объём в часах");
  });

  it("при полном брифе собирает карту и план, потом отвечает", () => {
    const course = applyPatch(createEmptyCourse(), {
      type: "update_brief",
      brief: {
        title: "Python",
        audience: "школьники",
        durationHours: 16,
        programKind: "general",
        goals: ["основы"],
      },
    });
    expect(planStep("intake", course, ["update_brief"], 1)).toMatchObject({ tool: "set_competency_map" });
    expect(planStep("intake", course, ["update_brief", "set_competency_map"], 1)).toMatchObject({
      tool: "set_structure",
    });
    expect(planStep("intake", course, ["update_brief", "set_competency_map", "set_structure"], 1).kind).toBe(
      "reply",
    );
  });

  it("после утверждения идёт по каждому модулю и не крутит один шаг больше двух раз", () => {
    const base = { ...SAMPLE_COURSE, lectures: [], seminars: [], assessments: [] };
    const approved = { ...base, frameworkApproved: true, frameworkFingerprint: frameworkFingerprint(base) };
    expect(frameworkItems(approved).every((item) => item.ok)).toBe(true);
    expect(decideMode(approved, "Каркас утверждён.")).toBe("kit");
    const first = planStep("kit", approved, [], 3);
    expect(first).toMatchObject({ tool: "set_assessment", moduleId: approved.modules[0].id });
    const key = `set_assessment:${approved.modules[0].id}`;
    const skipped = planStep("kit", approved, [key, key], 3);
    expect(skipped).toMatchObject({ tool: "set_seminar", moduleId: approved.modules[0].id });
  });
});
