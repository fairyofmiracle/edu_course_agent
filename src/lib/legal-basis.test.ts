import { describe, expect, it } from "vitest";
import { auditCourse } from "@/lib/course-audit";
import { applyPatch } from "@/lib/course-patches";
import { createEmptyCourse } from "@/lib/course-schema";
import { LAW_273, ORDER_266, ORDER_499, ORDER_629 } from "@/lib/legal-basis";
import { SAMPLE_COURSE } from "@/lib/sample-course";

describe("обязательные основания", () => {
  it("держит названия в пределах схемы", () => {
    for (const document of [LAW_273, ORDER_629, ORDER_266, ORDER_499]) {
      expect(document.title.length).toBeLessThanOrEqual(200);
      expect(document.note.length).toBeLessThanOrEqual(1500);
    }
  });

  it("пример общеразвивающей программы уже ссылается на приказ № 629", () => {
    expect(SAMPLE_COURSE.brief.references.some((reference) => reference.source === ORDER_629.source)).toBe(
      true,
    );
    expect(auditCourse(SAMPLE_COURSE).items.find((item) => item.id === "basis.order-629")).toBeUndefined();
  });

  it("при выборе вида подставляет официальную ссылку и не затирает источник методиста", () => {
    const course = applyPatch(createEmptyCourse(), {
      type: "update_brief",
      brief: {
        programKind: "general",
        title: "Курс",
        audience: "Слушатели",
        durationHours: 16,
        references: [{ title: "Файл методиста", source: "https://example.org/brief" }],
      },
    });
    expect(course.brief.references.map((reference) => reference.source)).toEqual([
      ORDER_629.source,
      "https://example.org/brief",
    ]);
  });

  it("для повышения квалификации требует 273-ФЗ и приказ № 266 и предупреждает про № 499", () => {
    const course = applyPatch(createEmptyCourse(), {
      type: "update_brief",
      brief: {
        programKind: "qualification",
        title: "Курс",
        audience: "Преподаватели",
        durationHours: 36,
      },
    });
    const sources = course.brief.references.map((reference) => reference.source);
    expect(sources).toContain(LAW_273.source);
    expect(sources).toContain(ORDER_266.source);
    const report = auditCourse({
      ...course,
      competencies: {
        nodes: [
          {
            id: "c1",
            name: "Анализ",
            bloomLevel: "apply",
            moduleIds: [],
            knowledge: ["а"],
            skills: ["б"],
            abilities: ["в"],
          },
        ],
        edges: [],
      },
    });
    expect(report.items.find((item) => item.id === "basis.fz-273")).toBeUndefined();
    expect(report.items.find((item) => item.id === "basis.order-266")).toBeUndefined();
    expect(report.items.find((item) => item.id === "basis.order-499")).toMatchObject({
      status: "warning",
    });
    expect(report.items.find((item) => item.id === "basis.labor-codes")?.status).toBe("warning");
  });

  it("упоминание приказа № 499 не закрывает отсутствие приказа № 266", () => {
    const course = createEmptyCourse();
    course.brief.programKind = "qualification";
    course.brief.references = [
      { title: ORDER_499.title, source: ORDER_499.source, note: ORDER_499.note },
    ];
    const report = auditCourse(course);
    expect(report.items.find((item) => item.id === "basis.order-266")?.status).toBe("fail");
    expect(report.items.find((item) => item.id === "basis.order-499")?.details).toContain(
      "указан в источниках",
    );
  });
});
