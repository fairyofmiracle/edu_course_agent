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
  return { ...course, updatedAt: new Date().toISOString() };
}

export function applyPatch(
  course: CourseDocument,
  patch: CoursePatch,
): CourseDocument {
  switch (patch.type) {
    case "update_brief":
      return touch({
        ...course,
        brief: { ...course.brief, ...patch.brief },
      });
    case "set_competency_map":
      return touch({ ...course, competencies: patch.competencies });
    case "set_structure":
      return touch({ ...course, modules: patch.modules });
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
  let course = fallback;
  let applied = false;

  for (const message of messages) {
    for (const part of message.parts ?? []) {
      if (!isToolUIPart(part) || part.state !== "output-available") continue;
      if (!isCoursePatch(part.output)) continue;
      const next = applyPatch(course, part.output);
      const parsed = courseDocumentSchema.safeParse(next);
      if (!parsed.success) continue;
      course = parsed.data;
      applied = true;
    }
  }

  return applied ? course : fallback;
}
