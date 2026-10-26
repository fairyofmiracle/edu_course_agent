import { loadLibraryCourse } from "@/lib/course-library";
import { createEmptyCourse, type CourseDocument } from "@/lib/course-schema";
import { SAMPLE_COURSE } from "@/lib/sample-course";
import { readStoredCourse, readStoredMessages } from "@/lib/storage";
import type { UIMessage } from "ai";

export type StudioOpen = {
  course: CourseDocument;
  messages: UIMessage[];
  persist: boolean;
  rotateSession: boolean;
  notice: string;
};

/** Что открыть по адресу. Пример и неизвестный id не подменяют курс в браузере. */
export function resolveStudioOpen(
  query: { courseId?: string; sample?: boolean; fresh?: boolean },
  storage: Pick<Storage, "getItem">,
): StudioOpen {
  if (query.fresh) {
    return {
      course: createEmptyCourse(),
      messages: [],
      persist: true,
      rotateSession: true,
      notice: "",
    };
  }
  const courseId = query.courseId?.trim() || "";
  if (query.sample && !courseId) {
    return {
      course: SAMPLE_COURSE,
      messages: [],
      persist: false,
      rotateSession: false,
      notice: "Это пример. Открытая программа и диалог в браузере не меняются.",
    };
  }
  if (courseId) {
    const stored = loadLibraryCourse(storage, courseId);
    if (!stored) {
      return {
        course: createEmptyCourse(),
        messages: [],
        persist: false,
        rotateSession: false,
        notice: "Курс по этой ссылке в браузере не найден. Открытая программа не заменена.",
      };
    }
    return {
      course: stored.course,
      messages: stored.messages,
      persist: true,
      rotateSession: true,
      notice: "",
    };
  }
  return {
    course: readStoredCourse(storage),
    messages: readStoredMessages(storage),
    persist: true,
    rotateSession: false,
    notice: "",
  };
}

/** Один и тот же офлайн-пример. Повторное открытие не заводит новую программу. */
export function openOfflineSample(
  currentId: string,
  storage: Pick<Storage, "getItem">,
): { course: CourseDocument; messages: UIMessage[] } | null {
  if (currentId === SAMPLE_COURSE.id) return null;
  const stored = loadLibraryCourse(storage, SAMPLE_COURSE.id);
  if (stored) return { course: stored.course, messages: stored.messages };
  return {
    course: { ...structuredClone(SAMPLE_COURSE), updatedAt: new Date().toISOString() },
    messages: [],
  };
}
