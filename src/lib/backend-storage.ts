import type { UIMessage } from "ai";
import type { CourseDocument } from "@/lib/course-schema";

const configuredBase = process.env.NEXT_PUBLIC_PYTHON_API_URL?.trim();

function baseUrl() {
  return configuredBase?.replace(/\/$/, "") || null;
}

export function hasBackendStorage() {
  return Boolean(baseUrl());
}

export async function saveCourseToBackend(
  course: CourseDocument,
  messages: UIMessage[],
  reason = "autosave",
) {
  const base = baseUrl();
  if (!base) return false;
  const response = await fetch(`${base}/api/courses/${encodeURIComponent(course.id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ course, messages, reason }),
  });
  if (!response.ok) {
    throw new Error(`Не удалось сохранить курс в Python backend: HTTP ${response.status}`);
  }
  return true;
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
  const base = baseUrl();
  if (!base) return null;
  const response = await fetch(`${base}/api/courses`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Не удалось получить список курсов: HTTP ${response.status}`);
  }
  return (await response.json()) as { courses: SavedCourseSummary[] };
}

export async function copyCourseOnBackend(courseId: string) {
  const base = baseUrl();
  if (!base) return null;
  const response = await fetch(`${base}/api/courses/${encodeURIComponent(courseId)}/copy`, {
    method: "POST",
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Не удалось скопировать курс: HTTP ${response.status}`);
  }
  return (await response.json()) as { course: CourseDocument; version: number };
}

export async function loadCourseFromBackend(courseId: string) {
  const base = baseUrl();
  if (!base) return null;
  const response = await fetch(`${base}/api/courses/${encodeURIComponent(courseId)}`, {
    cache: "no-store",
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Не удалось загрузить курс из Python backend: HTTP ${response.status}`);
  }
  return (await response.json()) as {
    course: CourseDocument;
    messages: UIMessage[];
    version: number;
  };
}
