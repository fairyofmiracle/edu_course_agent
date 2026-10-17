import { createOpenAI } from "@ai-sdk/openai";
import { normalizeCloudRuBody } from "@/lib/agent/cloudru-messages";

const DEFAULT_BASE_URL = "https://foundation-models.api.cloud.ru/v1";
const DEFAULT_CHAT_MODEL = "ai-sage/GigaChat3-10B-A1.8B";
const DEFAULT_WRITER_MODEL = "GigaChat/GigaChat-3-Pro";

function describeBody(body: string) {
  try {
    const parsed = JSON.parse(body) as {
      messages?: Array<{ role: string; tool_calls?: Array<{ function: { name: string } }> }>;
      tools?: unknown[];
      tool_choice?: unknown;
    };
    const roles = (parsed.messages ?? [])
      .map((item) => (item.tool_calls ? `assistant(${item.tool_calls.map((call) => call.function.name)})` : item.role))
      .join(" ");
    return `tools=${parsed.tools?.length ?? 0} choice=${JSON.stringify(parsed.tool_choice ?? null)} | ${roles}`;
  } catch {
    return "тело не JSON";
  }
}

const cloudRuFetch: typeof fetch = async (input, init) => {
  if (!init || typeof init.body !== "string") return fetch(input, init);
  const body = normalizeCloudRuBody(init.body);
  const response = await fetch(input, { ...init, body });
  if (!response.ok) {
    const text = await response.clone().text();
    console.error(`[cloudru] ${response.status} ${text.slice(0, 300)}\n  запрос: ${describeBody(body)}`);
  }
  return response;
};

export function getLanguageModel(role: "chat" | "writer" = "writer") {
  const apiKey = process.env.CLOUDRU_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "Не задан CLOUDRU_API_KEY. Добавьте ключ Foundation Models из Cloud.ru Evolution в .env — см. .env.example.",
    );
  }

  const cloud = createOpenAI({
    name: "cloudru",
    apiKey,
    baseURL: process.env.CLOUDRU_BASE_URL?.trim() || DEFAULT_BASE_URL,
    fetch: cloudRuFetch,
  });

  const chatModel = process.env.CLOUDRU_MODEL?.trim() || DEFAULT_CHAT_MODEL;
  const writerModel =
    process.env.CLOUDRU_MODEL_WRITER?.trim() || process.env.CLOUDRU_MODEL?.trim() || DEFAULT_WRITER_MODEL;

  return cloud.chat(role === "chat" ? chatModel : writerModel);
}
