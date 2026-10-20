import type { CourseDocument, CourseModule } from "@/lib/course-schema";

const KIND_KEYS = [
  "lectureHours",
  "practiceHours",
  "labHours",
  "selfStudyHours",
] as const;

type KindKey = (typeof KIND_KEYS)[number];
type KindHours = Pick<CourseModule, KindKey | "hours">;
type TopicHours = Pick<CourseModule["plan"][number], KindKey | "title">;

/** Стажировка и практикум держат часы в самостоятельной работе, как сервер. */
export function flattenInternshipHours(course: CourseDocument): CourseDocument {
  const text = [
    course.brief.title,
    course.brief.audience,
    course.brief.attestationForm,
    ...course.brief.goals,
    ...course.modules.flatMap((module) => [module.title, ...module.topics]),
  ]
    .join(" ")
    .toLowerCase();
  const internship =
    course.brief.format === "workshop" ||
    text.includes("стажиров") ||
    text.includes("аудиторных нет") ||
    text.includes("аудиторных занятий нет");
  if (!internship) return course;
  let changed = false;
  const modules = course.modules.map((module) => {
    const classroom = module.lectureHours + module.practiceHours + module.labHours;
    if (classroom <= 0) return module;
    changed = true;
    return {
      ...module,
      lectureHours: 0,
      practiceHours: 0,
      labHours: 0,
      selfStudyHours: module.hours,
    };
  });
  return changed ? { ...course, modules } : course;
}

/** Академические часы хранятся с шагом 0,5: допустимы 0,5 и 1,5. */
export function academicHours(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 2) / 2;
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
 * Часы с шагом 0,5 по весам (метод наибольшего остатка).
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
  const units = Math.round(goal * 2);
  if (units <= 0) return weights.map(() => 0);

  const keepZero = options?.keepZero ?? true;
  const raw = weights.map((weight) =>
    Number.isFinite(weight) && weight > 0 ? weight : 0,
  );
  const usable = raw
    .map((weight, index) => ({ index, weight }))
    .filter((item) => (keepZero ? item.weight > 0 : true));

  if (usable.length === 0) {
    const each = Math.floor(units / count);
    const remainder = units - each * count;
    return raw.map((_, index) => (each + (index >= count - remainder ? 1 : 0)) / 2);
  }

  const sumWeights = usable.reduce((total, item) => total + item.weight, 0);
  const parts = usable.map((item) => {
    const exact = (units * item.weight) / sumWeights;
    const floor = Math.floor(exact);
    return { ...item, floor, frac: exact - floor };
  });
  const result = Array.from({ length: count }, () => 0);
  for (const part of parts) result[part.index] = part.floor;
  let remainder = units - parts.reduce((total, part) => total + part.floor, 0);
  parts.sort((a, b) => b.frac - a.frac || b.weight - a.weight || a.index - b.index);
  let cursor = 0;
  while (remainder > 0 && parts.length > 0) {
    result[parts[cursor % parts.length].index] += 1;
    remainder -= 1;
    cursor += 1;
  }
  return result.map((value) => value / 2);
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
        row.lectureHours === academicHours(row.lectureHours) &&
        row.practiceHours === academicHours(row.practiceHours) &&
        row.labHours === academicHours(row.labHours) &&
        row.selfStudyHours === academicHours(row.selfStudyHours),
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

function cleanLines(values: string[], fallback: string) {
  const next = values.map((value) => value.trim()).filter(Boolean);
  return next.length > 0 ? next : [fallback];
}

export function fillModulePlan(module: CourseModule): CourseModule {
  const title = module.title.trim() || "Модуль";
  const titles = cleanLines(
    module.topics.length > 0
      ? module.topics
      : module.plan.map((row) => row.title),
    title,
  );
  const hours = academicHours(module.hours) || kindSum(module);
  const kinds = scaleKinds(module, hours || 1);
  const outcomes = cleanLines(module.learningOutcomes, `Осваивает: ${title}`);
  const keepPlan = planMatches(module.plan, kinds);
  return {
    ...module,
    title,
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

type LinkNode = { id: string; moduleIds: string[] };

/**
 * Модель путает регистр id («c1» против «C1») и забывает связи.
 * Неизвестные id убираем, каждую компетенцию кладём хотя бы в один модуль.
 */
export function linkCompetencies<N extends LinkNode>(
  nodes: N[],
  modules: CourseModule[],
): { nodes: N[]; modules: CourseModule[] } {
  if (nodes.length === 0 || modules.length === 0) return { nodes, modules };
  const nodeKey = new Map(nodes.map((node) => [node.id.trim().toLowerCase(), node.id]));
  const moduleKey = new Map(modules.map((module) => [module.id.trim().toLowerCase(), module.id]));
  const resolve = (map: Map<string, string>, ids: string[]) => [
    ...new Set(ids.flatMap((id) => map.get(id.trim().toLowerCase()) ?? [])),
  ];

  const linkedModules = modules.map((module) => ({
    ...module,
    competencyIds: resolve(nodeKey, module.competencyIds),
  }));
  const linkedNodes = nodes.map((node) => ({
    ...node,
    moduleIds: resolve(moduleKey, node.moduleIds),
  }));

  linkedNodes.forEach((node, index) => {
    const targets = node.moduleIds.length
      ? node.moduleIds
      : linkedModules.some((module) => module.competencyIds.includes(node.id))
        ? []
        : [linkedModules[index % linkedModules.length].id];
    for (const target of targets) {
      const host = linkedModules.find((item) => item.id === target);
      if (host && !host.competencyIds.includes(node.id)) host.competencyIds.push(node.id);
    }
  });
  linkedModules.forEach((module, index) => {
    if (module.competencyIds.length === 0) {
      module.competencyIds = [linkedNodes[index % linkedNodes.length].id];
    }
  });
  for (const node of linkedNodes) {
    node.moduleIds = linkedModules
      .filter((module) => module.competencyIds.includes(node.id))
      .map((module) => module.id);
  }
  return { nodes: linkedNodes, modules: linkedModules };
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
