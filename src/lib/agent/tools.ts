import { jsonSchema, tool } from "ai";
import { z } from "zod";
import {
  assessmentSchema,
  lectureSchema,
  seminarSchema,
  type CourseDocument,
  type CourseModule,
} from "@/lib/course-schema";
import type { CoursePatch } from "@/lib/course-patches";
import { fillModulePlan } from "@/lib/hours-balance";
import { russianZodError } from "@/lib/zod-ru";
import { dropEmptyFields, guardBrief, type BriefGuardContext } from "@/lib/agent/brief-guard";
import type { CourseBrief } from "@/lib/course-schema";

// Без default: иначе модель копирует "" и 0 из схемы и затирает бриф.
const briefInputSchema = z.object({
  title: z.string().max(180).optional().describe("Название программы"),
  audience: z.string().max(400).optional().describe("Кто слушатели и их входной уровень"),
  level: z.enum(["beginner", "intermediate", "advanced"]).optional(),
  durationHours: z.coerce.number().min(0).optional().describe("Объём в академических часах, без верхнего предела"),
  format: z.enum(["lecture", "blended", "workshop"]).optional(),
  programKind: z
    .enum(["general", "qualification"])
    .optional()
    .describe("general — общеразвивающая с сертификатом, qualification — повышение квалификации с удостоверением"),
  attestationHours: z.coerce.number().min(0).max(80).optional(),
  attestationForm: z.string().max(180).optional(),
  goals: z.array(z.string().min(1).max(300)).max(12).optional(),
  constraints: z.array(z.string().min(1).max(300)).max(12).optional(),
});

const bloom = z.enum([
  "remember",
  "understand",
  "apply",
  "analyze",
  "evaluate",
  "create",
]);

const looseNode = z.object({
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(180),
  bloomLevel: bloom.default("apply"),
  moduleIds: z.array(z.string()).max(12).default([]),
  description: z.string().max(400).optional(),
  knowledge: z.array(z.string()).max(6).default([]),
  skills: z.array(z.string()).max(6).default([]),
  abilities: z.array(z.string()).max(6).default([]),
  laborFunctionCode: z.string().max(40).optional(),
});

const looseCompetencyMap = z.object({
  nodes: z.array(looseNode).min(1).max(12),
  edges: z
    .array(z.object({ from: z.string(), to: z.string() }))
    .max(40)
    .default([]),
});

const looseTopic = z.object({
  title: z.string().min(1).max(200),
  lectureHours: z.coerce.number().min(0).default(0),
  practiceHours: z.coerce.number().min(0).default(0),
  labHours: z.coerce.number().min(0).default(0),
  selfStudyHours: z.coerce.number().min(0).default(0),
});

const looseLines = (max: number) =>
  z
    .array(z.string())
    .max(max)
    .default([])
    .transform((values) => values.map((value) => value.trim()).filter(Boolean));

const looseModule = z.object({
  id: z.string().min(1).max(40),
  title: z.string().min(1).max(180),
  hours: z.coerce.number().min(0).default(0),
  lectureHours: z.coerce.number().min(0).default(0),
  practiceHours: z.coerce.number().min(0).default(0),
  labHours: z.coerce.number().min(0).default(0),
  selfStudyHours: z.coerce.number().min(0).default(0),
  topics: looseLines(20),
  plan: z.array(looseTopic).max(20).default([]),
  learningOutcomes: looseLines(12),
  competencyIds: z.array(z.string()).max(12).default([]),
});

const SECTION_NAMES = [
  "brief",
  "competencies",
  "structure",
  "lecture",
  "seminar",
  "assessment",
] as const;

type SectionName = (typeof SECTION_NAMES)[number];

type ReviseSectionInput = {
  section: SectionName;
  moduleId?: string;
  data: unknown;
};

// Cloud.ru отклоняет properties без type/enum/const/union — z.any() даёт пустой {}.
const reviseSectionSchema = jsonSchema<ReviseSectionInput>({
  type: "object",
  properties: {
    section: {
      type: "string",
      enum: [...SECTION_NAMES],
      description: "Какую секцию заменить",
    },
    moduleId: {
      type: "string",
      description: "id модуля для lecture, seminar, assessment",
    },
    data: {
      type: "object",
      description:
        "Объект секции в той же форме, что у setter. Для плана — {\"modules\": [...]}",
    },
  },
  required: ["section", "data"],
});

function coerceSectionData(data: unknown): unknown {
  if (typeof data !== "string") return data;
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}

export const COURSE_TOOL_NAMES = [
  "update_brief",
  "set_competency_map",
  "set_structure",
  "set_lecture",
  "set_seminar",
  "set_assessment",
  "revise_section",
] as const;

const CONTENT_SECTIONS = new Set(["lecture", "seminar", "assessment"]);

function contentBlocked() {
  return {
    type: "tool_error" as const,
    message:
      "Каркас ещё не утверждён. Методист должен проверить часы и нажать «Утвердить каркас». Пока только update_brief, set_competency_map и set_structure.",
  };
}

function shortId(value: string, fallback: string) {
  const clean = value.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  const base = (clean || fallback).slice(0, 40);
  return base || fallback.slice(0, 40);
}

function withZun(node: z.infer<typeof looseNode>, index: number) {
  const fallback = node.name;
  return {
    ...node,
    id: shortId(node.id, `c${index + 1}`),
    knowledge: node.knowledge.length ? node.knowledge : [`Знает: ${fallback}`],
    skills: node.skills.length ? node.skills : [`Умеет применить: ${fallback}`],
    abilities: node.abilities.length ? node.abilities : [`Владеет: ${fallback}`],
    moduleIds: node.moduleIds.map((id) => shortId(id, id)).filter(Boolean),
  };
}

export type ToolGate = { locked: boolean };

function gateTools<T extends Record<string, { execute?: (...args: never[]) => unknown }>>(
  tools: T,
  gate?: ToolGate,
): T {
  if (!gate) return tools;
  const wrapped = Object.entries(tools).map(([name, item]) => {
    const execute = item.execute as ((...args: unknown[]) => unknown) | undefined;
    return [
      name,
      {
        ...item,
        execute: async (...args: unknown[]) =>
          gate.locked
            ? {
                type: "tool_error" as const,
                message: "На этом шаге инструменты не нужны. Ответь методисту текстом.",
              }
            : execute?.(...args),
      },
    ];
  });
  return Object.fromEntries(wrapped) as T;
}

export function createCourseTools(
  allowContent = false,
  course?: CourseDocument,
  guard?: BriefGuardContext,
  gate?: ToolGate,
) {
  return gateTools(courseTools(allowContent, course, guard), gate);
}

function courseTools(allowContent: boolean, course?: CourseDocument, guard?: BriefGuardContext) {
  return {
    update_brief: tool({
      description:
        "Обновляет бриф: title, audience, durationHours, programKind (general или qualification), attestationHours, attestationForm, goals, constraints. Объём и шаблон — только если их назвал методист.",
      inputSchema: briefInputSchema,
      execute: async (raw): Promise<CoursePatch> => {
        const brief = dropEmptyFields(raw as Partial<CourseBrief>);
        if (!course || !guard) return { type: "update_brief", brief };
        return { type: "update_brief", brief: guardBrief(brief, course.brief, guard).brief };
      },
    }),
    set_competency_map: tool({
      description:
        "Записывает карту компетенций, 3–8 узлов. У каждого knowledge, skills, abilities. Если забыл ЗУН — сервер подставит. laborFunctionCode только из входного профстандарта.",
      inputSchema: looseCompetencyMap,
      execute: async (raw): Promise<CoursePatch | { type: "tool_error"; message: string }> => {
        const parsed = looseCompetencyMap.safeParse(raw);
        if (!parsed.success) {
          return {
            type: "tool_error",
            message: `Карта компетенций не принята: ${russianZodError(parsed.error)}. Пришли nodes с id, name, knowledge, skills, abilities, moduleIds.`,
          };
        }
        return {
          type: "set_competency_map",
          competencies: {
            nodes: parsed.data.nodes.map(withZun),
            edges: parsed.data.edges.map((edge) => ({
              from: shortId(edge.from, edge.from),
              to: shortId(edge.to, edge.to),
            })),
          },
        };
      },
    }),
    set_structure: tool({
      description:
        "Записывает учебный план, 3–8 модулей. Часы академические с шагом 0,5. Сервер доведёт сумму модулей до durationHours минус аттестация. plan можно не заполнять.",
      inputSchema: z.object({
        modules: z.array(looseModule).min(1).max(8),
      }),
      execute: async ({
        modules,
      }): Promise<CoursePatch | { type: "tool_error"; message: string }> => {
        const parsed = z.array(looseModule).min(1).max(8).safeParse(modules);
        if (!parsed.success) {
          return {
            type: "tool_error",
            message: `Учебный план не принят: ${russianZodError(parsed.error)}. Нужен массив modules с id, title, hours или видами часов, topics. Не больше 8 модулей.`,
          };
        }
        const seen = new Set<string>();
        const filled = parsed.data.map((row, index) => {
          let id = shortId(row.id, `m${index + 1}`);
          if (seen.has(id)) id = shortId(`${id}-${index + 1}`, `m${index + 1}`);
          seen.add(id);
          return fillModulePlan({
            ...row,
            id,
            competencyIds: row.competencyIds.map((cid) => shortId(cid, cid)),
          } as CourseModule);
        });
        return { type: "set_structure", modules: filled };
      },
    }),
    set_lecture: tool({
      description:
        "Записывает план лекции и слайды для одного модуля. Вызывай отдельно для каждого moduleId. Только после утверждения каркаса.",
      inputSchema: lectureSchema,
      execute: async (lecture): Promise<CoursePatch | ReturnType<typeof contentBlocked>> => {
        if (!allowContent) return contentBlocked();
        return { type: "set_lecture", lecture };
      },
    }),
    set_seminar: tool({
      description:
        "Записывает семинарские задания для одного модуля: промпт, шаги, время, критерии, competencyId и learningOutcome — дословный результат обучения из модуля. Каждое задание проверяет один результат. Только после утверждения каркаса.",
      inputSchema: seminarSchema,
      execute: async (seminar): Promise<CoursePatch | ReturnType<typeof contentBlocked>> => {
        if (!allowContent) return contentBlocked();
        return { type: "set_seminar", seminar };
      },
    }),
    set_assessment: tool({
      description:
        "Записывает тест модуля. У каждого вопроса есть ключ answer, competencyId и learningOutcome — дословный результат обучения из модуля. Только после утверждения каркаса.",
      inputSchema: assessmentSchema,
      execute: async (assessment): Promise<CoursePatch | ReturnType<typeof contentBlocked>> => {
        if (!allowContent) return contentBlocked();
        return { type: "set_assessment", assessment };
      },
    }),
    revise_section: tool({
      description:
        "Точечно заменяет секцию документа. data — валидный JSON этой секции. Для lecture, seminar и assessment можно передать moduleId отдельно, если его нет внутри data. Для structure подойдёт массив модулей или объект { modules }.",
      inputSchema: reviseSectionSchema,
      execute: async ({ section, moduleId, data }): Promise<CoursePatch | ReturnType<typeof contentBlocked>> => {
        if (!allowContent && CONTENT_SECTIONS.has(section)) return contentBlocked();
        return {
          type: "revise_section",
          section,
          moduleId,
          data: coerceSectionData(data),
        };
      },
    }),
  };
}

export type CourseTools = ReturnType<typeof createCourseTools>;
