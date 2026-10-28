import { academicHours, balanceModules } from "@/lib/hours-balance";
import {
  courseDocumentSchema,
  isCourseEmpty,
  type CourseDocument,
} from "@/lib/course-schema";
import { courseReadiness, type CourseReadiness } from "@/lib/course-readiness";
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
  readiness?: CourseReadiness;
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
  const base = title.trim() || "Без названия";
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
  if (!halfHour(adaptation.durationHours) || adaptation.durationHours < 0.5) {
    return { ok: false, error: "Объём — число от 0,5 часа с шагом 0,5." };
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

export type LibraryWrite = "saved" | "course-only" | "failed" | "skipped";

function writeStorage(storage: Pick<Storage, "setItem">, key: string, value: string) {
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function rememberCourse(
  course: CourseDocument,
  messages: UIMessage[],
  storage: Pick<Storage, "getItem" | "setItem">,
): LibraryWrite {
  if (isCourseEmpty(course) && messages.length === 0) {
    // Пустой черновик (в т.ч. бывший дефолт «Новая программа») в каталог не кладём.
    const library = readLibrary(storage);
    if (course.id in library) {
      delete library[course.id];
      writeStorage(storage, LIBRARY_KEY, JSON.stringify(library));
    }
    return "skipped";
  }
  const library = readLibrary(storage);
  library[course.id] = { course, messages };
  if (writeStorage(storage, LIBRARY_KEY, JSON.stringify(library))) return "saved";
  library[course.id] = { course, messages: [] };
  if (writeStorage(storage, LIBRARY_KEY, JSON.stringify(library))) return "course-only";
  return "failed";
}

const IT_DIRECTIONS: { label: string; pattern: RegExp }[] = [
  { label: "Кибербезопасность", pattern: /кибер|информационн\p{L}*\s+безопас/iu },
  { label: "Сети", pattern: /сет(и|ей|ям|ях)\b|cisco|vlan|маршрутиз/i },
  { label: "Python", pattern: /python|питон/i },
  { label: "Искусственный интеллект", pattern: /нейросет|искусственн\p{L}*\s+интеллект|машинн\p{L}*\s+обучен/iu },
  { label: "Веб", pattern: /веб|frontend|html|javascript|\breact\b/i },
  { label: "Базы данных", pattern: /\bsql\b|баз\p{L}*\s+данн|postgres/iu },
  { label: "1С", pattern: /1\s*[сc]/i },
  { label: "DevOps", pattern: /devops|docker|kubernetes/i },
  { label: "Аналитика", pattern: /аналитик|figma/i },
  { label: "Программирование", pattern: /программир/i },
];

export function itDirection(title: string) {
  const text = title.trim();
  for (const item of IT_DIRECTIONS) {
    if (item.pattern.test(text)) return item.label;
  }
  return "Другие программы";
}

export function groupByDirection<T extends { title: string }>(items: T[]) {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const label = itDirection(item.title);
    buckets.set(label, [...(buckets.get(label) ?? []), item]);
  }
  return [...buckets.entries()]
    .map(([label, courses]) => ({ label, courses }))
    .sort((left, right) => {
      if (left.label === "Другие программы") return 1;
      if (right.label === "Другие программы") return -1;
      return left.label.localeCompare(right.label, "ru");
    });
}


/** Убрать из каталога пустые «Новая программа» без содержания и диалога. */
export function pruneEmptyLibraryDrafts(
  storage: Pick<Storage, "getItem"> & Partial<Pick<Storage, "setItem">>,
) {
  if (typeof storage.setItem !== "function") return 0;
  const library = readLibrary(storage);
  let removed = 0;
  for (const [id, entry] of Object.entries(library)) {
    if (isCourseEmpty(entry.course) && entry.messages.length === 0) {
      delete library[id];
      removed += 1;
    }
  }
  if (removed) writeStorage(storage as Pick<Storage, "setItem">, LIBRARY_KEY, JSON.stringify(library));
  return removed;
}

export function listLibrary(
  storage: Pick<Storage, "getItem"> & Partial<Pick<Storage, "setItem">>,
): CourseSummary[] {
  pruneEmptyLibraryDrafts(storage);
  return Object.values(readLibrary(storage))
    .map(({ course }) => ({
      id: course.id,
      title: course.brief.title,
      audience: course.brief.audience,
      programKind: course.brief.programKind,
      durationHours: course.brief.durationHours,
      attestationHours: course.brief.attestationHours,
      updatedAt: course.updatedAt,
      readiness: courseReadiness(course),
    }))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function loadLibraryCourse(
  storage: Pick<Storage, "getItem">,
  courseId: string,
): StoredCourse | null {
  return readLibrary(storage)[courseId] ?? null;
}

export type HoursFilter = "all" | "lt36" | "36to72" | "gte72";

export function matchesHoursFilter(hours: number, filter: HoursFilter) {
  if (filter === "all") return true;
  if (!hours || hours <= 0) return false;
  if (filter === "lt36") return hours < 36;
  if (filter === "36to72") return hours >= 36 && hours <= 72;
  return hours >= 72;
}
