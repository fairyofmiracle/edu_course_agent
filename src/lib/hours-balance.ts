import type { CourseModule } from "@/lib/course-schema";

const KIND_KEYS = [
  "lectureHours",
  "practiceHours",
  "labHours",
  "selfStudyHours",
] as const;

type KindKey = (typeof KIND_KEYS)[number];
type KindHours = Pick<CourseModule, KindKey | "hours">;
type TopicHours = Pick<CourseModule["plan"][number], KindKey | "title">;

/** Академический час в учебном плане — целое число, без десятых. */
export function academicHours(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value);
}

export function roundHours(value: number) {
  return academicHours(value);
}

export function kindSum(parts: {
  lectureHours: number;
  practiceHours: number;
  labHours: number;
  selfStudyHours: number;
}) {
  return (
    academicHours(parts.lectureHours) +
    academicHours(parts.practiceHours) +
    academicHours(parts.labHours) +
    academicHours(parts.selfStudyHours)
  );
}

/**
 * Целые часы по весам (метод наибольшего остатка).
 * Нулевой вес остаётся нулём — как СРС-стажировка без лекций.
 */
export function allocateInteger(
  target: number,
  weights: number[],
  options?: { keepZero?: boolean },
): number[] {
  const count = weights.length;
  if (count === 0) return [];
  const goal = academicHours(target);
  if (goal <= 0) return weights.map(() => 0);

  const keepZero = options?.keepZero ?? true;
  const raw = weights.map((weight) =>
    Number.isFinite(weight) && weight > 0 ? weight : 0,
  );
  const usable = raw
    .map((weight, index) => ({ index, weight }))
    .filter((item) => (keepZero ? item.weight > 0 : true));

  if (usable.length === 0) {
    const each = Math.floor(goal / count);
    const remainder = goal - each * count;
    return raw.map((_, index) => each + (index >= count - remainder ? 1 : 0));
  }

  const sumWeights = usable.reduce((total, item) => total + item.weight, 0);
  const parts = usable.map((item) => {
    const exact = (goal * item.weight) / sumWeights;
    const floor = Math.floor(exact);
    return { ...item, floor, frac: exact - floor };
  });
  const result = Array.from({ length: count }, () => 0);
  for (const part of parts) result[part.index] = part.floor;
  let remainder = goal - parts.reduce((total, part) => total + part.floor, 0);
  parts.sort((a, b) => b.frac - a.frac || b.weight - a.weight || a.index - b.index);
  let cursor = 0;
  while (remainder > 0 && parts.length > 0) {
    result[parts[cursor % parts.length].index] += 1;
    remainder -= 1;
    cursor += 1;
  }
  return result;
}

function scaleKinds(module: CourseModule, hours: number): KindHours {
  const target = academicHours(hours);
  const current = [
    academicHours(module.lectureHours),
    academicHours(module.practiceHours),
    academicHours(module.labHours),
    academicHours(module.selfStudyHours),
  ];
  if (target <= 0) {
    return {
      hours: current.reduce((total, value) => total + value, 0),
      lectureHours: current[0],
      practiceHours: current[1],
      labHours: current[2],
      selfStudyHours: current[3],
    };
  }
  const allocated =
    current.some((value) => value > 0)
      ? allocateInteger(target, current, { keepZero: true })
      : allocateInteger(target, [1, 2, 0, 1], { keepZero: true });
  return {
    hours: target,
    lectureHours: allocated[0],
    practiceHours: allocated[1],
    labHours: allocated[2],
    selfStudyHours: allocated[3],
  };
}

function planMatches(plan: TopicHours[], kinds: KindHours) {
  if (plan.length === 0) return false;
  const sum = plan.reduce(
    (total, row) => ({
      lectureHours: total.lectureHours + academicHours(row.lectureHours),
      practiceHours: total.practiceHours + academicHours(row.practiceHours),
      labHours: total.labHours + academicHours(row.labHours),
      selfStudyHours: total.selfStudyHours + academicHours(row.selfStudyHours),
    }),
    { lectureHours: 0, practiceHours: 0, labHours: 0, selfStudyHours: 0 },
  );
  return (
    sum.lectureHours === kinds.lectureHours &&
    sum.practiceHours === kinds.practiceHours &&
    sum.labHours === kinds.labHours &&
    sum.selfStudyHours === kinds.selfStudyHours &&
    plan.every(
      (row) =>
        Number.isInteger(row.lectureHours) &&
        Number.isInteger(row.practiceHours) &&
        Number.isInteger(row.labHours) &&
        Number.isInteger(row.selfStudyHours),
    )
  );
}

function placeKindsOnTopics(titles: string[], kinds: KindHours): TopicHours[] {
  const names = titles.length > 0 ? titles : ["Тема"];
  const plan: TopicHours[] = names.map((title) => ({
    title,
    lectureHours: 0,
    practiceHours: 0,
    labHours: 0,
    selfStudyHours: 0,
  }));
  const total = kindSum(kinds);
  if (total <= 0) return plan;

  let cap = Math.max(1, Math.ceil(total / plan.length));
  const roomOf = (index: number) => cap - kindSum(plan[index]);
  let cursor = 0;

  for (const key of KIND_KEYS) {
    let left = kinds[key];
    let guard = 0;
    while (left > 0 && guard < 10_000) {
      guard += 1;
      let found = -1;
      for (let step = 0; step < plan.length; step += 1) {
        const index = (cursor + step) % plan.length;
        if (roomOf(index) > 0) {
          found = index;
          break;
        }
      }
      if (found < 0) {
        cap += 1;
        continue;
      }
      const take = Math.min(left, roomOf(found));
      plan[found][key] += take;
      left -= take;
      cursor = roomOf(found) === 0 ? (found + 1) % plan.length : found;
    }
  }

  const drift = total - plan.reduce((sum, row) => sum + kindSum(row), 0);
  if (drift !== 0) {
    const last = plan[plan.length - 1];
    last.selfStudyHours = Math.max(0, last.selfStudyHours + drift);
  }
  return plan;
}

export function fillModulePlan(module: CourseModule): CourseModule {
  const titles =
    module.topics.length > 0
      ? module.topics
      : module.plan.length > 0
        ? module.plan.map((row) => row.title)
        : [module.title || "Тема"];
  const hours = academicHours(module.hours) || kindSum(module);
  const kinds = scaleKinds(module, hours || 1);
  const outcomes =
    module.learningOutcomes.length > 0
      ? module.learningOutcomes
      : [`Осваивает: ${module.title}`];
  const keepPlan = planMatches(module.plan, kinds);
  return {
    ...module,
    ...kinds,
    topics: titles,
    learningOutcomes: outcomes,
    plan: keepPlan
      ? module.plan.map((row) => ({
          ...row,
          lectureHours: academicHours(row.lectureHours),
          practiceHours: academicHours(row.practiceHours),
          labHours: academicHours(row.labHours),
          selfStudyHours: academicHours(row.selfStudyHours),
        }))
      : placeKindsOnTopics(titles, kinds),
  };
}

export function attachCompetencyIds(modules: CourseModule[], competencyIds: string[]) {
  if (competencyIds.length === 0) return modules;
  return modules.map((module, index) =>
    module.competencyIds.length > 0
      ? module
      : { ...module, competencyIds: [competencyIds[index % competencyIds.length]] },
  );
}

export function balanceModules(
  modules: CourseModule[],
  durationHours: number,
  attestationHours: number,
): CourseModule[] {
  if (modules.length === 0) return modules;
  const filled = modules.map(fillModulePlan);
  const target = academicHours(Math.max(0, durationHours - attestationHours));
  if (target <= 0) return filled;

  const weights = filled.map((module) => module.hours);
  const nextHours = allocateInteger(target, weights, { keepZero: false });
  return filled.map((module, index) =>
    fillModulePlan({
      ...module,
      hours: nextHours[index],
    }),
  );
}
