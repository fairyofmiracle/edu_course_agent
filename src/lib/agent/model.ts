import { createOpenAI } from "@ai-sdk/openai";
import { normalizeCloudRuBody } from "@/lib/agent/cloudru-messages";
import { validateLlmEndpoint } from "@/lib/agent/llm-endpoint-policy";

const DEFAULT_BASE_URL = "https://foundation-models.api.cloud.ru/v1";
const DEFAULT_CHAT_MODEL = "GigaChat/GigaChat-3-Pro";
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

export const cloudRuFetch: typeof fetch = async (input, init) => {
  if (!init || typeof init.body !== "string") return fetch(input, { ...init, redirect: "error" });
  const body = normalizeCloudRuBody(init.body);
  const response = await fetch(input, { ...init, redirect: "error" });
  if (!response.ok) {
    const text = await response.clone().text();
    console.error(`[cloudru] ${response.status} ${text.slice(0, 300)}\n  запрос: ${describeBody(body)}`);
  }
  return response;
};

function envValue(name: string) {
  return process.env[name]?.trim() || "";
}

/** Ключ уходит только на разрешённый шлюз. CLOUDRU_API_KEY перекрывает OPENAI_API_KEY. */
export function resolveLlmGateway() {
  const cloudruKey = envValue("CLOUDRU_API_KEY");
  const openaiKey = envValue("OPENAI_API_KEY");
  const openaiUrl = envValue("OPENAI_BASE_URL");
  const cloudruUrl = envValue("CLOUDRU_BASE_URL") || DEFAULT_BASE_URL;

  if (cloudruKey) {
    return { apiKey: cloudruKey, baseURL: validateLlmEndpoint(cloudruUrl) };
  }
  if (openaiUrl) {
    return { apiKey: openaiKey, baseURL: validateLlmEndpoint(openaiUrl) };
  }
  if (openaiKey) {
    return { apiKey: openaiKey, baseURL: validateLlmEndpoint(DEFAULT_BASE_URL) };
  }
  throw new Error(
    "Не задан CLOUDRU_API_KEY или OPENAI_API_KEY. Второй ключ не открывает api.openai.com: адрес вне двух шлюзов отклоняется до запроса.",
  );
}

/** Клиент для тестов и локальной отладки. Боевой чат и /api/run идут в FastAPI. */
export function getLanguageModel(role: "chat" | "writer" = "writer") {
  const { apiKey, baseURL } = resolveLlmGateway();

  const cloud = createOpenAI({
    name: "cloudru",
    apiKey,
    baseURL,
    fetch: cloudRuFetch,
  });

  const chatModel = process.env.CLOUDRU_MODEL?.trim() || DEFAULT_CHAT_MODEL;
  const writerModel =
    process.env.CLOUDRU_MODEL_WRITER?.trim() || process.env.CLOUDRU_MODEL?.trim() || DEFAULT_WRITER_MODEL;

  return cloud.chat(role === "chat" ? chatModel : writerModel);
}
