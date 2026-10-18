import { afterEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_COURSE } from "@/lib/sample-course";

async function loadBackend(base: string) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_PYTHON_API_URL", base);
  return import("./backend-storage");
}

describe("backend storage", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("без адреса ничего не сохраняет и не читает", async () => {
    const api = await loadBackend("  ");
    expect(api.hasBackendStorage()).toBe(false);
    expect(await api.saveCourseToBackend(SAMPLE_COURSE, [])).toBe(false);
    expect(await api.listCoursesFromBackend()).toBeNull();
    expect(await api.copyCourseOnBackend(SAMPLE_COURSE.id)).toBeNull();
    expect(await api.loadCourseFromBackend(SAMPLE_COURSE.id)).toBeNull();
    expect(await api.deleteCourseFromBackend(SAMPLE_COURSE.id)).toBe(false);
  });

  it("кладёт курс, список, копию и загрузку", async () => {
    const api = await loadBackend("http://studio.local/");
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url);
      if (init?.method === "PUT" || init?.method === "DELETE") return new Response("ok", { status: 200 });
      if (path.endsWith("/copy")) {
        return Response.json({ course: SAMPLE_COURSE, version: 2 });
      }
      if (path.endsWith("/api/courses")) {
        return Response.json({
          courses: [
            {
              id: SAMPLE_COURSE.id,
              title: SAMPLE_COURSE.brief.title,
              audience: SAMPLE_COURSE.brief.audience,
              programKind: "general",
              durationHours: 24,
              attestationHours: 0,
              version: 1,
              updatedAt: SAMPLE_COURSE.updatedAt,
            },
          ],
        });
      }
      return Response.json({ course: SAMPLE_COURSE, messages: [], version: 1 });
    });
    vi.stubGlobal("fetch", fetchImpl);

    expect(api.hasBackendStorage()).toBe(true);
    expect(await api.saveCourseToBackend(SAMPLE_COURSE, [], "copy", 1)).toBe(true);
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toMatchObject({
      reason: "copy",
      expectedVersion: 1,
    });
    const listed = await api.listCoursesFromBackend();
    expect(listed?.courses[0]?.durationHours).toBe(24);
    const copied = await api.copyCourseOnBackend(SAMPLE_COURSE.id);
    expect(copied?.version).toBe(2);
    const loaded = await api.loadCourseFromBackend(SAMPLE_COURSE.id);
    expect(loaded?.course.id).toBe(SAMPLE_COURSE.id);
    expect(await api.deleteCourseFromBackend(SAMPLE_COURSE.id)).toBe(true);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      `http://studio.local/api/courses/${encodeURIComponent(SAMPLE_COURSE.id)}`,
    );
  });

  it("пробрасывает ошибки HTTP и считает 404 отсутствием курса", async () => {
    const api = await loadBackend("http://studio.local");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("fail", { status: 500 })),
    );
    await expect(api.saveCourseToBackend(SAMPLE_COURSE, [])).rejects.toThrow(/500/);
    await expect(api.listCoursesFromBackend()).rejects.toThrow(/список/);
    await expect(api.copyCourseOnBackend("missing")).rejects.toThrow(/скопировать/);
    await expect(api.loadCourseFromBackend("missing")).rejects.toThrow(/загрузить/);
    await expect(api.deleteCourseFromBackend("missing")).rejects.toThrow(/удалить/);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("gone", { status: 404 })),
    );
    expect(await api.copyCourseOnBackend("missing")).toBeNull();
    expect(await api.loadCourseFromBackend("missing")).toBeNull();
    expect(await api.deleteCourseFromBackend("missing")).toBe(false);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("conflict", { status: 409 })),
    );
    await expect(api.saveCourseToBackend(SAMPLE_COURSE, [], "autosave", 0)).rejects.toThrow(
      /другая вкладка/,
    );
  });
});
