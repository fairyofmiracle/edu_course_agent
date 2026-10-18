
import { describe, expect, it } from "vitest";
import { validateLlmEndpoint } from "./llm-endpoint-policy";

describe("LLM endpoint policy", () => {
  it.each([
    "https://foundation-models.api.cloud.ru/v1",
    "https://hub.gigaschool.ru/api/v1/llm/v1",
  ])("разрешает %s", (url) => {
    expect(validateLlmEndpoint(url)).toBe(url);
  });

  it.each([
    "https://api.openai.com/v1",
    "https://api.anthropic.com/v1",
    "https://generativelanguage.googleapis.com/v1beta",
    "http://foundation-models.api.cloud.ru/v1",
    "https://hub.gigaschool.ru.evil.example/api/v1/llm/v1",
    "https://hub.gigaschool.ru:8443/api/v1/llm/v1",
    "https://user:pass@hub.gigaschool.ru/api/v1/llm/v1",
  ])("блокирует %s", (url) => {
    expect(() => validateLlmEndpoint(url)).toThrow();
  });
});
