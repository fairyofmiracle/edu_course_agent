import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { sumTokenUsage } from "./token-usage";

function assistantMessage(
  id: string,
  prompt: number,
  completion: number,
): UIMessage {
  return {
    id,
    role: "assistant",
    parts: [{ type: "text", text: "Готово" }],
    metadata: {
      usage: {
        prompt_tokens: prompt,
        completion_tokens: completion,
        total_tokens: prompt + completion,
        calls: 1,
      },
    },
  };
}

describe("sumTokenUsage", () => {
  it("суммирует токены нескольких ответов", () => {
    const messages = [
      assistantMessage("1", 100, 50),
      assistantMessage("2", 200, 80),
    ];

    expect(sumTokenUsage(messages)).toEqual({
      prompt_tokens: 300,
      completion_tokens: 130,
      total_tokens: 430,
      calls: 2,
    });
  });

  it("не считает повторное сообщение дважды", () => {
    const message = assistantMessage("1", 100, 50);

    expect(sumTokenUsage([message, message])).toEqual({
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      calls: 1,
    });
  });

  it("восстанавливает статистику из сохранённой истории", () => {
    const original = [assistantMessage("1", 100, 50)];
    const restored = JSON.parse(JSON.stringify(original)) as UIMessage[];

    expect(sumTokenUsage(restored).total_tokens).toBe(150);
  });

  it("начинает с нуля для нового курса", () => {
    const previousCourse = [assistantMessage("1", 100, 50)];

    expect(sumTokenUsage(previousCourse).total_tokens).toBe(150);
    expect(sumTokenUsage([]).total_tokens).toBe(0);
  });
});
