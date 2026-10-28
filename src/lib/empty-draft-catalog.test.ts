import { describe, expect, it } from "vitest";
import {
  listLibrary,
  pruneEmptyLibraryDrafts,
  rememberCourse,
} from "@/lib/course-library";
import { createEmptyCourse, DEFAULT_COURSE_TITLE } from "@/lib/course-schema";

function memory() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("empty draft catalog", () => {
  it("не кладёт пустой черновик в каталог", () => {
    const storage = memory();
    const empty = createEmptyCourse();
    expect(rememberCourse(empty, [], storage)).toBe("skipped");
    expect(listLibrary(storage)).toEqual([]);
  });

  it("чистит уже сохранённые пустые «Новая программа»", () => {
    const storage = memory();
    const junk = createEmptyCourse();
    junk.brief = { ...junk.brief, title: DEFAULT_COURSE_TITLE };
    // force-write like старый баг
    storage.setItem(
      "edu-course-agent:library",
      JSON.stringify({ [junk.id]: { course: junk, messages: [] } }),
    );
    expect(pruneEmptyLibraryDrafts(storage)).toBe(1);
    expect(listLibrary(storage)).toEqual([]);
  });

  it("оставляет программу с содержанием", () => {
    const storage = memory();
    const course = createEmptyCourse();
    course.brief = { ...course.brief, title: "Кибербезопасность", audience: "админы", durationHours: 46 };
    expect(rememberCourse(course, [], storage)).toBe("saved");
    expect(listLibrary(storage)).toHaveLength(1);
  });
});
