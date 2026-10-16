import { academicHours, balanceModules } from "@/lib/hours-balance";
import {
  courseDocumentSchema,
  type CourseDocument,
} from "@/lib/course-schema";
import type { UIMessage } from "ai";

export const LIBRARY_KEY = "edu-course-agent:library";

export type StoredCourse = {
  course: CourseDocument;
  messages: UIMessage[];
};

export type CourseSummary = {
  id: string;
  title: string;
  audience: string;
  programKind: string;
  durationHours: number;
  attestationHours: number;
  updatedAt: string;
};

export type CopyAdaptation = {
  audience: string;
  durationHours: number;
  attestationHours: number;
};

type LibraryFile = Record<string, StoredCourse>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function copyTitle(title: string) {
  const base = title.trim() || "Новая образовательная программа";
  return `${base} — копия`.slice(0, 180);
}

export function duplicateCourse(course: CourseDocument): CourseDocument {
  const copy = structuredClone(course);
  copy.id = crypto.randomUUID();
  copy.updatedAt = new Date().toISOString();
  copy.brief = { ...copy.brief, title: copyTitle(course.brief.title) };
  return copy;
}

function halfHour(value: number) {
  return Number.isFinite(value) && Math.abs(value * 2 - Math.round(value * 2)) < 0.001;
}

export function adaptCourseCopy(
  course: CourseDocument,
  adaptation: CopyAdaptation,
): { ok: true; course: CourseDocument } | { ok: false; error: string } {
  const audience = adaptation.audience.trim();
  if (!audience || audience.length > 400) {
    return { ok: false, error: "Укажите аудиторию, до 400 символов." };
  }
  if (!halfHour(adaptation.durationHours) || adaptation.durationHours < 16 || adaptation.durationHours > 500) {
    return { ok: false, error: "Объём — число от 16 до 500 с шагом 0,5." };
  }
  if (!halfHour(adaptation.attestationHours) || adaptation.attestationHours < 0) {
    return { ok: false, error: "Часы аттестации — число от 0 с шагом 0,5." };
  }
  if (adaptation.attestationHours > adaptation.durationHours) {
    return { ok: false, error: "Аттестация не больше объёма программы." };
  }
  if (course.modules.length > 0 && adaptation.durationHours - adaptation.attestationHours < 0.5) {
    return { ok: false, error: "На модули должен остаться хотя бы 0,5 часа." };
  }

  const copy = duplicateCourse(course);
  copy.brief = {
    ...copy.brief,
    audience,
    durationHours: academicHours(adaptation.durationHours),
    attestationHours: academicHours(adaptation.attestationHours),
  };
  copy.modules = balanceModules(
    copy.modules,
    copy.brief.durationHours,
    copy.brief.attestationHours,
  );
  copy.frameworkApproved = false;
  copy.frameworkFingerprint = "";
  return { ok: true, course: copy };
}

export function readLibrary(storage: Pick<Storage, "getItem">): LibraryFile {
  try {
    const raw = storage.getItem(LIBRARY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return {};
    const library: LibraryFile = {};
    for (const [id, entry] of Object.entries(parsed)) {
      if (!isRecord(entry)) continue;
      const course = courseDocumentSchema.safeParse(entry.course);
      if (!course.success || course.data.id !== id) continue;
      const messages = Array.isArray(entry.messages) ? (entry.messages as UIMessage[]) : [];
      library[id] = { course: course.data, messages };
    }
    return library;
  } catch {
    return {};
  }
}

export function forgetCourse(
  courseId: string,
  storage: Pick<Storage, "getItem" | "setItem">,
) {
  const library = readLibrary(storage);
  delete library[courseId];
  try {
    storage.setItem(LIBRARY_KEY, JSON.stringify(library));
  } catch {
    return;
  }
}

export function rememberCourse(
  course: CourseDocument,
  messages: UIMessage[],
  storage: Pick<Storage, "getItem" | "setItem">,
) {
  const library = readLibrary(storage);
  library[course.id] = { course, messages };
  try {
    storage.setItem(LIBRARY_KEY, JSON.stringify(library));
  } catch {
    return;
  }
}

export function listLibrary(storage: Pick<Storage, "getItem">): CourseSummary[] {
  return Object.values(readLibrary(storage))
    .map(({ course }) => ({
      id: course.id,
      title: course.brief.title,
      audience: course.brief.audience,
      programKind: course.brief.programKind,
      durationHours: course.brief.durationHours,
      attestationHours: course.brief.attestationHours,
      updatedAt: course.updatedAt,
    }))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function loadLibraryCourse(
  storage: Pick<Storage, "getItem">,
  courseId: string,
): StoredCourse | null {
  return readLibrary(storage)[courseId] ?? null;
}
