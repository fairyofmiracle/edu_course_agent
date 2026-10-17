import { describe, expect, it } from "vitest";
import { normalizeCloudRuMessages, type OpenAIMessage } from "@/lib/agent/cloudru-messages";

const call = (id: string, name = "update_brief") => ({
  id,
  type: "function",
  function: { name, arguments: "{}" },
});

describe("normalizeCloudRuMessages", () => {
  it("склеивает два user подряд после ошибки", () => {
    const next = normalizeCloudRuMessages([
      { role: "system", content: "s" },
      { role: "user", content: [{ type: "text", text: "Python 16 ч" }] },
      { role: "user", content: [{ type: "text", text: "Python 16 ч" }] },
    ]);
    expect(next.map((item) => item.role)).toEqual(["system", "user"]);
    expect(next[1].content).toBe("Python 16 ч");
  });

  it("раскладывает несколько tool_calls по одному и выкидывает вызов без ответа", () => {
    const next = normalizeCloudRuMessages([
      { role: "user", content: "x" },
      { role: "assistant", content: "", tool_calls: [call("a"), call("b", "set_structure"), call("c")] },
      { role: "tool", tool_call_id: "a", content: "{}" },
      { role: "tool", tool_call_id: "b", content: "{}" },
      { role: "user", content: "дальше" },
    ] as OpenAIMessage[]);
    expect(next.map((item) => item.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
      "tool",
      "assistant",
      "user",
    ]);
    expect(next[1].tool_calls).toHaveLength(1);
    expect(next[3].tool_calls?.[0].id).toBe("b");
  });

  it("склеивает два assistant подряд и убирает служебные токены", () => {
    const next = normalizeCloudRuMessages([
      { role: "user", content: "x" },
      { role: "assistant", content: "Каркас<|role_sep|> готов" },
      { role: "assistant", content: "Жмите кнопку" },
    ]);
    expect(next).toHaveLength(2);
    expect(next[1].content).toBe("Каркас готов\n\nЖмите кнопку");
  });
});
