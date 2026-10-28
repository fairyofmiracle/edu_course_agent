import { describe, expect, it } from "vitest";
import { SAMPLE_COURSE } from "@/lib/sample-course";
import { generatedText, isConfirmedStatus, isReferenceConfirmed, sourceConfidence, verbatimSpans } from "@/lib/verbatim";

describe("verbatimSpans", () => {
  it("ловит дословное окно из примечания референса", () => {
    const course = structuredClone(SAMPLE_COURSE);
    const fragment =
      "слушатель собирает учебный план и сверяет часы модулей с объёмом программы перед печатью";
    course.brief.references[0].note = fragment;
    course.lectures[0].slides[0].bullets[0] = fragment;
    const hits = verbatimSpans(course);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]).toContain("учебный план");
  });

  it("не склеивает окно из двух коротких буллетов и не берёт 11 слов", () => {
    const course = structuredClone(SAMPLE_COURSE);
    const words = Array.from({ length: 12 }, (_, index) => `слово${index}`);
    course.brief.references[0].note = words.join(" ");
    course.lectures[0].slides[0].bullets[0] = words.slice(0, 11).join(" ");
    expect(verbatimSpans(course)).toEqual([]);
    course.lectures[0].slides[0].bullets = [words.slice(0, 6).join(" "), words.slice(6).join(" ")];
    expect(verbatimSpans(course)).toEqual([]);
  });

  it("ловит копию в критерии задания и в ответе теста", () => {
    const course = structuredClone(SAMPLE_COURSE);
    const fragment = Array.from({ length: 12 }, () => "фрагмент").join(" ");
    course.brief.references[0].note = fragment;
    course.lectures = [];
    course.seminars[0].tasks[0].criteria[0] = fragment;
    expect(verbatimSpans(course).length).toBeGreaterThan(0);

    course.seminars = [];
    course.assessments[0].questions[0].answer = fragment;
    expect(verbatimSpans(course).length).toBeGreaterThan(0);
  });

  it("не считает ссылку подтверждённым источником", () => {
    const confidence = sourceConfidence(SAMPLE_COURSE);
    expect(confidence.level).toBe("средняя");
    expect(confidence.summary).toContain("Не подтверждены");
    expect(confidence.copies).toEqual([]);
  });

  it("файл без ссылки поднимает уверенность, три одинаковых окна не копит дальше", () => {
    const course = structuredClone(SAMPLE_COURSE);
    course.brief.references = [{ title: "Стандарт", source: "профстандарт.pdf", note: "" }];
    const quiet = sourceConfidence(course);
    expect(quiet.level).toBe("высокая");
    expect(quiet.summary).toContain("Непроверенных источников нет");
    expect(generatedText(course).length).toBeGreaterThan(0);

    const words = ["альфа", "бета", "гамма", "дельта", "эпсилон", "дзета", "эта", "тета", "йота", "каппа", "лямбда", "мю"];
    const one = words.join(" ");
    const two = words.map((word) => `${word}ы`).join(" ");
    const three = words.map((word) => `${word}а`).join(" ");
    const four = words.map((word) => `${word}у`).join(" ");
    course.brief.references[0].note = [one, two, three, four].join(" ");
    course.lectures[0].slides[0].bullets = [one, two, three, four];
    expect(verbatimSpans(course)).toHaveLength(3);
    expect(sourceConfidence(course).level).toBe("низкая");
    expect(sourceConfidence(course).summary).toContain("Дословный фрагмент");
  });
});


describe("reference confirmation", () => {
  it("файл методиста и явный status считаются подтверждёнными", () => {
    expect(isReferenceConfirmed({ source: "профстандарт.pdf" })).toBe(true);
    expect(isReferenceConfirmed({ source: "https://example.org", status: "confirmed" })).toBe(true);
    expect(isReferenceConfirmed({ source: "https://example.org" })).toBe(false);
    expect(isConfirmedStatus("source_attached")).toBe(true);
  });
});
