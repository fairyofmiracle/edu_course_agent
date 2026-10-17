import { describe, expect, it } from "vitest";
import { createEmptyCourse } from "@/lib/course-schema";
import { courseToMoodleXml } from "@/lib/export-moodle";
import { courseToCsv, courseToGift } from "@/lib/export-tests";
import { SAMPLE_COURSE } from "@/lib/sample-course";

function wellFormed(xml: string) {
  const withoutCdata = xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  const tags = withoutCdata.matchAll(/<\/?([A-Za-z0-9_:-]+)(?:\s[^>]*)?>/g);
  const stack: string[] = [];
  for (const tag of tags) {
    const raw = tag[0];
    if (raw.endsWith("/>")) continue;
    if (raw.startsWith("</")) {
      if (stack.pop() !== tag[1]) return false;
    } else {
      stack.push(tag[1]);
    }
  }
  return stack.length === 0;
}

describe("Moodle XML", () => {
  it("выгружает пример: ключ выбора, ключ открытого вопроса и результат обучения", () => {
    const xml = courseToMoodleXml(SAMPLE_COURSE);
    const questions = SAMPLE_COURSE.assessments.flatMap((assessment) => assessment.questions);

    expect(wellFormed(xml)).toBe(true);
    expect(xml.match(/<question type="category">/g)).toHaveLength(SAMPLE_COURSE.assessments.length);
    expect(xml.match(/<question type="multichoice">/g)?.length).toBe(
      questions.filter((question) => question.type === "mcq").length,
    );
    expect(xml.match(/<question type="essay">/g)?.length).toBe(
      questions.filter((question) => question.type === "open").length,
    );
    expect(xml).toContain("Какие 20 тикетов поддержки разобрать первыми?");
    expect(xml).toContain('fraction="100"');
    expect(xml).toContain("Ключ: Например, «сколько заявок закрыли вчера по регионам»");
    expect(xml).toContain("Классифицирует бизнес-вопрос по типу ИИ-задачи");
    expect(xml).toContain("$course$/ИИ для аналитиков: от данных к решению");
  });

  it("сохраняет символ разметки и ключ, которого нет среди вариантов", () => {
    const course = createEmptyCourse();
    course.brief.title = "Сети";
    course.modules = [
      {
        id: "m1",
        title: "Коммутация",
        hours: 16,
        lectureHours: 4,
        practiceHours: 8,
        labHours: 0,
        selfStudyHours: 4,
        topics: ["VLAN"],
        plan: [],
        learningOutcomes: ["Настраивает VLAN"],
        competencyIds: ["c1"],
      },
    ];
    course.assessments = [
      {
        moduleId: "m1",
        questions: [
          {
            type: "mcq",
            stem: "1 < 2 & 3",
            options: ["нет", "другой"],
            answer: "a > b",
            explanation: "Сравнение",
            competencyId: "c1",
            learningOutcome: "Настраивает VLAN",
          },
        ],
      },
    ];

    const xml = courseToMoodleXml(course);

    expect(wellFormed(xml)).toBe(true);
    expect(xml).toContain("1 &lt; 2 &amp; 3");
    expect(xml).toContain("a &gt; b");
    expect(xml.match(/fraction="100"/g)).toHaveLength(1);
    expect(xml).toContain('fraction="0"');
  });
});

describe("GIFT и CSV", () => {
  it("кладёт ключ выбора, ключ открытого вопроса и результат в оба формата", () => {
    const gift = courseToGift(SAMPLE_COURSE);
    const csv = courseToCsv(SAMPLE_COURSE);

    expect(gift).toContain("=Какие 20 тикетов поддержки разобрать первыми?");
    expect(gift).toContain("// Ключ: Например, «сколько заявок закрыли вчера по регионам»");
    expect(gift).toContain("// Результат: Классифицирует бизнес-вопрос по типу ИИ-задачи");
    expect(csv.startsWith("\uFEFFmodule,type,stem,")).toBe(true);
    expect(csv).toContain("Какие 20 тикетов поддержки разобрать первыми?");
    expect(csv).toContain("Классифицирует бизнес-вопрос по типу ИИ-задачи");
    expect(csv.split("\n").filter(Boolean)).toHaveLength(
      1 + SAMPLE_COURSE.assessments.reduce((total, assessment) => total + assessment.questions.length, 0),
    );
  });

  it("экранирует служебные знаки GIFT и кавычки CSV", () => {
    const course = createEmptyCourse();
    course.brief.title = "Сети";
    course.modules = [
      {
        id: "m1",
        title: "Коммутация",
        hours: 16,
        lectureHours: 4,
        practiceHours: 8,
        labHours: 0,
        selfStudyHours: 4,
        topics: ["VLAN"],
        plan: [],
        learningOutcomes: ["Настраивает VLAN"],
        competencyIds: ["c1"],
      },
    ];
    course.assessments = [
      {
        moduleId: "m1",
        questions: [
          {
            type: "mcq",
            stem: "Формула a = b, «тест»",
            options: ["нет", "другой"],
            answer: "a = b",
            explanation: "Сравнение",
            competencyId: "c1",
            learningOutcome: "Настраивает VLAN",
          },
        ],
      },
    ];

    const gift = courseToGift(course);
    const csv = courseToCsv(course);

    expect(gift).toContain("=a \\= b #Сравнение");
    expect(gift).toContain("Формула a \\= b, «тест»");
    expect(csv).toContain('"Формула a = b, «тест»"');
    expect(csv).toContain("a = b");
  });
});
