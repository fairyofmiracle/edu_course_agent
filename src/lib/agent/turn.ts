import { stepCountIs, type StepResult, type ToolSet } from "ai";
import { buildSystemPrompt } from "@/lib/agent/prompts";
import { createCourseTools, type ToolGate } from "@/lib/agent/tools";
import { decideMode, foldSteps, planStep, type TurnMode } from "@/lib/agent/orchestrator";
import { isFrameworkApproved } from "@/lib/framework-check";
import type { CourseBrief, CourseDocument } from "@/lib/course-schema";

export const MAX_STEPS = 28;

/**
 * Общая настройка одного хода агента для чата и для /api/run:
 * инструменты с защитой брифа и prepareStep, который ведёт модель по шагам.
 */
export function createTurn(options: {
  course: CourseDocument;
  userTexts: string[];
  extraReferences?: string;
  formBrief?: Partial<CourseBrief>;
}) {
  const { course, userTexts, extraReferences, formBrief } = options;
  const userTurns = userTexts.length;
  const mode: TurnMode = decideMode(course, userTexts[userTexts.length - 1] ?? "");
  const gate: ToolGate = { locked: false };
  const tools = createCourseTools(isFrameworkApproved(course), course, { userTexts, formBrief }, gate);
  const planned: string[] = [];

  const prepareStep = ({ steps }: { steps: Array<StepResult<ToolSet>> }) => {
    const current = foldSteps(course, steps);
    const step = planStep(mode, current, planned, userTurns);
    gate.locked = step.kind === "reply";
    planned.push(
      step.kind === "tool" ? (step.moduleId ? `${step.tool}:${step.moduleId}` : step.tool) : step.kind,
    );
    const instructions = `${buildSystemPrompt(current, extraReferences, userTurns)}\n\nТекущий шаг: ${step.task}`;
    // Cloud.ru отвергает историю с вызовом функции, которой нет в tools,
    // а tool_choice "none" там значит то же самое. Поэтому tools не урезаем,
    // инструмент задаём через tool_choice, а ответ без инструментов — инструкцией.
    if (step.kind === "tool") {
      return { instructions, toolChoice: { type: "tool" as const, toolName: step.tool } };
    }
    return { instructions, toolChoice: "auto" as const };
  };

  return {
    mode,
    tools,
    planned,
    system: buildSystemPrompt(course, extraReferences, userTurns),
    prepareStep,
    stopWhen: [
      stepCountIs(MAX_STEPS),
      () => planned.filter((key) => key === "reply").length >= 2,
    ],
  };
}

export function toolErrors(steps: Array<StepResult<ToolSet>>) {
  return steps.flatMap((step) =>
    step.content.flatMap((part) => {
      if (part.type === "tool-error") return [String((part as { toolName?: string }).toolName)];
      if (part.type !== "tool-result") return [];
      const output = part.output as { type?: string; message?: string } | undefined;
      return output?.type === "tool_error" ? [`${part.toolName}: ${output.message ?? ""}`] : [];
    }),
  );
}
