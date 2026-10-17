import { describe, expect, it } from "vitest";
import { noticeFor, noticeText, readStamps, writeStamp } from "@/lib/source-watch";

const when = (iso: string) => iso;

function memory() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("уведомление об изменении страницы приказа", () => {
  it("первую отметку запоминает, совпадение и изменение различает", () => {
    expect(noticeFor(undefined, "")).toEqual({ kind: "unchecked" });
    expect(noticeFor(undefined, "stamp-a").kind).toBe("first");
    const previous = { url: "https://example.com/order", fingerprint: "stamp-a", seenAt: "2026-10-01" };
    expect(noticeFor(previous, "stamp-a")).toEqual({ kind: "same", seenAt: "2026-10-01" });
    expect(noticeFor(previous, "stamp-b")).toEqual({ kind: "changed", seenAt: "2026-10-01" });
    expect(noticeFor(previous, "").kind).toBe("offline");
  });

  it("текст предупреждения не называет изменение страницы новым приказом", () => {
    const text = noticeText({ kind: "changed", seenAt: "2026-10-01" }, when);
    expect(text).toContain("2026-10-01");
    expect(text).toContain("не значит, что вышел новый приказ");
    expect(noticeText({ kind: "offline", seenAt: "2026-10-01" }, when)).toContain("сказать нельзя");
  });

  it("после сверки запоминает новую отметку и молчит, пока страница та же", () => {
    const storage = memory();
    writeStamp(storage, {
      url: "https://example.com/order",
      fingerprint: "stamp-a",
      seenAt: "2026-10-01",
    });
    expect(noticeFor(readStamps(storage)["https://example.com/order"], "stamp-b").kind).toBe("changed");
    writeStamp(storage, {
      url: "https://example.com/order",
      fingerprint: "stamp-b",
      seenAt: "2026-10-16",
    });
    expect(noticeFor(readStamps(storage)["https://example.com/order"], "stamp-b").kind).toBe("same");
  });

  it("битую запись в браузере не считает прошлой проверкой", () => {
    const storage = memory();
    storage.setItem("edu-course-source-watch", "{");
    expect(readStamps(storage)).toEqual({});
  });
});
