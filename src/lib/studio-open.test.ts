import { describe, expect, it } from "vitest";
import { rememberCourse } from "@/lib/course-library";
import { createEmptyCourse } from "@/lib/course-schema";
import { SAMPLE_COURSE } from "@/lib/sample-course";
import { openOfflineSample, resolveStudioOpen } from "@/lib/studio-open";

function memory() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("resolveStudioOpen", () => {
  it("пример не подменяет открытый курс и не просит его записывать", () => {
    const storage = memory();
    const open = createEmptyCourse();
    open.id = "рабочий";
    open.brief = { ...open.brief, title: "Рабочая программа" };
    storage.setItem("edu-course-agent:course", JSON.stringify(open));
    storage.setItem(
      "edu-course-agent:messages",
      JSON.stringify([{ id: "m1", role: "user", parts: [] }]),
    );

    const resolved = resolveStudioOpen({ sample: true }, storage);
    expect(resolved.persist).toBe(false);
    expect(resolved.rotateSession).toBe(false);
    expect(resolved.course.id).toBe(SAMPLE_COURSE.id);
    expect(resolved.messages).toEqual([]);
    expect(resolved.notice).toContain("пример");
    expect(storage.getItem("edu-course-agent:course")).toContain("Рабочая программа");
    expect(storage.getItem("edu-course-agent:messages")).toContain("m1");
  });

  it("ссылка открывает курс из списка, а не то, что лежало в слоте студии", () => {
    const storage = memory();
    const current = createEmptyCourse();
    current.id = "текущий";
    current.brief = { ...current.brief, title: "Текущий" };
    const linked = createEmptyCourse();
    linked.id = "по-ссылке";
    linked.brief = { ...linked.brief, title: "По ссылке" };
    storage.setItem("edu-course-agent:course", JSON.stringify(current));
    rememberCourse(linked, [{ id: "dialog", role: "user", parts: [] }], storage);

    const resolved = resolveStudioOpen({ courseId: linked.id }, storage);
    expect(resolved.course.id).toBe("по-ссылке");
    expect(resolved.course.brief.title).toBe("По ссылке");
    expect(resolved.messages[0]?.id).toBe("dialog");
    expect(resolved.persist).toBe(true);
    expect(storage.getItem("edu-course-agent:course")).toContain("Текущий");
  });

  it("без ссылки открывает программу, которая уже лежит в браузере", () => {
    const storage = memory();
    const open = createEmptyCourse();
    open.brief = { ...open.brief, title: "На экране" };
    storage.setItem("edu-course-agent:course", JSON.stringify(open));
    storage.setItem(
      "edu-course-agent:messages",
      JSON.stringify([{ id: "m1", role: "user", parts: [] }]),
    );

    const resolved = resolveStudioOpen({}, storage);
    expect(resolved.persist).toBe(true);
    expect(resolved.rotateSession).toBe(false);
    expect(resolved.notice).toBe("");
    expect(resolved.course.brief.title).toBe("На экране");
    expect(resolved.messages[0]?.id).toBe("m1");
  });

  it("неизвестная ссылка не затирает открытую программу", () => {
    const storage = memory();
    const current = createEmptyCourse();
    current.id = "текущий";
    current.brief = { ...current.brief, title: "Текущий" };
    storage.setItem("edu-course-agent:course", JSON.stringify(current));

    const resolved = resolveStudioOpen({ courseId: "нет-такого" }, storage);
    expect(resolved.persist).toBe(false);
    expect(resolved.course.id).not.toBe("текущий");
    expect(resolved.notice).toContain("не найден");
    expect(storage.getItem("edu-course-agent:course")).toContain("Текущий");
  });

  it("офлайн-пример открывает один и тот же курс, а не новый экземпляр", () => {
    const storage = memory();
    const first = openOfflineSample("другой", storage);
    expect(first?.course.id).toBe(SAMPLE_COURSE.id);
    rememberCourse(first!.course, [{ id: "пример", role: "user", parts: [] }], storage);

    const again = openOfflineSample("другой", storage);
    expect(again?.course.id).toBe(SAMPLE_COURSE.id);
    expect(again?.messages[0]?.id).toBe("пример");
    expect(openOfflineSample(SAMPLE_COURSE.id, storage)).toBeNull();
  });
});