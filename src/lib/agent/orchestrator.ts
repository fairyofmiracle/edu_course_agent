import { applyPatch, isCoursePatch, rebalanceCourse } from "@/lib/course-patches";
import { courseDocumentSchema, type CourseDocument } from "@/lib/course-schema";
import { missingBriefLines } from "@/lib/brief-status";
import { frameworkItems, isFrameworkApproved } from "@/lib/framework-check";
import type { COURSE_TOOL_NAMES } from "@/lib/agent/tools";

export type CourseToolName = (typeof COURSE_TOOL_NAMES)[number];

/**
 * intake — разбор запроса: бриф, затем вопросы или каркас;
 * framework — кнопка «Дособрать каркас» или форма шаблона;
 * kit — каркас утверждён, а у модулей нет теста, семинара или лекции;
 * free — всё собрано, модель сама решает, что править.
 */
export type TurnMode = "intake" | "framework" | "kit" | "free";

export type PlannedStep =
  | { kind: "tool"; tool: CourseToolName; moduleId?: string; task: string }
  | { kind: "auto"; tools: CourseToolName[]; task: string }
  | { kind: "reply"; task: string };

const FRAMEWORK_REQUEST = /^Собери (только каркас|каркас по заполненному шаблону)/;
const KIT_TOOLS = ["set_assessment", "set_seminar", "set_lecture"] as const;
const MAX_TRIES = 2;

export function contentMissing(course: CourseDocument) {
  const has = {
    set_assessment: new Set(course.assessments.map((item) => item.moduleId)),
    set_seminar: new Set(course.seminars.map((item) => item.moduleId)),
    set_lecture: new Set(course.lectures.map((item) => item.moduleId)),
  };
  return course.modules.flatMap((module) =>
    KIT_TOOLS.filter((tool) => !has[tool].has(module.id)).map((tool) => ({
      tool,
      module,
    })),
  );
}

export function decideMode(course: CourseDocument, lastUserText: string): TurnMode {
  if (isFrameworkApproved(course)) {
    return contentMissing(course).length > 0 ? "kit" : "free";
  }
  if (FRAMEWORK_REQUEST.test(lastUserText.trim())) return "framework";
  return "intake";
}

export function foldSteps(
  course: CourseDocument,
  steps: Array<{ toolResults: Array<{ output?: unknown; toolName?: string }> }>,
  onReject?: (toolName: string, reason: string) => void,
): CourseDocument {
  let next = course;
  for (const step of steps) {
    for (const result of step.toolResults) {
      if (!isCoursePatch(result.output)) continue;
      const parsed = courseDocumentSchema.safeParse(applyPatch(next, result.output));
      if (parsed.success) next = parsed.data;
      else onReject?.(result.toolName ?? result.output.type, parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; "));
    }
  }
  return rebalanceCourse(next);
}

const KIT_TASK: Record<(typeof KIT_TOOLS)[number], string> = {
  set_assessment:
    "тест: 4–10 вопросов, у каждого ключ answer, competencyId из модуля и learningOutcome дословно из результатов модуля; закрой каждый результат хотя бы одним вопросом",
  set_seminar:
    "семинар: задания на реальной задаче аудитории, шаги, время, 2–6 критериев, competencyId и learningOutcome дословно из модуля; закрой каждый результат хотя бы одним практическим заданием",
  set_lecture:
    "лекцию: план из 3–10 пунктов и 4–10 слайдов, темы слайдов совпадают с темами модуля в плане",
};

function moduleLabel(module: CourseDocument["modules"][number]) {
  return `${module.id} «${module.title}» (компетенции: ${module.competencyIds.join(", ") || "нет"}; результаты: ${module.learningOutcomes.join("; ")})`;
}

/**
 * Следующий шаг агента. tried — сколько раз этот шаг уже назначался в текущем ходе:
 * после двух неудач идём дальше, чтобы не крутить модель по кругу.
 */
export function planStep(
  mode: TurnMode,
  course: CourseDocument,
  history: string[],
  userTurns: number,
): PlannedStep {
  const tried = (key: string) => history.filter((item) => item === key).length;
  const done = (key: string) => tried(key) >= 1;

  if (mode === "kit") {
    for (const gap of contentMissing(course)) {
      const key = `${gap.tool}:${gap.module.id}`;
      if (tried(key) >= MAX_TRIES) continue;
      return {
        kind: "tool",
        tool: gap.tool,
        moduleId: gap.module.id,
        task: `Сейчас вызови ${gap.tool} для модуля ${moduleLabel(gap.module)}. Собери ${KIT_TASK[gap.tool]}. moduleId строго «${gap.module.id}». Учитывай пожелания методиста из последних реплик.`,
      };
    }
    return {
      kind: "reply",
      task: "Комплект дописан. Одним-двумя предложениями скажи, что появилось справа, и перечисли модули, где чего-то не хватило, если такие есть. Инструменты не вызывай.",
    };
  }

  if (mode === "free") {
    return {
      kind: "auto",
      tools: ["revise_section", "set_lecture", "set_seminar", "set_assessment", "update_brief"],
      task: "Выполни просьбу методиста точечно: правь только названную часть. Если просьба — вопрос, просто ответь.",
    };
  }

  if (!done("update_brief")) {
    return {
      kind: "tool",
      tool: "update_brief",
      task: "Сейчас вызови update_brief: перенеси из реплик методиста всё, что он назвал, — title, audience, durationHours, programKind, attestationForm, attestationHours, goals, constraints. Чего методист не называл, не заполняй.",
    };
  }

  const missing = missingBriefLines(course);
  const answeredEnough = userTurns >= 2 && Boolean(course.brief.audience.trim() || course.brief.goals.length);
  const hasFramework = course.modules.length > 0;

  if (mode === "intake" && missing.length > 0 && !answeredEnough) {
    return {
      kind: "reply",
      task: `Не хватает: ${missing.join(", ")}. Одним сообщением задай методисту не больше пяти вопросов простыми словами: тип программы (общеразвивающая с сертификатом или повышение квалификации с удостоверением), объём в академических часах, входной уровень слушателей, форма обучения, форма итоговой аттестации — только то, чего нет. «Примерно месяц» объёмом не считается. Каркас не собирай, инструменты не вызывай.`,
    };
  }

  if (mode === "intake" && hasFramework) {
    if (history.length === 1) {
      return {
        kind: "auto",
        tools: ["set_competency_map", "set_structure", "revise_section"],
        task: "Каркас уже в документе. Если методист просит поменять модули или компетенции — поправь их. Если нет — ничего не вызывай и коротко ответь.",
      };
    }
    return { kind: "reply", task: summaryTask(course) };
  }

  if (!done("set_competency_map")) {
    return {
      kind: "tool",
      tool: "set_competency_map",
      task: "Сейчас вызови set_competency_map: 3–8 компетенций, у каждой id, name, knowledge, skills, abilities. laborFunctionCode — только если код есть во входе методиста.",
    };
  }
  if (!done("set_structure")) {
    const ids = course.competencies.nodes.map((node) => node.id).join(", ");
    return {
      kind: "tool",
      tool: "set_structure",
      task: `Сейчас вызови set_structure: 3–8 модулей с целыми часами, topics, learningOutcomes и competencyIds только из списка: ${ids}. Сумма модулей = ${Math.max(0, course.brief.durationHours - course.brief.attestationHours)} ч.`,
    };
  }
  return { kind: "reply", task: summaryTask(course) };
}

function summaryTask(course: CourseDocument) {
  const failed = frameworkItems(course)
    .filter((item) => !item.ok)
    .map((item) => item.label);
  return [
    "Инструменты не вызывай. Двумя-тремя предложениями опиши, что появилось в документе справа.",
    failed.length
      ? `Проверки, которые не прошли: ${failed.join("; ")}. Назови их и спроси у методиста недостающее.`
      : "Все проверки каркаса зелёные: попроси методиста проверить часы и нажать «Утвердить каркас».",
    "Не пиши, что каркас утверждён: это делает только методист кнопкой.",
  ].join(" ");
}
