import { afterEach, describe, expect, it, vi } from "vitest";
import { LIBRARY_KEY } from "@/lib/course-library";
import { SAMPLE_COURSE } from "@/lib/sample-course";
import {
  clearStudioStorage,
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
});
