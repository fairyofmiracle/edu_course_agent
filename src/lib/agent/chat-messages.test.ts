import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { sanitizeMessagesForCloudRu } from "@/lib/agent/chat-messages";

describe("sanitizeMessagesForCloudRu", () => {
  it("убирает вызов функции, которой нет в tools", () => {
    const messages = [
      {
        id: "1",
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            toolName: "set_slides",
            toolCallId: "c1",
            state: "output-available",
            input: {},
            output: {},
          },
          { type: "text", text: "готово" },
        ],
      },
    ] as UIMessage[];
    const next = sanitizeMessagesForCloudRu(messages);
    expect(next[0].parts).toEqual([{ type: "text", text: "готово" }]);
  });

  it("убирает оборванный tool_call без результата", () => {
    const messages = [
      {
        id: "1",
        role: "assistant",
        parts: [
          {
            type: "tool-set_structure",
            toolCallId: "c2",
            state: "input-available",
            input: { modules: [] },
          },
        ],
      },
      {
        id: "2",
        role: "user",
        parts: [{ type: "text", text: "ещё раз" }],
      },
    ] as UIMessage[];
    const next = sanitizeMessagesForCloudRu(messages);
    expect(next).toHaveLength(1);
    expect(next[0].role).toBe("user");
  });

  it("оставляет завершённые известные tools", () => {
    const messages = [
      {
        id: "1",
        role: "assistant",
        parts: [
          {
            type: "tool-set_lecture",
            toolCallId: "c3",
            state: "output-available",
            input: { moduleId: "m1" },
            output: { type: "set_lecture" },
          },
        ],
      },
    ] as UIMessage[];
    const next = sanitizeMessagesForCloudRu(messages);
    expect(next).toHaveLength(1);
    expect(next[0].parts).toHaveLength(1);
  });
});
