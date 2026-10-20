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
  query: { courseId?: string; sample?: boolean },
  storage: Pick<Storage, "getItem">,
): StudioOpen {
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
