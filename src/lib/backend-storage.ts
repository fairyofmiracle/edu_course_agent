import type { UIMessage } from "ai";
import { triggerBrowserDownload } from "@/lib/browser-download";
import type { CourseDocument } from "@/lib/course-schema";

const configuredBase = process.env.NEXT_PUBLIC_PYTHON_API_URL?.trim();

function baseUrl() {
  return configuredBase?.replace(/\/$/, "") || null;
}

export class CourseConflictError extends Error {
  constructor() {
    super("Курс уже сохранила другая вкладка. Обновите программу и повторите.");
    this.name = "CourseConflictError";
  }
}

export function hasBackendStorage() {
  return Boolean(baseUrl());
}

function endpoint(path: string) {
  return `/api/backend${path}`;
}

export async function saveCourseToBackend(
  course: CourseDocument,
  messages: UIMessage[],
  reason = "autosave",
  expectedVersion?: number,
) {
  if (!baseUrl()) return false;
  const response = await fetch(endpoint(`/api/courses/${encodeURIComponent(course.id)}`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      course,
      messages,
      reason,
      ...(expectedVersion === undefined ? {} : { expectedVersion }),
    }),
  });
  if (response.status === 409) throw new CourseConflictError();
  if (!response.ok) {
    throw new Error("Не удалось сохранить программу. Повторите через минуту.");
  }
  try {
    const body = (await response.json()) as { version?: number };
    if (typeof body.version === "number") return body.version;
  } catch {
    // ответ без JSON всё равно значит, что запись прошла
  }
  return (expectedVersion ?? 0) + 1;
}

export type SavedCourseSummary = {
  id: string;
  title: string;
  audience: string;
  programKind: string;
  durationHours: number;
  attestationHours: number;
  version: number;
  updatedAt: string;
};

export async function listCoursesFromBackend() {
  if (!baseUrl()) return null;
  const response = await fetch(endpoint("/api/courses"), { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Не удалось получить список курсов. Обновите страницу.");
  }
  return (await response.json()) as { courses: SavedCourseSummary[] };
}

export async function copyCourseOnBackend(courseId: string) {
  if (!baseUrl()) return null;
  const response = await fetch(endpoint(`/api/courses/${encodeURIComponent(courseId)}/copy`), {
    method: "POST",
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error("Не удалось скопировать программу. Повторите шаг.");
  }
  return (await response.json()) as { course: CourseDocument; version: number };
}

export async function deleteCourseFromBackend(courseId: string) {
  if (!baseUrl()) return false;
  const response = await fetch(endpoint(`/api/courses/${encodeURIComponent(courseId)}`), {
    method: "DELETE",
  });
  if (response.status === 404) return false;
  if (!response.ok) {
    throw new Error("Не удалось удалить программу. Повторите шаг.");
  }
  return true;
}

export async function downloadCourseFromBackend(
  course: CourseDocument,
  kind: "json" | "docx" | "pptx",
) {
  if (!baseUrl()) return false;
  const response = await fetch(endpoint(`/api/export/${kind}`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(course),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    throw new Error("Не удалось выгрузить программу. Повторите кнопкой «Выгрузить».");
  }
  const blob = await response.blob();
  const slug = (course.brief.title.trim() || "course")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  triggerBrowserDownload(`${slug}.${kind}`, blob);
  return true;
}

export async function loadCourseFromBackend(courseId: string) {
  if (!baseUrl()) return null;
  const response = await fetch(endpoint(`/api/courses/${encodeURIComponent(courseId)}`), {
    cache: "no-store",
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error("Не удалось открыть программу. Обновите страницу.");
  }
  return (await response.json()) as {
    course: CourseDocument;
    messages: UIMessage[];
    version: number;
  };
}
