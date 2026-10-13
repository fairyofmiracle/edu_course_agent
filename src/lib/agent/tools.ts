import { tool } from "ai";
import { z } from "zod";
import {
  assessmentSchema,
  briefSchema,
  competencyMapSchema,
  lectureSchema,
  moduleSchema,
  seminarSchema,
} from "@/lib/course-schema";
import type { CoursePatch } from "@/lib/course-patches";

const reviseSectionSchema = z.object({
  section: z.enum([
    "brief",
    "competencies",
    "structure",
    "lecture",
    "seminar",
    "assessment",
  ]),
  moduleId: z.string().max(40).optional(),
  data: z.any().describe("Полный JSON секции в той же форме, что у соответствующего setter")
});

const CONTENT_SECTIONS = new Set(["lecture", "seminar", "assessment"]);

export function createCourseTools(allowContent = false) {
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
        "Записывает карту компетенций. У каждого узла есть knowledge, skills, abilities и moduleIds. Для повышения квалификации укажи laborFunctionCode, если он есть во входном профстандарте.",
      inputSchema: competencyMapSchema,
      execute: async (competencies): Promise<CoursePatch> => ({
        type: "set_competency_map",
        competencies,
      }),
    }),
    set_structure: tool({
      description:
        "Записывает учебный план. У модуля hours равен сумме lectureHours, practiceHours, labHours и selfStudyHours. plan — те же виды часов по темам, их сумма равна модулю. Сумма модулей и attestationHours равна durationHours.",
      inputSchema: z.object({
        modules: z.array(moduleSchema).min(1).max(24),
      }),
      execute: async ({ modules }): Promise<CoursePatch> => ({
        type: "set_structure",
        modules,
      }),
    }),
    ...(allowContent
      ? {
          set_lecture: tool({
            description:
              "Записывает план лекции и слайды для одного модуля. Вызывай отдельно для каждого moduleId. Только после утверждения каркаса.",
            inputSchema: lectureSchema,
            execute: async (lecture): Promise<CoursePatch> => ({
              type: "set_lecture",
              lecture,
            }),
          }),
          set_seminar: tool({
            description:
              "Записывает семинарские задания для одного модуля: промпт, шаги, время, критерии, competencyId. Только после утверждения каркаса.",
            inputSchema: seminarSchema,
            execute: async (seminar): Promise<CoursePatch> => ({
              type: "set_seminar",
              seminar,
            }),
          }),
          set_assessment: tool({
            description:
              "Записывает тест модуля. У каждого вопроса есть ключ answer, competencyId и learningOutcome — дословный результат обучения из модуля. Только после утверждения каркаса.",
            inputSchema: assessmentSchema,
            execute: async (assessment): Promise<CoursePatch> => ({
              type: "set_assessment",
              assessment,
            }),
          }),
        }
      : {}),
    revise_section: tool({
      description:
        "Точечно заменяет секцию документа. data — валидный JSON этой секции. Для lecture, seminar и assessment можно передать moduleId отдельно, если его нет внутри data. Для structure подойдёт массив модулей или объект { modules }.",
      inputSchema: reviseSectionSchema,
      execute: async ({ section, moduleId, data }): Promise<CoursePatch> => {
        if (!allowContent && CONTENT_SECTIONS.has(section)) {
          throw new Error(
            "Каркас ещё не утверждён. Методист должен проверить часы и компетенции и нажать «Утвердить каркас».",
          );
        }
        return {
          type: "revise_section",
          section,
          moduleId,
          data,
        };
      },
    }),
  };
}

export type CourseTools = ReturnType<typeof createCourseTools>;
