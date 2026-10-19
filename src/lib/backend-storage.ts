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
  expectedVersion?: number,
) {
  const base = baseUrl();
  if (!base) return false;
  const response = await fetch(`${base}/api/courses/${encodeURIComponent(course.id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      course,
      messages,
      reason,
      ...(expectedVersion === undefined ? {} : { expectedVersion }),
    }),
  });
  if (response.status === 409) {
    throw new Error("Курс уже сохранила другая вкладка. Обновите программу и повторите.");
  }
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

export async function deleteCourseFromBackend(courseId: string) {
  const base = baseUrl();
  if (!base) return false;
  const response = await fetch(`${base}/api/courses/${encodeURIComponent(courseId)}`, {
    method: "DELETE",
  });
  if (response.status === 404) return false;
  if (!response.ok) {
    throw new Error(`Не удалось удалить курс: HTTP ${response.status}`);
  }
  return true;
}

export async function downloadCourseFromBackend(
  course: CourseDocument,
  kind: "json" | "docx" | "pptx",
) {
  const base = baseUrl();
  if (!base) return false;
  const response = await fetch(`${base}/api/export/${kind}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(course),
  });
  if (!response.ok) {
    throw new Error(`Не удалось выгрузить ${kind}: HTTP ${response.status}`);
  }
  const blob = await response.blob();
  const slug = (course.brief.title.trim() || "course")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slug}.${kind}`;
  link.click();
  URL.revokeObjectURL(url);
  return true;
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
