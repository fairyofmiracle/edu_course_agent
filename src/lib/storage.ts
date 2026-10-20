import { forgetCourse, rememberCourse } from "@/lib/course-library";
import {
  courseDocumentSchema,
  createEmptyCourse,
  type CourseDocument,
} from "@/lib/course-schema";
import type { UIMessage } from "ai";

const COURSE_KEY = "edu-course-agent:course";
const MESSAGES_KEY = "edu-course-agent:messages";
const SESSION_KEY = "edu-course-agent:session";

export type LocalSave = { ok: true } | { ok: false; message: string };

const STORAGE_FULL = "Память браузера заполнена. Программа на экране не записалась.";
const LIST_ONLY = "Память браузера заполнена. Курс остался в списке без диалога.";
const LIST_MISSED = "Память браузера заполнена. Курс в список не попал, прежняя запись на месте.";

function writeStorage(storage: Pick<Storage, "setItem">, key: string, value: string) {
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function readStoredCourse(storage: Pick<Storage, "getItem">): CourseDocument {
  try {
    const raw = storage.getItem(COURSE_KEY);
    if (!raw) return createEmptyCourse();
    const parsed = courseDocumentSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : createEmptyCourse();
  } catch {
    return createEmptyCourse();
  }
}

export function readStoredMessages(storage: Pick<Storage, "getItem">): UIMessage[] {
  try {
    const raw = storage.getItem(MESSAGES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function loadStoredCourse(): CourseDocument {
  if (typeof window === "undefined") return createEmptyCourse();
  return readStoredCourse(window.localStorage);
}

export function saveCourse(course: CourseDocument, messages: UIMessage[] = []): LocalSave {
  if (typeof window === "undefined") return { ok: true };
  const storage = window.localStorage;
  const courseOk = writeStorage(storage, COURSE_KEY, JSON.stringify(course));
  const messagesOk = writeStorage(storage, MESSAGES_KEY, JSON.stringify(messages));
  const library = rememberCourse(course, messages, storage);
  if (courseOk && messagesOk && library === "saved") return { ok: true };
  if (!courseOk) return { ok: false, message: STORAGE_FULL };
  if (library === "failed") return { ok: false, message: LIST_MISSED };
  return { ok: false, message: LIST_ONLY };
}

export function loadStoredMessages(): UIMessage[] {
  if (typeof window === "undefined") return [];
  return readStoredMessages(window.localStorage);
}

export function saveMessages(messages: UIMessage[]): LocalSave {
  if (typeof window === "undefined") return { ok: true };
  if (writeStorage(window.localStorage, MESSAGES_KEY, JSON.stringify(messages))) return { ok: true };
  return { ok: false, message: "Память браузера заполнена. Диалог не записался." };
}

export function loadSessionId() {
  if (typeof window === "undefined") return "session";
  const existing = window.localStorage.getItem(SESSION_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  writeStorage(window.localStorage, SESSION_KEY, id);
  return id;
}

export function newSessionId() {
  if (typeof window === "undefined") return "session";
  const id = crypto.randomUUID();
  writeStorage(window.localStorage, SESSION_KEY, id);
  return id;
}

export function dropStoredCourse(courseId: string) {
  if (typeof window === "undefined") return false;
  forgetCourse(courseId, window.localStorage);
  let open = false;
  try {
    const raw = window.localStorage.getItem(COURSE_KEY);
    const parsed = raw ? (JSON.parse(raw) as { id?: unknown }) : null;
    open = parsed?.id === courseId;
  } catch {
    open = false;
  }
  if (open) clearStudioStorage();
  return open;
}

export function clearStudioStorage() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(COURSE_KEY);
  window.localStorage.removeItem(MESSAGES_KEY);
  window.localStorage.removeItem(SESSION_KEY);
}
