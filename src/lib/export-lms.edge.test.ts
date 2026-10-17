import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyCourse, type CourseDocument } from "@/lib/course-schema";
import { courseToMoodleXml, exportCourseMoodle } from "@/lib/export-moodle";
import { courseToCsv, courseToGift, exportCourseCsv, exportCourseGift } from "@/lib/export-tests";

function wellFormed(xml: string) {
  const withoutCdata = xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  const stack: string[] = [];
  for (const tag of withoutCdata.matchAll(/<\/?([A-Za-z0-9_:-]+)(?:\s[^>]*)?>/g)) {
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

function courseWith(question: Record<string, unknown>, module: { id?: string; title?: string } = {}) {
  const course = createEmptyCourse();
  course.brief.title = "Сети";
  course.modules = [
    {
      id: module.id ?? "m1",
      title: module.title ?? "Коммутация",
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
      moduleId: module.id ?? "m1",
      questions: [question as CourseDocument["assessments"][number]["questions"][number]],
    },
  ];
  return course;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("краевые случаи выгрузки", () => {
  it("пустой курс не падает и оставляет только оболочку файла", () => {
    const course = createEmptyCourse();

    const xml = courseToMoodleXml(course);
    const gift = courseToGift(course);
    const csv = courseToCsv(course);

    expect(wellFormed(xml)).toBe(true);
    expect(xml).not.toContain("<question");
    expect(gift.trim().startsWith("// GIFT")).toBe(true);
    expect(gift).not.toContain("$CATEGORY:");
    expect(csv.split("\n").filter(Boolean)).toHaveLength(1);
  });

  it("принимает курс без брифа, модулей и списка вопросов", () => {
    const course = {} as CourseDocument;

    const withQuestion = {
      assessments: [{ moduleId: "m1", questions: [] }],
    } as unknown as CourseDocument;

    expect(() => courseToMoodleXml(course)).not.toThrow();
    expect(() => courseToGift(course)).not.toThrow();
    expect(() => courseToCsv(course)).not.toThrow();
    expect(courseToMoodleXml(withQuestion)).toContain("$course$/Программа/");
    expect(courseToGift(withQuestion)).toContain("$CATEGORY: Программа/");
  });

  it("подставляет идентификатор, если модуль не найден или без названия", () => {
    const missing = courseWith(
      { type: "open", stem: "Вопрос", answer: "Ключ", explanation: "", learningOutcome: "", competencyId: "" },
      { id: "lost", title: "Не этот" },
    );
    missing.assessments[0].moduleId = "absent";
    missing.modules = [];

    const blank = courseWith(
      { type: "open", stem: "Вопрос", answer: "Ключ", explanation: "Пояснение", learningOutcome: "Результат", competencyId: "c1" },
      { id: "", title: "   " },
    );

    expect(courseToMoodleXml(missing)).toContain("absent");
    expect(courseToGift(missing)).toContain("$CATEGORY: Сети/absent");
    expect(courseToCsv(missing).split("\n")[1]?.startsWith("absent,")).toBe(true);
    expect(courseToMoodleXml(blank)).toContain("Без названия");
    expect(courseToGift(blank)).toContain("$CATEGORY: Сети/Без названия");
  });

  it("не объявляет чужой вариант верным, если ключа нет", () => {
    const course = courseWith({
      type: "mcq",
      stem: "Вопрос",
      options: ["  ", "отвлекающий", "отвлекающий"],
      answer: "   ",
      explanation: "Пояснение",
      learningOutcome: "   ",
      competencyId: "",
    });

    const xml = courseToMoodleXml(course);
    const gift = courseToGift(course);

    expect(wellFormed(xml)).toBe(true);
    expect(xml).not.toContain('fraction="100"');
    expect(xml).toContain('fraction="0"');
    expect(xml).not.toContain("<tags>");
    expect(gift).not.toContain("=отвлекающий");
    expect(gift.match(/~отвлекающий/g)).toHaveLength(2);
  });

  it("не повторяет ключ и отбрасывает пустые варианты", () => {
    const course = courseWith({
      type: "mcq",
      stem: "Вопрос",
      options: ["ключ", "  ", "другой"],
      answer: "ключ",
      explanation: "Пояснение",
      learningOutcome: "Результат",
      competencyId: "c1",
    });

    const xml = courseToMoodleXml(course);

    expect(xml.match(/fraction="100"/g)).toHaveLength(1);
    expect(xml.match(/<answer /g)).toHaveLength(2);
  });

  it("режет длинные названия и экранирует слэш, двоеточие и разрыв CDATA", () => {
    const course = courseWith(
      {
        type: "open",
        stem: `${"я".repeat(220)} ]]> конец`,
        answer: "ключ\nсо\nпереносом",
        explanation: "пояснение",
        learningOutcome: "результат\nобучения",
        competencyId: "c1",
      },
      { id: "m1", title: "Модуль/А: часть" },
    );
    course.brief.title = "Курс/Б: тема";

    const xml = courseToMoodleXml(course);
    const gift = courseToGift(course);
    const giftTitle = gift.match(/::(.*)::/)?.[1] ?? "";

    expect(wellFormed(xml)).toBe(true);
    expect(xml).toContain("]]&gt;");
    expect(xml).toContain("$course$/Курс / Б: тема/Модуль / А: часть");
    expect(giftTitle.length).toBe(180);
    expect(giftTitle).not.toContain("я".repeat(200));
    expect(gift).toContain("::Модуль/А— часть.");
    expect(gift).toContain("// Ключ: ключ со переносом");
    expect(gift).toContain("// Результат: результат обучения");
  });

  it("экранирует все служебные знаки GIFT и кавычки с переводом строки в CSV", () => {
    const course = courseWith({
      type: "mcq",
      stem: "A \\ B ~ C = D # E { F }",
      options: ["один", "два", "три", "четыре", "пять", "шесть", "седьмой лишний"],
      answer: 'верно, "да"\r\nи ещё',
      explanation: "почему # так",
      learningOutcome: "умеет",
      competencyId: "c1",
    });

    const gift = courseToGift(course);
    const csv = courseToCsv(course);

    expect(gift).toContain("A \\\\ B \\~ C \\= D \\# E \\{ F \\}");
    expect(gift).toContain('=верно, "да" и ещё #почему \\# так');
    expect(csv).toContain('"верно, ""да""');
    expect(csv).toContain("\nи ещё");
    expect(csv).not.toContain("седьмой лишний");
  });

  it("пропускает отсутствующий список вопросов и варианты не строками", () => {
    const course = {
      brief: { title: "Сети" },
      assessments: [
        { moduleId: "m1" },
        {
          moduleId: "m1",
          questions: [
            {
              type: "mcq",
              stem: "Вопрос",
              answer: "ключ",
              options: null,
              explanation: "Пояснение",
              learningOutcome: "Результат",
              competencyId: "c1",
            },
            {
              type: "mcq",
              stem: "Второй",
              answer: "ключ",
              options: ["ключ", 1, null],
              explanation: "Пояснение",
              learningOutcome: "Результат",
              competencyId: "c1",
            },
          ],
        },
      ],
    } as unknown as CourseDocument;

    expect(courseToMoodleXml(course).match(/<answer /g)).toHaveLength(2);
    expect(courseToGift(course)).toContain("=ключ");
    expect(courseToGift(course)).not.toContain("~1");
    expect(courseToCsv(course)).toContain("m1,mcq,Вопрос");
  });

  it("неизвестный тип вопроса уходит в открытый формат", () => {
    const course = courseWith({
      type: "other",
      stem: "Свободный ответ",
      answer: "Ключ",
      explanation: "Пояснение",
      learningOutcome: "Результат",
      competencyId: "c9",
    });

    expect(courseToMoodleXml(course)).toContain('type="essay"');
    expect(courseToGift(course)).toContain("####Пояснение");
    expect(courseToCsv(course)).toContain("other,");
  });
});

describe("исключения при скачивании", () => {
  it("без document выгрузка бросает TypeError и не пишет файл", () => {
    const course = createEmptyCourse();

    expect(() => exportCourseMoodle(course)).toThrow(ReferenceError);
    expect(() => exportCourseGift(course)).toThrow(/document is not defined/);
    expect(() => exportCourseCsv(course)).toThrow(ReferenceError);
  });

  it("ошибка создания ссылки доходит до вызывающего кода", () => {
    vi.stubGlobal("Blob", class {
      constructor(public parts: BlobPart[]) {
        this.parts = parts;
      }
    });
    vi.stubGlobal("URL", {
      createObjectURL: () => {
        throw new Error("браузер не выдал ссылку");
      },
      revokeObjectURL: () => undefined,
    });
    vi.stubGlobal("document", { createElement: () => ({ click() {} }) });

    expect(() => exportCourseGift(createEmptyCourse())).toThrow("браузер не выдал ссылку");
  });

  it("кладёт в имя файла формат и запасное имя, если заголовок нельзя превратить в имя", () => {
    const downloads: string[] = [];
    vi.stubGlobal("Blob", class {
      constructor(public parts: BlobPart[]) {
        this.parts = parts;
      }
    });
    vi.stubGlobal("URL", {
      createObjectURL: () => "blob:lms",
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal("document", {
      createElement: () => {
        const link = {
          href: "",
          download: "",
          click() {
            downloads.push(this.download);
          },
        };
        return link;
      },
    });

    const empty = createEmptyCourse();
    const symbols = createEmptyCourse();
    symbols.brief.title = "???";
    const named = createEmptyCourse();
    named.brief.title = `${"а".repeat(80)} 24`;

    exportCourseMoodle(empty);
    exportCourseGift(symbols);
    exportCourseCsv(named);

    expect(downloads).toEqual([
      "course-moodle.xml",
      "course-tests.gift.txt",
      `${"а".repeat(60)}-tests.csv`,
    ]);
  });
});
