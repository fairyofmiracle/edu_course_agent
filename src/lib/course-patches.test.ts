import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import {
  applyPatch,
  foldCourseFromMessages,
  isCoursePatch,
  rebalanceCourse,
} from "@/lib/course-patches";
import { createEmptyCourse } from "@/lib/course-schema";
import { kindSum, roundHours } from "@/lib/hours-balance";
import { frameworkItems } from "@/lib/framework-check";
import { SAMPLE_COURSE } from "@/lib/sample-course";

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

  it("повтор уже записанного модуля не стирает остальные блоки", () => {
    let course = createEmptyCourse();
    course = applyPatch(course, {
      type: "update_brief",
      brief: { title: "Архив", audience: "сотрудники", programKind: "general", durationHours: 120 },
    });
    const row = (id: string, title: string) => ({
      id,
      title,
      hours: 40,
      lectureHours: 10,
      practiceHours: 20,
      labHours: 0,
      selfStudyHours: 10,
      topics: ["тема"],
      plan: [],
      learningOutcomes: ["умеет"],
      competencyIds: ["c1"],
    });
    course = applyPatch(course, {
      type: "set_structure",
      modules: [row("1", "Первый"), row("2", "Второй")],
    });
    course = applyPatch(course, {
      type: "set_structure",
      modules: [row("1", "Первый, правка"), row("3", "Третий")],
    });
    expect(course.modules.map((item) => item.id)).toEqual(["1", "2", "3"]);
    expect(course.modules[0]?.title).toBe("Первый, правка");
    expect(course.modules[1]?.title).toBe("Второй");
    expect(
      applyPatch(course, { type: "set_structure", modules: [] }).modules.map((item) => item.id),
    ).toEqual(["1", "2", "3"]);
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

  it("кладёт лекцию, семинар и тест и отбрасывает кривую правку", () => {
    const course = createEmptyCourse();
    const lecture = SAMPLE_COURSE.lectures[0];
    const seminar = SAMPLE_COURSE.seminars[0];
    const assessment = SAMPLE_COURSE.assessments[0];
    const withLecture = applyPatch(course, { type: "set_lecture", lecture });
    const withSeminar = applyPatch(withLecture, { type: "set_seminar", seminar });
    const withTest = applyPatch(withSeminar, { type: "set_assessment", assessment });
    expect(withTest.lectures).toHaveLength(1);
    expect(withTest.seminars).toHaveLength(1);
    expect(withTest.assessments).toHaveLength(1);
    const replaced = applyPatch(withTest, { type: "set_lecture", lecture: { ...lecture, durationMin: 40 } });
    expect(replaced.lectures).toHaveLength(1);
    expect(replaced.lectures[0]?.durationMin).toBe(40);

    expect(applyPatch(course, { type: "revise_section", section: "brief", data: { title: 12 } })).toBe(course);
    expect(
      applyPatch(course, { type: "revise_section", section: "structure", data: { modules: "нет" } }),
    ).toBe(course);
    const renamed = applyPatch(course, {
      type: "revise_section",
      section: "brief",
      data: { title: "После правки", audience: "группа" },
    });
    expect(renamed.brief.title).toBe("После правки");
    expect(isCoursePatch(null)).toBe(false);
    expect(isCoursePatch({ type: "set_lecture" })).toBe(true);
    expect(rebalanceCourse(course)).toBe(course);
  });

  it("собирает курс из завершённых вызовов и пропускает чужой результат", () => {
    const fallback = createEmptyCourse();
    const skipped = foldCourseFromMessages(
      [
        {
          id: "1",
          role: "assistant",
          parts: [
            {
              type: "tool-update_brief",
              toolCallId: "bad",
              state: "output-available",
              input: {},
              output: { type: "not_a_patch" },
            },
          ],
        } as UIMessage,
      ],
      fallback,
    );
    expect(skipped).toBe(fallback);

    const folded = foldCourseFromMessages(
      [
        {
          id: "2",
          role: "assistant",
          parts: [
            {
              type: "tool-update_brief",
              toolCallId: "ok",
              state: "output-available",
              input: {},
              output: {
                type: "update_brief",
                brief: { title: "Собранный", audience: "группа", durationHours: 16 },
              },
            },
          ],
        } as UIMessage,
      ],
      fallback,
    );
    expect(folded.brief.title).toBe("Собранный");
    expect(folded.brief.durationHours).toBe(16);
  });

  it("правит компетенции, лекцию и выравнивает уже собранный курс", () => {
    const lecture = { ...SAMPLE_COURSE.lectures[0], moduleId: "" };
    const revised = applyPatch(createEmptyCourse(), {
      type: "revise_section",
      section: "lecture",
      moduleId: SAMPLE_COURSE.lectures[0].moduleId,
      data: lecture,
    });
    expect(revised.lectures[0]?.moduleId).toBe(SAMPLE_COURSE.lectures[0].moduleId);

    const seminar = applyPatch(revised, {
      type: "revise_section",
      section: "seminar",
      data: SAMPLE_COURSE.seminars[0],
    });
    const tested = applyPatch(seminar, {
      type: "revise_section",
      section: "assessment",
      data: SAMPLE_COURSE.assessments[0],
    });
    const mapped = applyPatch(tested, {
      type: "revise_section",
      section: "competencies",
      data: SAMPLE_COURSE.competencies,
    });
    expect(mapped.seminars).toHaveLength(1);
    expect(mapped.assessments).toHaveLength(1);
    expect(mapped.competencies.nodes.length).toBeGreaterThan(0);

    const wrapped = applyPatch(createEmptyCourse(), {
      type: "revise_section",
      section: "structure",
      data: { modules: SAMPLE_COURSE.modules },
    });
    expect(wrapped.modules.length).toBe(SAMPLE_COURSE.modules.length);
    expect(rebalanceCourse(SAMPLE_COURSE).brief.durationHours).toBe(24);
    expect(
      applyPatch(createEmptyCourse(), {
        type: "revise_section",
        section: "lecture",
        data: { moduleId: "m1" },
      }).lectures,
    ).toEqual([]);
  });
});
