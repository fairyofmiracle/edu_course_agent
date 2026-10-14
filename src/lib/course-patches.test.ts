import { describe, expect, it } from "vitest";
import { applyPatch } from "@/lib/course-patches";
import { createEmptyCourse } from "@/lib/course-schema";
import { kindSum, roundHours } from "@/lib/hours-balance";

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
    const sum = roundHours(course.modules.reduce((total, module) => total + module.hours, 0));
    expect(sum).toBe(70);
    expect(course.modules[1].competencyIds).toEqual(["c1"]);
    for (const module of course.modules) {
      expect(kindSum(module)).toBe(module.hours);
      expect(module.plan.length).toBeGreaterThan(0);
    }
  });
});
