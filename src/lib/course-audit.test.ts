import { describe, expect, it } from "vitest";
import { auditCourse, methodistNotes, outcomeInstrumentGaps, type OpenCaseId } from "@/lib/course-audit";
import { moduleRationales, passportStamp, resultPassport } from "@/lib/module-rationale";
import { SAMPLE_COURSE } from "@/lib/sample-course";

const copy = () => structuredClone(SAMPLE_COURSE);
const result = (caseId: OpenCaseId, id: string, course = copy()) =>
  auditCourse(course, caseId).items.find((item) => item.id === id);

describe("auditCourse", () => {
  it("код без текста источника не проходит, код из примечания проходит", () => {
    const bare = copy();
    bare.brief.references = [];
    bare.competencies.nodes[0].laborFunctionCode = "A/01.6";
    const missing = auditCourse(bare).items.find((item) => item.id === "sources.codes");
    expect(missing?.status).toBe("fail");

    const sourced = copy();
    sourced.competencies.nodes[0].laborFunctionCode = "A/01.6";
    const loose = auditCourse(sourced).items.find((item) => item.id === "sources.codes");
    expect(loose?.status).toBe("fail");

    sourced.brief.references[0].note = `${sourced.brief.references[0].note ?? ""} Трудовая функция A/01.6`;
    const grounded = auditCourse(sourced).items.find((item) => item.id === "sources.codes");
    expect(grounded?.status).toBe("pass");
    expect(grounded?.details).toContain("A/01.6");
  });

  it("ловит выдуманный номер и не кладёт формулировку слайда в паспорт", () => {
    const course = copy();
    course.lectures[0].slides[0].bullets[0] = "Опираемся на приказ № 999";
    const hit = auditCourse(course).items.find((item) => item.id === "sources.requisites");
    expect(hit?.status).toBe("fail");
    expect(hit?.details).toContain("№ 999");

    course.brief.audience = "Группа на 16 часов";
    course.lectures[0].slides[0].bullets[0] = "Опираемся на приказ № 16 и приказ № 27";
    const borrowed = auditCourse(course).items.find((item) => item.id === "sources.requisites");
    expect(borrowed?.status).toBe("fail");
    expect(borrowed?.details).toContain("№ 16");
    expect(borrowed?.details).toContain("№ 27");
    course.competencies.nodes[0].laborFunctionCode = "A/01.6";
    course.brief.references[0].note = "код A/01.60";
    const prefix = auditCourse(course).items.find((item) => item.id === "sources.codes");
    expect(prefix?.status).toBe("fail");

    const clean = copy();
    const passport = auditCourse(clean).items.find((item) => item.id === "framework.passport");
    expect(passport?.status).toBe("pass");
    expect(passport?.details).toContain("Текст лекции");
    expect(passport?.details).not.toContain("вид=");
    expect(passport?.details).not.toContain(clean.lectures[0].slides[0].title);
    const first = resultPassport(clean);
    clean.lectures[0].slides[0].title = "Совсем другая формулировка слайда";
    expect(resultPassport(clean)).toBe(first);
    expect(first).toMatch(/штамп=[0-9a-f]{8}$/);
  });

  it("штамп паспорта совпадает с расчётом backend", () => {
    expect(passportStamp("студия")).toBe("0e3aa220");
  });

  it("помечает ссылку как неподтверждённую и ловит дословный фрагмент", () => {
    const linked = copy();
    const pending = auditCourse(linked).items.find((item) => item.id === "sources.unconfirmed");
    expect(pending?.status).toBe("warning");
    expect(pending?.details).toContain("Минтруда");
    expect(pending?.details).not.toContain("Минпросвещения");

    const copied = copy();
    const fragment =
      "слушатель собирает учебный план и сверяет часы модулей с объёмом программы перед печатью";
    copied.brief.references[0].note = fragment;
    copied.lectures[0].slides[0].bullets[0] = fragment;
    const hit = auditCourse(copied).items.find((item) => item.id === "sources.verbatim");
    expect(hit?.status).toBe("fail");
  });

  it("обоснование модуля не зависит от текста лекции", () => {
    const course = copy();
    const lines = moduleRationales(course);
    expect(lines[0].text).toContain(course.modules[0].title);
    expect(lines[0].text).toContain("задал методист");
    const item = auditCourse(course).items.find((entry) => entry.id === `framework.why.${course.modules[0].id}`);
    expect(item?.status).toBe("pass");
    expect(item?.details).toContain("ч");
  });

  it("пример 24 ч закрывает каждый результат тестом и заданием", () => {
    const course = copy();
    expect(outcomeInstrumentGaps(course)).toEqual([]);
    expect(auditCourse(course).summary.fail).toBe(0);
  });

  it("показывает конкретный недостающий инструмент", () => {
    const course = copy();
    delete course.seminars[0].tasks[0].learningOutcome;
    const gaps = outcomeInstrumentGaps(course);
    expect(gaps).toContainEqual({
      moduleId: "m1",
      outcome: "Пишет бриф: вход, выход, ограничения, метрика успеха",
      missing: ["практическое задание"],
    });
  });

  it("проверяет запрос 1", () => {
    const course = copy();
    course.brief.durationHours = 16;
    expect(result(1, "case.1.kind", course)?.status).toBe("pass");
    expect(result(1, "case.1.practice", course)?.status).toBe("pass");
    expect(result(1, "case.1.questions", course)?.status).toBe("pass");
  });

  it("проверяет запрос 2", () => {
    const course = copy();
    course.brief.programKind = "qualification";
    course.brief.durationHours = 36;
    course.brief.attestationForm = "Зачёт по портфолио";
    course.brief.constraints.push("Риски и защита персональных данных");
    expect(result(2, "case.2.portfolio", course)?.status).toBe("pass");
    expect(result(2, "case.2.risks", course)?.status).toBe("pass");
  });

  it("проверяет запрос 3", () => {
    const course = copy();
    course.brief.durationHours = 72;
    course.brief.constraints.push("Python, pandas, визуализация, SQL, статистика");
    course.modules[0].title = "Введение в Python и pandas";
    expect(result(3, "case.3.topics", course)?.status).toBe("pass");
    expect(result(3, "case.3.slides", course)?.status).toBe("pass");
  });

  it("проверяет запрос 4", () => {
    const course = copy();
    course.brief.programKind = "qualification";
    course.brief.durationHours = 72;
    course.brief.audience = "Студенты 3 курса колледжа, знают сети и Linux";
    course.brief.attestationForm = "Экзамен с практическим заданием";
    expect(result(4, "case.4.audience", course)?.status).toBe("pass");
    expect(result(4, "case.4.exam", course)?.status).toBe("pass");
  });

  it("проверяет запрос 5", () => {
    const course = copy();
    course.brief.programKind = "qualification";
    course.brief.durationHours = 256;
    course.brief.attestationHours = 2;
    course.modules = [
      {
        ...course.modules[0],
        hours: 254,
        lectureHours: 0,
        practiceHours: 0,
        labHours: 0,
        selfStudyHours: 254,
        topics: ["Linux, сети, контейнеризация, CI/CD, мониторинг, инфраструктура как код"],
      },
    ];
    expect(result(5, "case.5.self", course)?.status).toBe("pass");
    expect(result(5, "case.5.zero", course)?.status).toBe("pass");
    expect(result(5, "case.5.topics", course)?.status).toBe("pass");
  });

  it("календарь в условиях проходит, а не пишет что модели нет", () => {
    const course = copy();
    expect(auditCourse(course).items.find((item) => item.id === "framework.calendar")?.status).toBe(
      "pass",
    );
    course.brief.constraints.push("Календарный график: 8 занятий по 2 часа, 4 недели.");
    course.brief.durationHours = 16;
    expect(result(1, "case.1.calendar", course)?.status).toBe("pass");
    expect(result(1, "case.1.calendar", course)?.details).not.toContain("нет календарного графика");
    const notes = methodistNotes(course);
    expect(notes.some((line) => /календарн/i.test(line))).toBe(true);
  });
});
