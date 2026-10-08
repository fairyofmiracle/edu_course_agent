import {
  courseDocumentSchema,
  createEmptyCourse,
  type CourseDocument,
} from "@/lib/course-schema";
import type { UIMessage } from "ai";

const COURSE_KEY = "edu-course-agent:course";
const MESSAGES_KEY = "edu-course-agent:messages";

export function loadStoredCourse(): CourseDocument {
  if (typeof window === "undefined") return createEmptyCourse();
  try {
    const raw = window.localStorage.getItem(COURSE_KEY);
    if (!raw) return createEmptyCourse();
    const parsed = courseDocumentSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : createEmptyCourse();
  } catch {
    return createEmptyCourse();
  }
}

export function saveCourse(course: CourseDocument) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(COURSE_KEY, JSON.stringify(course));
}

export function loadStoredMessages(): UIMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(MESSAGES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveMessages(messages: UIMessage[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MESSAGES_KEY, JSON.stringify(messages));
}

export function clearStudioStorage() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(COURSE_KEY);
  window.localStorage.removeItem(MESSAGES_KEY);
}
