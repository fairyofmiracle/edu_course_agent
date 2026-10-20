import { afterEach, describe, expect, it, vi } from "vitest";
import { LIBRARY_KEY } from "@/lib/course-library";
import { SAMPLE_COURSE } from "@/lib/sample-course";
import {
  clearStudioStorage,
  dropStoredCourse,
  loadSessionId,
  loadStoredCourse,
  loadStoredMessages,
  newSessionId,
  saveCourse,
  saveMessages,
} from "@/lib/storage";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    keys: () => [...data.keys()],
  };
}

describe("storage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("без окна возвращает пустой курс и не пишет", () => {
    vi.stubGlobal("window", undefined);
    expect(loadStoredCourse().brief.title).toBe("");
    expect(loadStoredMessages()).toEqual([]);
    expect(loadSessionId()).toBe("session");
    expect(newSessionId()).toBe("session");
    saveCourse(SAMPLE_COURSE, []);
    saveMessages([]);
    clearStudioStorage();
  });

  it("сохраняет курс, чат и сессию, а очистка не стирает библиотеку", () => {
    let n = 0;
    const storage = memoryStorage();
    vi.stubGlobal("window", { localStorage: storage });
    vi.stubGlobal("crypto", { randomUUID: () => `id-${++n}` });

    expect(loadStoredCourse().brief.title).toBe("");
    saveCourse(SAMPLE_COURSE, [{ id: "m1", role: "user", parts: [] }]);
    expect(loadStoredCourse().id).toBe(SAMPLE_COURSE.id);
    expect(loadStoredMessages()[0]?.id).toBe("m1");
    expect(storage.keys()).toContain(LIBRARY_KEY);

    saveMessages([{ id: "m1", role: "user", parts: [{ type: "text", text: "привет" }] }]);
    expect(loadStoredMessages()[0]?.id).toBe("m1");

    const session = loadSessionId();
    expect(session.startsWith("id-")).toBe(true);
    expect(loadSessionId()).toBe(session);
    expect(newSessionId()).not.toBe(session);

    storage.setItem("edu-course-agent:course", "{");
    storage.setItem("edu-course-agent:messages", "{");
    expect(loadStoredCourse().brief.title).toBe("");
    expect(loadStoredMessages()).toEqual([]);

    clearStudioStorage();
    expect(storage.getItem("edu-course-agent:course")).toBeNull();
    expect(storage.getItem(LIBRARY_KEY)).toContain(SAMPLE_COURSE.id);
  });

  it("удаление открытого курса очищает студию и оставляет остальные", () => {
    const storage = memoryStorage();
    vi.stubGlobal("window", { localStorage: storage });
    saveCourse(SAMPLE_COURSE, [{ id: "m1", role: "user", parts: [] }]);
    const other = { ...SAMPLE_COURSE, id: "other-course", brief: { ...SAMPLE_COURSE.brief, title: "Другой" } };
    saveCourse(other, []);

    expect(dropStoredCourse(SAMPLE_COURSE.id)).toBe(false);
    expect(loadStoredCourse().id).toBe(other.id);
    expect(storage.getItem(LIBRARY_KEY)).not.toContain(SAMPLE_COURSE.id);

    expect(dropStoredCourse(other.id)).toBe(true);
    expect(storage.getItem("edu-course-agent:course")).toBeNull();
    expect(storage.getItem(LIBRARY_KEY)).toBe("{}");
  });

  it("переполнение не роняет запись и не стирает прежний курс", () => {
    const data = new Map<string, string>();
    let blockCourse = false;
    let blockLibrary = false;
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (blockCourse && key === "edu-course-agent:course") throw new Error("quota");
        if (blockLibrary && key === LIBRARY_KEY && value.includes("длинный-диалог")) {
          throw new Error("quota");
        }
        data.set(key, value);
      },
      removeItem: (key: string) => {
        data.delete(key);
      },
    };
    vi.stubGlobal("window", { localStorage: storage });
    saveCourse(SAMPLE_COURSE, [{ id: "m1", role: "user", parts: [] }]);
    const kept = storage.getItem("edu-course-agent:course");

    blockCourse = true;
    const blocked = saveCourse(
      { ...SAMPLE_COURSE, brief: { ...SAMPLE_COURSE.brief, title: "Не записалось" } },
      [],
    );
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.message).toContain("не записалась");
    expect(storage.getItem("edu-course-agent:course")).toBe(kept);

    blockCourse = false;
    blockLibrary = true;
    const listed = saveCourse(SAMPLE_COURSE, [
      { id: "m2", role: "user", parts: [{ type: "text", text: "длинный-диалог" }] },
    ]);
    expect(listed.ok).toBe(false);
    if (!listed.ok) expect(listed.message).toContain("в списке");
    expect(storage.getItem(LIBRARY_KEY)).toContain(SAMPLE_COURSE.id);
    expect(storage.getItem(LIBRARY_KEY)).not.toContain("длинный-диалог");
    expect(loadStoredCourse().id).toBe(SAMPLE_COURSE.id);
  });
});
