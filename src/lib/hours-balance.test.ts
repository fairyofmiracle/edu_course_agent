import { describe, expect, it } from "vitest";
import {
  allocateInteger,
  attachCompetencyIds,
  balanceModules,
  fillModulePlan,
  kindSum,
  roundHours,
} from "@/lib/hours-balance";
import type { CourseModule } from "@/lib/course-schema";

function sample(partial: Partial<CourseModule> = {}): CourseModule {
  return {
    id: "m1",
    title: "Сети",
    hours: 10,
    lectureHours: 2,
    practiceHours: 6,
    labHours: 0,
    selfStudyHours: 2,
    topics: ["IP", "VLAN"],
    plan: [],
    learningOutcomes: [],
    competencyIds: ["c1"],
    ...partial,
  };
}

function expectWhole(value: number) {
  expect(Number.isInteger(value)).toBe(true);
  expect(value).toBeGreaterThanOrEqual(0);
}

describe("allocateInteger", () => {
  it("не пишет десятые: 70 часов по весам 12/16/44", () => {
    const next = allocateInteger(70, [12, 16, 44]);
    expect(next.reduce((sum, value) => sum + value, 0)).toBe(70);
    for (const value of next) expectWhole(value);
  });

  it("нулевой вес не получает часы", () => {
    expect(allocateInteger(8, [1, 2, 0, 1])).toEqual([2, 4, 0, 2]);
  });
});

describe("fillModulePlan", () => {
  it("раскладывает виды часов блоками, сумма тем равна модулю", () => {
    const next = fillModulePlan(sample());
    expect(next.plan).toHaveLength(2);
    expect(kindSum(next)).toBe(next.hours);
    expect(next.plan.reduce((sum, row) => sum + kindSum(row), 0)).toBe(next.hours);
    expectWhole(next.hours);
    for (const row of next.plan) {
      expectWhole(row.lectureHours);
      expectWhole(row.practiceHours);
      expectWhole(row.labHours);
      expectWhole(row.selfStudyHours);
    }
    expect(next.learningOutcomes[0]).toMatch(/Сети/);
  });

  it("если виды часов нули, делит объём целыми: практика ≈ половина, без десятых", () => {
    const next = fillModulePlan(
      sample({ lectureHours: 0, practiceHours: 0, labHours: 0, selfStudyHours: 0, hours: 8 }),
    );
    expect(next.hours).toBe(8);
    expect(kindSum(next)).toBe(8);
    expect(next).toMatchObject({
      lectureHours: 2,
      practiceHours: 4,
      labHours: 0,
      selfStudyHours: 2,
    });
  });

  it("не размазывает 8 лекций и 4 лабы по трём темам десятыми", () => {
    const next = fillModulePlan(
      sample({
        hours: 12,
        lectureHours: 8,
        practiceHours: 0,
        labHours: 4,
        selfStudyHours: 0,
        topics: ["Введение", "Сеть", "Packet Tracer"],
      }),
    );
    expect(next.plan.map((row) => kindSum(row)).every((hours) => hours === 4)).toBe(true);
    expect(next.plan.some((row) => !Number.isInteger(row.lectureHours))).toBe(false);
    expect(next.lectureHours).toBe(8);
    expect(next.labHours).toBe(4);
  });
});

describe("balanceModules", () => {
  it("дотягивает сумму модулей до объёма минус аттестация целыми часами", () => {
    const modules = [
      sample({ id: "m1", hours: 10, lectureHours: 2, practiceHours: 6, selfStudyHours: 2 }),
      sample({ id: "m2", hours: 10, lectureHours: 2, practiceHours: 6, selfStudyHours: 2 }),
    ];
    const next = balanceModules(modules, 72, 2);
    const sum = roundHours(next.reduce((total, module) => total + module.hours, 0));
    expect(sum).toBe(70);
    for (const courseModule of next) {
      expectWhole(courseModule.hours);
      expect(kindSum(courseModule)).toBe(courseModule.hours);
    }
  });

  it("12+16+44 при 72/2 не превращает модули в 11,67", () => {
    const next = balanceModules(
      [
        sample({
          id: "m1",
          hours: 12,
          lectureHours: 8,
          practiceHours: 0,
          labHours: 4,
          selfStudyHours: 0,
          topics: ["Введение"],
        }),
        sample({
          id: "m2",
          hours: 16,
          lectureHours: 6,
          practiceHours: 10,
          labHours: 0,
          selfStudyHours: 0,
          topics: ["Сеть"],
        }),
        sample({
          id: "m3",
          hours: 44,
          lectureHours: 16,
          practiceHours: 0,
          labHours: 28,
          selfStudyHours: 0,
          topics: ["Packet Tracer"],
        }),
      ],
      72,
      2,
    );
    const hours = next.map((module) => module.hours);
    expect(hours.reduce((sum, value) => sum + value, 0)).toBe(70);
    expect(hours.some((value) => !Number.isInteger(value))).toBe(false);
    expect(hours).not.toContain(11.67);
    expect(hours).not.toContain(15.56);
    expect(hours).not.toContain(42.78);
  });

  it("не переносит ошибку образца 248 ч: нули остаются нулями, если так задано и сумма уже сходится", () => {
    const internship = sample({
      hours: 254,
      lectureHours: 0,
      practiceHours: 0,
      labHours: 0,
      selfStudyHours: 254,
      topics: ["Linux", "CI/CD"],
    });
    const next = balanceModules([internship], 256, 2);
    expect(next[0].hours).toBe(254);
    expect(next[0].lectureHours).toBe(0);
    expect(next[0].practiceHours).toBe(0);
    expect(next[0].selfStudyHours).toBe(254);
  });
});

describe("attachCompetencyIds", () => {
  it("подставляет компетенцию по кругу, если модуль без связи", () => {
    const next = attachCompetencyIds(
      [sample({ competencyIds: [] }), sample({ id: "m2", competencyIds: [] })],
      ["c1", "c2"],
    );
    expect(next[0].competencyIds).toEqual(["c1"]);
    expect(next[1].competencyIds).toEqual(["c2"]);
  });
});
