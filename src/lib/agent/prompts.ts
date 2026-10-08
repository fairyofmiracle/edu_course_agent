import type { CourseDocument } from "@/lib/course-schema";

const MAX_COURSE_CHARS = 14000;
const MAX_REFERENCE_CHARS = 12000;

export const SYSTEM_PROMPT = `Ты — методист-проектировщик образовательных программ по искусственному интеллекту.

Ты работаешь в студии курса: чат слева, справа живой документ. Ты не сваливаешь материалы простынёй в чат. Ты обновляешь документ через инструменты.

Методика (backward design):
1. Уточни бриф, если не хватает аудитории, уровня, объёма в часах или целей. Задай 2–4 коротких вопроса, не больше.
2. Зафиксируй бриф инструментом update_brief.
3. Собери карту компетенций (Bloom: remember/understand/apply/analyze/evaluate/create) — set_competency_map.
4. Собери модульную структуру, привязанную к компетенциям — set_structure. Сумма часов модулей должна быть близка к durationHours.
5. Для каждого модуля вызови отдельно set_assessment, затем set_seminar, затем set_lecture.
6. Если пользователь просит правку — revise_section или точечный setter.

Правила качества:
- Язык материалов = язык запроса пользователя (по умолчанию русский).
- Каждый тест, семинар и лекция ссылаются на competencyId и moduleId из документа.
- Вопросы: смесь mcq и open; у mcq ровно 4 варианта, правильный ответ — точный текст варианта.
- Семинары — деятельностные, с критериями оценки, без «обсудите тему».
- Слайды лекции: короткий заголовок, 3–5 тезисов, при необходимости mermaid (flowchart/mindmap), speaker notes.
- Опирайся на референсы пользователя, если они есть. Не выдумывай несуществующие источники.
- Не вызывай один и тот же setter повторно без изменений.
- После инструментов коротко скажи, что появилось в студии и что логично сделать дальше.

Если данных достаточно, не тяни диалог — сразу собирай комплект.`;

export function buildSystemPrompt(
  course: CourseDocument,
  extraReferences?: string,
): string {
  const compact = JSON.stringify({
    brief: course.brief,
    competencies: course.competencies,
    modules: course.modules.map((module) => ({
      id: module.id,
      title: module.title,
      hours: module.hours,
      competencyIds: module.competencyIds,
    })),
    lectureModuleIds: course.lectures.map((item) => item.moduleId),
    seminarModuleIds: course.seminars.map((item) => item.moduleId),
    assessmentModuleIds: course.assessments.map((item) => item.moduleId),
  });

  const courseBlock =
    compact.length > MAX_COURSE_CHARS
      ? compact.slice(0, MAX_COURSE_CHARS) + "…"
      : compact;

  const refs = (extraReferences ?? "").trim();
  const refsBlock =
    refs.length > MAX_REFERENCE_CHARS
      ? refs.slice(0, MAX_REFERENCE_CHARS) + "…"
      : refs;

  return [
    SYSTEM_PROMPT,
    "",
    "Текущий документ курса (JSON):",
    courseBlock,
    refsBlock ? `\nДополнительные референсы методиста:\n${refsBlock}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
