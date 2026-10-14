import { jsonSchema, tool } from "ai";
import { z } from "zod";
import {
  assessmentSchema,
  briefSchema,
  lectureSchema,
  seminarSchema,
  type CourseDocument,
  type CourseModule,
} from "@/lib/course-schema";
import type { CoursePatch } from "@/lib/course-patches";
import { fillModulePlan } from "@/lib/hours-balance";
import { russianZodError } from "@/lib/zod-ru";

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
  lectureHours: z.coerce.number().min(0).max(500).default(0),
  practiceHours: z.coerce.number().min(0).max(500).default(0),
  labHours: z.coerce.number().min(0).max(500).default(0),
  selfStudyHours: z.coerce.number().min(0).max(500).default(0),
});

const looseModule = z.object({
  id: z.string().min(1).max(40),
  title: z.string().min(1).max(180),
  hours: z.coerce.number().min(0).max(500).default(0),
  lectureHours: z.coerce.number().min(0).max(500).default(0),
  practiceHours: z.coerce.number().min(0).max(500).default(0),
  labHours: z.coerce.number().min(0).max(500).default(0),
  selfStudyHours: z.coerce.number().min(0).max(500).default(0),
  topics: z.array(z.string()).max(20).default([]),
  plan: z.array(looseTopic).max(20).default([]),
  learningOutcomes: z.array(z.string()).max(12).default([]),
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

function withZun(node: z.infer<typeof looseNode>) {
  const fallback = node.name;
  return {
    ...node,
    knowledge: node.knowledge.length ? node.knowledge : [`Знает: ${fallback}`],
    skills: node.skills.length ? node.skills : [`Умеет применить: ${fallback}`],
    abilities: node.abilities.length ? node.abilities : [`Владеет: ${fallback}`],
    moduleIds: node.moduleIds.length ? node.moduleIds : [],
  };
}

export function createCourseTools(_allowContent = false, _course?: CourseDocument) {
  const allowContent = _allowContent;
  return {
    update_brief: tool({
      description:
        "Обновляет бриф: название, аудитория, часы, programKind (general или qualification), attestationHours, форма аттестации, цели, референсы.",
      inputSchema: briefSchema.partial(),
      execute: async (brief): Promise<CoursePatch> => ({
        type: "update_brief",
        brief,
      }),
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
            edges: parsed.data.edges,
          },
        };
      },
    }),
    set_structure: tool({
      description:
        "Записывает учебный план, 3–8 модулей. Часы только целые академические. Сервер доведёт сумму модулей до durationHours минус аттестация без десятых. plan можно не заполнять.",
      inputSchema: z.object({
        modules: z.array(looseModule).min(1).max(12),
      }),
      execute: async ({
        modules,
      }): Promise<CoursePatch | { type: "tool_error"; message: string }> => {
        const parsed = z.array(looseModule).min(1).max(12).safeParse(modules);
        if (!parsed.success) {
          return {
            type: "tool_error",
            message: `Учебный план не принят: ${russianZodError(parsed.error)}. Нужен массив modules с id, title, hours или видами часов, topics.`,
          };
        }
        const filled = parsed.data.map((module) => fillModulePlan(module as CourseModule));
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
        "Записывает семинарские задания для одного модуля: промпт, шаги, время, критерии, competencyId. Только после утверждения каркаса.",
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
