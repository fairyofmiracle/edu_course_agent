import { describe, expect, it } from "vitest";
import { applyPatch } from "@/lib/course-patches";
import { createEmptyCourse } from "@/lib/course-schema";
import { kindSum, roundHours } from "@/lib/hours-balance";
import { frameworkItems } from "@/lib/framework-check";

describe("applyPatch structure", () => {
  it("после учебного плана часы сходятся с брифом", () => {
    let course = createEmptyCourse();
    course = applyPatch(course, {
      type: "update_brief",
      brief: {
        title: "Кибербезопасность",
        audience: "колледж",
        programKind: "general",
        durationHours: 72,
        attestationHours: 2,
        attestationForm: "Сертификат",
        goals: ["Packet Tracer"],
      },
    });
    course = applyPatch(course, {
      type: "set_competency_map",
      competencies: {
        nodes: [
          {
            id: "c1",
            name: "Сеть",
            bloomLevel: "apply",
            moduleIds: ["m1"],
            knowledge: ["IP"],
            skills: ["Пинг"],
            abilities: ["Собрать стенд"],
          },
        ],
        edges: [],
      },
    });
    course = applyPatch(course, {
      type: "set_structure",
      modules: [
        {
          id: "m1",
          title: "Сети",
          hours: 10,
          lectureHours: 2,
          practiceHours: 6,
          labHours: 0,
          selfStudyHours: 2,
          topics: ["IP"],
          plan: [],
          learningOutcomes: ["Собирает стенд"],
          competencyIds: ["c1"],
        },
        {
          id: "m2",
          title: "Packet Tracer",
          hours: 10,
          lectureHours: 2,
          practiceHours: 8,
          labHours: 0,
          selfStudyHours: 0,
          topics: ["Cisco"],
          plan: [],
          learningOutcomes: ["Строит схему"],
          competencyIds: [],
        },
      ],
    });
    const sum = roundHours(
      course.modules.reduce((total, courseModule) => total + courseModule.hours, 0),
    );
    expect(sum).toBe(70);
    expect(course.modules[1].competencyIds).toEqual(["c1"]);
    for (const courseModule of course.modules) {
      expect(kindSum(courseModule)).toBe(courseModule.hours);
      expect(courseModule.plan.length).toBeGreaterThan(0);
    }
  });

  it("чинит регистр id и кладёт каждую компетенцию в модуль", () => {
    let course = createEmptyCourse();
    course = applyPatch(course, {
      type: "update_brief",
      brief: { title: "ИИ", audience: "учителя", programKind: "qualification", durationHours: 36 },
    });
    const node = (id: string) => ({
      id,
      name: id,
      bloomLevel: "apply" as const,
      moduleIds: [],
      knowledge: ["з"],
      skills: ["у"],
      abilities: ["н"],
    });
    course = applyPatch(course, {
      type: "set_competency_map",
      competencies: { nodes: [node("C1"), node("C2"), node("C3")], edges: [] },
    });
    course = applyPatch(course, {
      type: "set_structure",
      modules: ["M1", "M2"].map((id) => ({
        id,
        title: id,
        hours: 18,
        lectureHours: 0,
        practiceHours: 0,
        labHours: 0,
        selfStudyHours: 0,
        topics: ["т"],
        plan: [],
        learningOutcomes: ["р"],
        competencyIds: id === "M1" ? ["c1", "c5"] : [],
      })),
    });
    const items = frameworkItems(course);
    expect(items.find((item) => item.id === "known")?.ok).toBe(true);
    expect(items.find((item) => item.id === "links")?.ok).toBe(true);
    expect(course.modules[0].competencyIds).toContain("C1");
    expect(course.modules[0].competencyIds).not.toContain("c5");
  });
});
