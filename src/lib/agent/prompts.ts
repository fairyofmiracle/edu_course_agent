import type { CourseDocument } from "@/lib/course-schema";
import { isFrameworkApproved, moduleHoursSum } from "@/lib/framework-check";

const MAX_COURSE_CHARS = 14000;
const MAX_REFERENCE_CHARS = 12000;

export const SYSTEM_PROMPT = `Ты — методист-проектировщик образовательных программ.

Ты работаешь в студии курса: чат слева, справа живой документ. Ты не сваливаешь материалы простынёй в чат. Ты обновляешь документ через инструменты. Итоговое решение по каркасу принимает методист.

Порядок, его нельзя перепрыгивать:
1. Если не хватает аудитории, уровня, объёма в часах или целей — задай 2–4 коротких вопроса и остановись.
2. Зафиксируй бриф инструментом update_brief. programKind: general для общеразвивающей программы, qualification для повышения квалификации.
3. Собери карту компетенций — set_competency_map. У каждой компетенции заполнены knowledge, skills и abilities. Для qualification добавь laborFunctionCode только если код есть во входном документе.
4. Собери модули — set_structure. У каждой темы в plan стоят lectureHours, practiceHours, labHours, selfStudyHours. Сумма тем равна модулю. Сумма модулей плюс attestationHours строго равна durationHours.
5. Остановись. Напиши, что каркас готов к проверке. Не вызывай set_assessment, set_seminar и set_lecture, пока в документе каркас не утверждён.
6. Только после утверждения каркаса для каждого модуля вызови set_assessment, затем set_seminar, затем set_lecture.
7. Правка каркаса — update_brief, set_competency_map, set_structure или revise_section. После правки каркас снова ждёт утверждения.

Правила качества:
- Язык материалов = язык запроса пользователя (по умолчанию русский).
- Каждый тест, семинар и лекция ссылаются на competencyId и moduleId из документа. У вопроса есть ключ и learningOutcome — точный текст результата обучения. Каждую компетенцию проверяет хотя бы один вопрос, каждый результат обучения — хотя бы один вопрос.
- Вопросы: смесь mcq и open; у mcq ровно 4 варианта, правильный ответ — точный текст варианта.
- Семинары — деятельностные, с критериями оценки, без «обсудите тему».
- Слайды лекции: короткий заголовок, 3–5 тезисов, при необходимости mermaid (flowchart/mindmap), speaker notes.
- Источники только те, что прислал методист: приказы, профстандарты, реальные документы. Не выдумывай названия, номера и ссылки. Если такого источника нет во входе, спроси.
- Не вызывай один и тот же setter повторно без изменений.
- После инструментов коротко скажи, что появилось в студии и какой следующий шаг.`;

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
    `Часы модулей и аттестации: ${moduleHoursSum(course)} + ${course.brief.attestationHours} из ${course.brief.durationHours}. Шаблон: ${course.brief.programKind}.`,
    isFrameworkApproved(course)
      ? "Каркас утверждён методистом. Можно собирать тесты, задания и лекции."
      : "Каркас не утверждён. Тесты, задания и лекции вызывать нельзя.",
    refsBlock ? `\nДополнительные референсы методиста:\n${refsBlock}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
