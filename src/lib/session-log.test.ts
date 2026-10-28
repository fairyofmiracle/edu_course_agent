import { afterEach, describe, expect, it, vi } from "vitest";
import type { UIMessage } from "ai";
import {
  actionEntry,
  clipLogText,
  entryFromMessage,
  errorEntry,
  failedChecks,
  messageText,
  messageTools,
  persistLog,
  uniqueLabels,
} from "@/lib/session-log";

describe("session log", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("обрезает длинный текст и собирает запись из сообщения", () => {
    expect(clipLogText("  коротко  ")).toBe("коротко");
    expect(clipLogText("я".repeat(4001))).toHaveLength(4001);

    const empty = { id: "e", role: "user", parts: [{ type: "text", text: "  " }] } as UIMessage;
    expect(messageText(empty)).toBe("");
    expect(entryFromMessage({ sessionId: "s", message: empty })).toBeNull();

    const assistant = {
      id: "a",
      role: "assistant",
      parts: [
        { type: "text", text: "готово" },
        {
          type: "tool-set_lecture",
          toolCallId: "c1",
          state: "output-available",
          input: {},
          output: {},
        },
        {
          type: "dynamic-tool",
          toolName: "custom_tool",
          toolCallId: "c2",
          state: "output-available",
          input: {},
          output: {},
        },
      ],
    } as UIMessage;
    expect(messageTools(assistant)).toEqual(["лекция", "custom_tool"]);
    const entry = entryFromMessage({
      sessionId: "s",
      message: assistant,
      checks: [
        { id: "hours", label: "Часы", ok: false },
        { id: "goals", label: "Цели", ok: true },
      ],
    });
    expect(entry?.tools).toEqual(["лекция", "custom_tool"]);
    expect(entry?.failed).toEqual(["Часы"]);
    expect(failedChecks([])).toEqual([]);

    const toolsOnly = {
      id: "t",
      role: "assistant",
      parts: [
        {
          type: "tool-update_brief",
          toolCallId: "c3",
          state: "output-available",
          input: {},
          output: {},
        },
      ],
    } as UIMessage;
    expect(entryFromMessage({ sessionId: "s", message: toolsOnly })?.text).toContain("бриф");
  });

  it("пишет действия и ошибки и не падает, если журнал недоступен", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => "log-1" });
    const action = actionEntry("s", "Открыт пример");
    expect(action.role).toBe("action");
    expect(errorEntry("s", "x".repeat(5000)).text.endsWith("…")).toBe(true);

    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    });
    vi.stubGlobal("fetch", fetchImpl);
    persistLog(action);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
  });
});

describe("uniqueLabels", () => {
  it("keeps first occurrence and drops duplicates", () => {
    expect(uniqueLabels(["Бриф", "Бриф", "Бриф", "План", "Бриф", "Лекция"])).toEqual([
      "Бриф",
      "План",
      "Лекция",
    ]);
  });

  it("returns empty for empty input", () => {
    expect(uniqueLabels([])).toEqual([]);
  });
});

describe("messageTools dedupe", () => {
  it("shows each tool label once", () => {
    const message = {
      id: "m1",
      role: "assistant",
      parts: [
        { type: "tool-update_brief", toolCallId: "1", state: "output-available", input: {}, output: {} },
        { type: "tool-update_brief", toolCallId: "2", state: "output-available", input: {}, output: {} },
        { type: "tool-set_structure", toolCallId: "3", state: "output-available", input: {}, output: {} },
        { type: "tool-update_brief", toolCallId: "4", state: "output-available", input: {}, output: {} },
      ],
    } as unknown as UIMessage;
    expect(messageTools(message)).toEqual(["бриф", "план"]);
  });
});
