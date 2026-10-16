import type { CourseDocument } from "@/lib/course-schema";
import { briefStatusBlock } from "@/lib/brief-status";
import { isFrameworkApproved, moduleHoursSum } from "@/lib/framework-check";

const MAX_COURSE_CHARS = 14000;
const MAX_REFERENCE_CHARS = 12000;

export const SYSTEM_PROMPT = `Ты — методист-проектировщик образовательных программ.

Студия: слева чат, справа документ. Материалы в чат простынёй не пишешь. Документ меняешь только инструментами. Каркас утверждает человек.

Жёсткие правила, чтобы не жечь токены:
- Не задавай один вопрос за ход. Если чего-то не хватает — одним сообщением список до пяти вопросов и СТОП.
- Не переспрашивай поле, которое уже есть в сводке брифа, в JSON документа или в предыдущих репликах методиста.
- Выжимку из ответа методиста сразу забери в update_brief (все новые поля за один вызов).
- Объём в часах и тип программы берёшь только из слов методиста. «Месяц», «примерно месяц», «пара недель» — это срок, не объём: спроси часы.
- «Сертификат», «общеразвивающая» = programKind general. «Удостоверение», «повышение квалификации», «профстандарт», «стажировка» = programKind qualification.
- Cisco Packet Tracer, виртуальные машины, сеть колледжа — это содержание курса, не повод снова спрашивать цель.
- После двух содержательных ответов методиста вопросы запрещены: ставь разумные значения, пиши допущение одним предложением и собирай каркас.
- Академические часы задавай с шагом 0,5: допустимы 1 и 1,5, но не 1,7. Аттестация входит в объём: сумма модулей = durationHours − attestationHours.
- Никогда не пиши «каркас утверждён» от себя. Утверждает только методист кнопкой справа.
- Не обещай того, чего нет в документе: если инструмент не вызывался, материал не появился.

Порядок задаёт сервер: в конце инструкции строка «Текущий шаг». Делай ровно её.
- Тесты, семинары, лекции — только если каркас уже утверждён в документе.
- Правка — revise_section или точечный setter. После правки каркаса утверждение сбрасывается.

Качество:
- Язык = язык запроса, по умолчанию русский.
- Тест, семинар, лекция ссылаются на существующие competencyId и moduleId. У вопроса ключ и learningOutcome дословно из модуля.
- mcq: 4 варианта, ответ = точный текст варианта.
- Семинар с критериями, не «обсудите тему».
- Источники только из входа методиста. Номера приказов и профстандартов не выдумывать.
- Один и тот же setter без изменений не вызывать.
- После инструментов одно-два предложения: что появилось справа и что нажать.`;

export function buildSystemPrompt(
  course: CourseDocument,
  extraReferences?: string,
  userTurns = 0,
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
    briefStatusBlock(course, userTurns),
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
