import { describe, expect, it } from "vitest";
import { decideMode, foldSteps, planStep } from "@/lib/agent/orchestrator";
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

  it("готовый комплект и свободный режим не собирают каркас заново", () => {
    const approved = {
      ...SAMPLE_COURSE,
      frameworkApproved: true,
      frameworkFingerprint: frameworkFingerprint(SAMPLE_COURSE),
    };
    expect(decideMode(approved, "поправь формулировку")).toBe("free");
    expect(decideMode(createEmptyCourse(), "Собери только каркас")).toBe("framework");
    expect(planStep("kit", approved, [], 4).kind).toBe("reply");
    expect(planStep("free", approved, [], 4)).toMatchObject({ kind: "auto" });
  });

  it("уже собранный каркас на первом шаге можно поправить, дальше только ответ", () => {
    const course = applyPatch(SAMPLE_COURSE, {
      type: "update_brief",
      brief: { audience: "" },
    });
    const editable = planStep("intake", course, ["update_brief"], 2);
    expect(editable).toMatchObject({ kind: "auto" });
    const summary = planStep("intake", course, ["update_brief", "ещё"], 2);
    expect(summary.kind).toBe("reply");
    expect(summary.task).toContain("не прошли");
  });

  it("кривой патч не попадает в документ и зовёт отказ", () => {
    const reasons: string[] = [];
    const next = foldSteps(
      createEmptyCourse(),
      [
        { toolResults: [{ output: { type: "не патч" } }] },
        {
          toolResults: [
            {
              toolName: "set_lecture",
              output: { type: "set_lecture", lecture: { moduleId: "m1" } },
            },
          ],
        },
      ],
      (toolName, reason) => reasons.push(`${toolName}: ${reason}`),
    );
    expect(next.lectures).toEqual([]);
    expect(reasons[0]).toContain("set_lecture");
  });
});
