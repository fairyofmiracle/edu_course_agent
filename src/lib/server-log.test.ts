import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appendServerLog, chatFailureText, describeError } from "@/lib/server-log";

describe("server log", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("описывает ошибку с кодом и без", () => {
    expect(describeError("сбой")).toBe("сбой");
    expect(describeError(new Error("нет сети"))).toBe("нет сети");
    const coded = new Error("отказ");
    (coded as Error & { statusCode?: number }).statusCode = 429;
    expect(describeError(coded)).toBe("429 отказ");
    expect(chatFailureText(Object.assign(new Error("The operation was aborted"), { name: "TimeoutError" }))).toMatch(
      /Шлюз не ответил/,
    );
    expect(chatFailureText(new Error("fetch failed"))).toMatch(/не достучалась/);
    expect(chatFailureText(new Error("document is not defined"))).toMatch(/кнопкой в студии|повторите/i);
    expect(chatFailureText(new Error("HTTP 502 Cloud.ru Traceback"))).not.toMatch(/Traceback|502/);
    expect(chatFailureText(new Error("ZodError: /src/lib/course-schema.ts"))).not.toMatch(/ZodError|course-schema/);
  });

  it("дописывает строку журнала и молчит, если каталог недоступен", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "studio-log-"));
    dirs.push(dir);
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    vi.stubGlobal("crypto", { randomUUID: () => "srv-1" });
    await appendServerLog({ text: "старт" });
    const stamp = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 10);
    const line = await readFile(path.join(dir, "logs", `${stamp}.jsonl`), "utf8");
    expect(line).toContain("старт");
    expect(line).toContain("srv-1");
    vi.mocked(process.cwd).mockReturnValue("\0");
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await appendServerLog({ text: "мимо" });
    expect(error).toHaveBeenCalled();
  });
});
