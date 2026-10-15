import { describe, expect, it } from "vitest";
import { auditCourse, outcomeInstrumentGaps, type OpenCaseId } from "@/lib/course-audit";
import { SAMPLE_COURSE } from "@/lib/sample-course";

const copy = () => structuredClone(SAMPLE_COURSE);
const result = (caseId: OpenCaseId, id: string, course = copy()) =>
  auditCourse(course, caseId).items.find((item) => item.id === id);

describe("auditCourse", () => {
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
    expect(result(1, "case.1.questions", course)?.status).toBe("fail");
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
});
