// Прогон открытых запросов кейса через POST /api/run.
// node scripts/run-cases.mjs [номера через запятую] [адрес студии]
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const only = (process.argv[2] ?? "1,2,3,4,5").split(",").map(Number);
const base = process.argv[3] ?? "http://localhost:3010";

const material = (name) => readFile(path.join(root, "materials", name), "utf8");

const CASES = [
  {
    id: 1,
    request:
      "Нужна дополнительная общеразвивающая программа «Первые шаги в Python» для школьников 8 и 9 классов без опыта программирования. Объем 16 часов, занятия очно по 2 часа два раза в неделю. Практики должно быть не меньше половины всех часов. В конце каждый ученик защищает небольшой проект, например простую игру или чат-бота. Нужны итоговый тест на 10 вопросов и слайды для первых двух занятий.",
    references: () => material("program-general-24h.txt"),
  },
  {
    id: 2,
    request:
      "Программа повышения квалификации «Искусственный интеллект в работе учителя» для учителей школ Ингушетии, 36 часов, очно-заочно с применением дистанционных технологий. Учителя должны научиться готовить с помощью нейросетей планы уроков, задания и проверочные работы, а также понимать риски и правила безопасного использования ИИ в работе с детьми. Итоговая аттестация в форме зачёта по портфолио из трёх материалов, созданных с помощью ИИ. Использовать только сервисы, которые доступны в России.",
    references: () => material("program-qualification-248h.txt"),
  },
  {
    id: 3,
    request:
      "Нужна программа повышения квалификации на 72 часа «Анализ данных на Python» для сотрудников региональных отделений банков, которые сейчас работают в Excel. Формат очно-заочный, срок 4 недели. Основные темы это pandas, визуализация, SQL для выгрузки данных и основы статистики. Итоговая аттестация в виде защиты проекта на обезличенных банковских данных. Прикладываю нашу прошлую программу, структуру можно взять оттуда, но содержание нужно новое. Слайды нужны для модуля про pandas.",
    references: () => material("program-qualification-248h.txt"),
  },
  {
    id: 4,
    request:
      "Сделайте курс по кибербезопасности для студентов колледжа, примерно на месяц, чтобы после него ребята могли пойти работать в эту сферу.",
    answers:
      "Тип программы: повышение квалификации. Объём: 72 часа. Слушатели: студенты 3 курса специальности «Информационные системы и программирование», знают основы сетей и Linux. Форма обучения: очная, занятия на базе колледжа. Итоговая аттестация: экзамен с практическим заданием на стенде. Остальное на ваше усмотрение.",
  },
  {
    id: 5,
    request:
      "Нужна программа повышения квалификации в форме стажировки «DevOps-инженер от Linux до CI/CD» на 256 часов. Слушатели проходят стажировку в ИТ-компаниях региона, вся работа самостоятельная под руководством наставника от компании, аудиторных занятий нет. Итоговая аттестация занимает 2 часа и проходит в форме защиты отчёта о стажировке. Срок около двух месяцев, не больше 4 часов в день. Возьмите за образец структуры нашу стажировку по бизнес-анализу.",
    references: () => material("program-qualification-248h.txt"),
  },
];

const outDir = path.join(root, "logs", "cases");
await mkdir(outDir, { recursive: true });

for (const item of CASES.filter((entry) => only.includes(entry.id))) {
  const started = Date.now();
  process.stdout.write(`Запрос ${item.id}… `);
  let payload;
  try {
    const response = await fetch(`${base}/api/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caseId: item.id,
        request: item.request,
        answers: item.answers,
        references: item.references ? await item.references() : undefined,
      }),
    });
    payload = await response.json();
  } catch (error) {
    console.log(`сеть: ${error.message}`);
    continue;
  }
  const seconds = Math.round((Date.now() - started) / 1000);
  await writeFile(path.join(outDir, `case-${item.id}.json`), JSON.stringify(payload, null, 2), "utf8");
  const responseError = payload.error ?? payload.detail;
  if (responseError && !payload.course) {
    console.log(`ошибка за ${seconds} с: ${responseError}`);
    continue;
  }
  const { course, report, transcript } = payload;
  const error = responseError;
  const failed = (report?.checks ?? []).filter((check) => !check.ok).map((check) => check.label);
  const auditFailed = (report?.audit?.items ?? [])
    .filter((check) => check.status === "fail")
    .map((check) => check.label);
  const sum = course.modules.reduce((total, module) => total + module.hours, 0) + course.brief.attestationHours;
  console.log(`${seconds} с${error ? `, ошибка: ${error}` : ""}`);
  console.log(
    [
      `  шаблон ${course.brief.programKind}, часы ${sum} из ${course.brief.durationHours}, модулей ${course.modules.length}`,
      `  тестов ${course.assessments.length}, семинаров ${course.seminars.length}, лекций ${course.lectures.length}`,
      `  вопросы до каркаса: ${report?.askedQuestions ? "да" : "нет"}`,
      failed.length ? `  не прошли: ${failed.join("; ")}` : "  проверки каркаса зелёные",
      auditFailed.length ? `  не прошли аудит: ${auditFailed.join("; ")}` : "  аудит без ошибок",
      report?.modulesWithoutKit?.length ? `  модули без комплекта: ${report.modulesWithoutKit.join(", ")}` : "",
      ...(transcript ?? []).map(
        (turn, index) =>
          `  ход ${index + 1} [${turn.mode}] ${turn.steps.join(" → ")}${turn.toolErrors ? ` | ошибки: ${turn.toolErrors.join("; ").slice(0, 300)}` : ""}`,
      ),
    ]
      .filter(Boolean)
      .join("\n"),
  );
}
