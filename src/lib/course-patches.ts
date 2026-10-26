import { isToolUIPart } from "ai";
import type { UIMessage } from "ai";
import {
  assessmentSchema,
  briefSchema,
  competencyMapSchema,
  courseDocumentSchema,
  lectureSchema,
  moduleSchema,
  seminarSchema,
  type Assessment,
  type CourseBrief,
  type CourseDocument,
  type Lecture,
  type Seminar,
} from "@/lib/course-schema";
import {
  academicHours,
  attachCompetencyIds,
  balanceModules,
  flattenInternshipHours,
  linkCompetencies,
} from "@/lib/hours-balance";
import { mergeLegalBasis } from "@/lib/legal-basis";

export type CoursePatch =
  | { type: "update_brief"; brief: Partial<CourseBrief> }
  | { type: "set_competency_map"; competencies: CourseDocument["competencies"] }
  | { type: "set_structure"; modules: CourseDocument["modules"] }
  | { type: "set_lecture"; lecture: Lecture }
  | { type: "set_seminar"; seminar: Seminar }
  | { type: "set_assessment"; assessment: Assessment }
  | {
      type: "revise_section";
      section:
        | "brief"
        | "competencies"
        | "structure"
        | "lecture"
        | "seminar"
        | "assessment";
      moduleId?: string;
      data: unknown;
    };

function upsertByModule<T extends { moduleId: string }>(
  items: T[],
  next: T,
): T[] {
  const index = items.findIndex((item) => item.moduleId === next.moduleId);
  if (index === -1) return [...items, next];
  const copy = [...items];
  copy[index] = next;
  return copy;
}

function touch(course: CourseDocument): CourseDocument {
  return {
    ...course,
    updatedAt: new Date().toISOString(),
    brief: mergeLegalBasis(course.brief),
  };
}

function mergeModules(
  existing: CourseDocument["modules"],
  incoming: CourseDocument["modules"],
) {
  if (existing.length === 0) return incoming;
  if (incoming.length === 0) return existing;
  const oldIds = new Set(existing.map((item) => item.id));
  const replacements = new Map(
    incoming.filter((item) => oldIds.has(item.id)).map((item) => [item.id, item]),
  );
  if (replacements.size === 0) return [...existing, ...incoming];
  const novel = incoming.filter((item) => !oldIds.has(item.id));
  return [...existing.map((item) => replacements.get(item.id) ?? item), ...novel];
}

function withBalancedModules(course: CourseDocument): CourseDocument {
  const flattened = flattenInternshipHours(course);
  if (flattened.modules.length === 0) return flattened;
  course = flattened;
  const linked = linkCompetencies(course.competencies.nodes, course.modules);
  const competencies = { ...course.competencies, nodes: linked.nodes };
  if (course.brief.durationHours <= 0) {
    return { ...course, competencies, modules: linked.modules };
  }
  const ids = linked.nodes.map((node) => node.id);
  return {
    ...course,
    competencies,
    modules: balanceModules(
      attachCompetencyIds(linked.modules, ids),
      course.brief.durationHours,
      course.brief.attestationHours,
    ),
  };
}

const PATCH_RANK: Record<CoursePatch["type"], number> = {
  update_brief: 0,
  set_competency_map: 1,
  set_structure: 2,
  set_lecture: 3,
  set_seminar: 3,
  set_assessment: 3,
  revise_section: 4,
};

export function applyPatches(course: CourseDocument, patches: CoursePatch[]): CourseDocument {
  const ordered = patches
    .map((patch, index) => ({ patch, index }))
    .sort((left, right) => PATCH_RANK[left.patch.type] - PATCH_RANK[right.patch.type] || left.index - right.index)
    .map((item) => item.patch);
  let next = course;
  for (const patch of ordered) {
    const applied = applyPatch(next, patch);
    const parsed = courseDocumentSchema.safeParse(applied);
    if (parsed.success) next = parsed.data;
  }
  return next;
}

export function applyPatch(
  course: CourseDocument,
  patch: CoursePatch,
): CourseDocument {
  switch (patch.type) {
    case "update_brief":
      return touch(
        withBalancedModules({
          ...course,
          brief: { ...course.brief, ...patch.brief },
        }),
      );
    case "set_competency_map":
      return touch(
        withBalancedModules({ ...course, competencies: patch.competencies }),
      );
    case "set_structure":
      return touch(
        withBalancedModules({
          ...course,
          modules: mergeModules(course.modules, patch.modules),
        }),
      );
    case "set_lecture":
      return touch({
        ...course,
        lectures: upsertByModule(course.lectures, patch.lecture),
      });
    case "set_seminar":
      return touch({
        ...course,
        seminars: upsertByModule(course.seminars, patch.seminar),
      });
    case "set_assessment":
      return touch({
        ...course,
        assessments: upsertByModule(course.assessments, patch.assessment),
      });
    case "revise_section":
      return applyRevision(course, patch);
    default:
      return course;
  }
}

function modulesFromRevision(data: unknown) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object" && "modules" in data) {
    return (data as { modules: unknown }).modules;
  }
  return data;
}

function withModuleId(data: unknown, moduleId?: string) {
  if (!moduleId || !data || typeof data !== "object" || Array.isArray(data)) return data;
  const record = data as Record<string, unknown>;
  if (typeof record.moduleId === "string" && record.moduleId.length > 0) return data;
  return { ...record, moduleId };
}

function applyRevision(
  course: CourseDocument,
  patch: Extract<CoursePatch, { type: "revise_section" }>,
): CourseDocument {
  const { section, moduleId, data } = patch;
  try {
    if (section === "brief") {
      const brief = briefSchema.partial().parse(data);
      return applyPatch(course, { type: "update_brief", brief });
    }
    if (section === "competencies") {
      return applyPatch(course, {
        type: "set_competency_map",
        competencies: competencyMapSchema.parse(data),
      });
    }
    if (section === "structure") {
      return applyPatch(course, {
        type: "set_structure",
        modules: zArray(moduleSchema).parse(modulesFromRevision(data)),
      });
    }
    if (section === "lecture") {
      return applyPatch(course, {
        type: "set_lecture",
        lecture: lectureSchema.parse(withModuleId(data, moduleId)),
      });
    }
    if (section === "seminar") {
      return applyPatch(course, {
        type: "set_seminar",
        seminar: seminarSchema.parse(withModuleId(data, moduleId)),
      });
    }
    if (section === "assessment") {
      return applyPatch(course, {
        type: "set_assessment",
        assessment: assessmentSchema.parse(withModuleId(data, moduleId)),
      });
    }
  } catch {
    return course;
  }
  return course;
}

function zArray<T>(schema: {
  parse: (value: unknown) => T;
}): { parse: (value: unknown) => T[] } {
  return {
    parse(value: unknown) {
      if (!Array.isArray(value)) throw new Error("Expected array");
      return value.map((item) => schema.parse(item));
    },
  };
}

export function isCoursePatch(value: unknown): value is CoursePatch {
  if (!value || typeof value !== "object" || !("type" in value)) return false;
  const type = (value as { type: unknown }).type;
  return (
    type === "update_brief" ||
    type === "set_competency_map" ||
    type === "set_structure" ||
    type === "set_lecture" ||
    type === "set_seminar" ||
    type === "set_assessment" ||
    type === "revise_section"
  );
}

export function foldCourseFromMessages(
  messages: UIMessage[],
  fallback: CourseDocument,
): CourseDocument {
  const patches: CoursePatch[] = [];
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      if (!isToolUIPart(part) || part.state !== "output-available") continue;
      if (!isCoursePatch(part.output)) continue;
      patches.push(part.output);
    }
  }
  if (patches.length === 0) return fallback;
  return rebalanceCourse(applyPatches(fallback, patches));
}

/** Если объём появился после плана, или модель вызвала tools не по порядку — выровнять часы. */
export function rebalanceCourse(course: CourseDocument): CourseDocument {
  if (course.modules.length === 0 || course.brief.durationHours <= 0) return course;
  return keepSixteenHourPractice(withBalancedModules(course));
}

function keepSixteenHourPractice(course: CourseDocument): CourseDocument {
  if (course.brief.programKind !== "general" || course.brief.durationHours !== 16) return course;
  let need = academicHours(8 - course.modules.reduce((sum, module) => sum + module.practiceHours, 0));
  if (need <= 0) return course;
  const modules = course.modules.map((module) => ({ ...module }));
  for (const key of ["labHours", "selfStudyHours"] as const) {
    for (const module of modules) {
      if (need <= 0) break;
      const available = academicHours(module[key]);
      const take = Math.min(available, need);
      if (take <= 0) continue;
      module[key] = academicHours(available - take);
      module.practiceHours = academicHours(module.practiceHours + take);
      need = academicHours(need - take);
    }
  }
  return { ...course, modules };
}
