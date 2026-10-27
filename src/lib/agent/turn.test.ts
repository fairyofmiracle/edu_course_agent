import { afterEach, describe, expect, it, vi } from "vitest";
import { FRAMEWORK_PROMPT, KIT_PROMPT, moduleKitPrompt } from "@/lib/agent/service-prompts";
import { getLanguageModel } from "@/lib/agent/model";
import { buildSystemPrompt } from "@/lib/agent/prompts";
import { createCourseTools } from "@/lib/agent/tools";
import { createTurn, toolErrors } from "@/lib/agent/turn";
import { createEmptyCourse } from "@/lib/course-schema";
import { SAMPLE_COURSE } from "@/lib/sample-course";

describe("ход агента без вызова модели", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("собирает промпт, шаг и отказ без ключа", () => {
    expect(FRAMEWORK_PROMPT).toContain("каркас");
    expect(KIT_PROMPT).toContain("set_lecture");
    const modular = moduleKitPrompt("M2", "Алгоритмы");
    expect(modular).toContain("M2");
    expect(modular).toContain("Алгоритмы");
    expect(modular).toContain("set_assessment");
    const prompt = buildSystemPrompt(SAMPLE_COURSE, "я".repeat(12_001), 2);
    expect(prompt).toContain("Текущий документ");
    expect(prompt.endsWith("…") || prompt.includes("…")).toBe(true);

    const turn = createTurn({
      course: createEmptyCourse(),
      userTexts: ["нужна программа на 16 часов"],
      extraReferences: "приказ",
    });
    const step = turn.prepareStep({ steps: [] });
    expect(step.instructions).toContain("Текущий шаг");
    expect(turn.stopWhen).toHaveLength(2);
    expect(turn.stopWhen[1]({} as Parameters<(typeof turn.stopWhen)[number]>[0])).toBe(false);

    vi.stubEnv("GIGASCHOOL_API_KEY", "");
    vi.stubEnv("CLOUDRU_API_KEY", "");

    expect(() => getLanguageModel()).toThrow(
      /CLOUDRU_API_KEY или GIGASCHOOL_API_KEY/,);
  });

  it("инструменты пишут каркас и не пускают содержание до утверждения", async () => {
    const gate = { locked: false };
    const tools = createCourseTools(
      false,
      createEmptyCourse(),
      { userTexts: ["16 часов, общеразвивающая"], formBrief: { durationHours: 16 } },
      gate,
    );
    const brief = await tools.update_brief.execute?.(
      { title: "Сети", audience: "колледж", durationHours: 16, programKind: "general" },
      { toolCallId: "b", messages: [], context: {} },
    );
    expect(brief).toMatchObject({ type: "update_brief" });

    const map = await tools.set_competency_map.execute?.(
      { nodes: [{ id: "Сеть 1", name: "Сеть", bloomLevel: "apply", moduleIds: [], knowledge: [], skills: [], abilities: [] }], edges: [{ from: "Сеть 1", to: "Сеть 1" }] },
      { toolCallId: "c", messages: [], context: {} },
    );
    expect(map).toMatchObject({ type: "set_competency_map" });

    const broken = await tools.set_competency_map.execute?.(
      { nodes: [], edges: [] },
      { toolCallId: "c2", messages: [], context: {} },
    );
    expect(broken).toMatchObject({ type: "tool_error" });

    const plan = await tools.set_structure.execute?.(
      {
        modules: [
          { id: "Модуль", title: "Коммутация", hours: 8, lectureHours: 2, practiceHours: 6, labHours: 0, selfStudyHours: 0, topics: [" VLAN "], plan: [], learningOutcomes: ["Настраивает"], competencyIds: [] },
          { id: "Модуль", title: "Маршруты", hours: 8, lectureHours: 2, practiceHours: 6, labHours: 0, selfStudyHours: 0, topics: ["IP"], plan: [], learningOutcomes: ["Строит"], competencyIds: [] },
        ],
      },
      { toolCallId: "s", messages: [], context: {} },
    );
    expect(plan).toMatchObject({ type: "set_structure" });

    const lecture = SAMPLE_COURSE.lectures[0];
    expect(await tools.set_lecture.execute?.(lecture, { toolCallId: "l", messages: [], context: {} })).toMatchObject({
      type: "tool_error",
    });
    const revise = await tools.revise_section.execute?.(
      { section: "brief", data: "{\"title\":\"Новое\"}" },
      { toolCallId: "r", messages: [], context: {} },
    );
    expect(revise).toMatchObject({ type: "revise_section", data: { title: "Новое" } });

    gate.locked = true;
    expect(await tools.update_brief.execute?.({ title: "мимо" }, { toolCallId: "x", messages: [], context: {} })).toMatchObject({
      type: "tool_error",
    });
  });

  it("после утверждения каркаса содержание проходит, ошибки инструментов собираются", async () => {
    vi.stubEnv("CLOUDRU_API_KEY", "test-key");
    vi.stubEnv("CLOUDRU_MODEL", "chat-test");
    expect(getLanguageModel("chat")).toBeTruthy();

    const tools = createCourseTools(true);
    const lecture = SAMPLE_COURSE.lectures[0];
    expect(await tools.set_lecture.execute?.(lecture, { toolCallId: "l", messages: [], context: {} })).toMatchObject({
      type: "set_lecture",
    });
    expect(
      await tools.set_seminar.execute?.(SAMPLE_COURSE.seminars[0], { toolCallId: "s", messages: [], context: {} }),
    ).toMatchObject({ type: "set_seminar" });
    expect(
      await tools.set_assessment.execute?.(SAMPLE_COURSE.assessments[0], { toolCallId: "a", messages: [], context: {} }),
    ).toMatchObject({ type: "set_assessment" });
    expect(
      await tools.revise_section.execute?.(
        { section: "lecture", moduleId: lecture.moduleId, data: "{не json" },
        { toolCallId: "r", messages: [], context: {} },
      ),
    ).toMatchObject({ type: "revise_section", data: "{не json" });

    const errors = toolErrors([
      {
        content: [
          { type: "tool-error", toolName: "set_lecture" },
          { type: "tool-result", toolName: "set_structure", output: { type: "tool_error", message: "часы" } },
          { type: "text", text: "ок" },
        ],
      },
    ] as never);
    expect(errors).toEqual(["set_lecture", "set_structure: часы"]);
  });
});
