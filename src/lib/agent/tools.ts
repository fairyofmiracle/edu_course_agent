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

export function createCourseTools() {
  return {
    update_brief: tool({
      description:
        "Обновляет бриф курса: название, аудитория, уровень, часы, формат, цели, ограничения, референсы. Можно передать только изменившиеся поля.",
      inputSchema: briefSchema.partial(),
      execute: async (brief): Promise<CoursePatch> => ({
        type: "update_brief",
        brief,
      }),
    }),
    set_competency_map: tool({
      description:
        "Записывает карту компетенций: узлы с Bloom-уровнем и moduleIds, рёбра предпосылок from→to.",
      inputSchema: competencyMapSchema,
      execute: async (competencies): Promise<CoursePatch> => ({
        type: "set_competency_map",
        competencies,
      }),
    }),
    set_structure: tool({
      description:
        "Записывает модульную структуру целиком: id, название, часы, темы, результаты обучения, competencyIds.",
      inputSchema: z.object({
        modules: z.array(moduleSchema).min(3).max(8),
      }),
      execute: async ({ modules }): Promise<CoursePatch> => ({
        type: "set_structure",
        modules,
      }),
    }),
    set_lecture: tool({
      description:
        "Записывает план лекции и слайды для одного модуля. Вызывай отдельно для каждого moduleId.",
      inputSchema: lectureSchema,
      execute: async (lecture): Promise<CoursePatch> => ({
        type: "set_lecture",
        lecture,
      }),
    }),
    set_seminar: tool({
      description:
        "Записывает семинарские задания для одного модуля: промпт, шаги, время, критерии, competencyId.",
      inputSchema: seminarSchema,
      execute: async (seminar): Promise<CoursePatch> => ({
        type: "set_seminar",
        seminar,
      }),
    }),
    set_assessment: tool({
      description:
        "Записывает тест модуля: mcq и открытые вопросы с ответами, пояснениями и competencyId.",
      inputSchema: assessmentSchema,
      execute: async (assessment): Promise<CoursePatch> => ({
        type: "set_assessment",
        assessment,
      }),
    }),
    revise_section: tool({
      description:
        "Точечно заменяет секцию документа. data — валидный JSON этой секции. Для lecture, seminar и assessment можно передать moduleId отдельно, если его нет внутри data. Для structure подойдёт массив модулей или объект { modules }.",
      inputSchema: reviseSectionSchema,
      execute: async ({ section, moduleId, data }): Promise<CoursePatch> => ({
        type: "revise_section",
        section,
        moduleId,
        data,
      }),
    }),
  };
}

export type CourseTools = ReturnType<typeof createCourseTools>;
