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

/** Выбирает разрешённый LLM-шлюз и соответствующий ему ключ. */
export function resolveLlmGateway() {
  const cloudruKey = envValue("CLOUDRU_API_KEY");
  const gigaschoolKey = envValue("GIGASCHOOL_API_KEY");

  if (cloudruKey) {
    const cloudruUrl =
      envValue("CLOUDRU_BASE_URL") ||
      "https://foundation-models.api.cloud.ru/v1";

    const validatedUrl = validateLlmEndpoint(cloudruUrl);

    if (validatedUrl !== "https://foundation-models.api.cloud.ru/v1") {
      throw new Error(
        "Для CLOUDRU_API_KEY разрешён только шлюз Cloud.ru.",
      );
    }

    return {
      apiKey: cloudruKey,
      baseURL: validatedUrl,
    };
  }

  if (gigaschoolKey) {
    const gigaschoolUrl =
      envValue("GIGASCHOOL_BASE_URL") ||
      "https://hub.gigaschool.ru/api/v1/llm/v1";

    const validatedUrl = validateLlmEndpoint(gigaschoolUrl);

    if (validatedUrl !== "https://hub.gigaschool.ru/api/v1/llm/v1") {
      throw new Error(
        "Для GIGASCHOOL_API_KEY разрешён только шлюз GigaSchool.",
      );
    }

    return {
      apiKey: gigaschoolKey,
      baseURL: validatedUrl,
    };
  }

  throw new Error(
    "Не задан CLOUDRU_API_KEY или GIGASCHOOL_API_KEY. " +
    "Разрешены только шлюзы Cloud.ru и GigaSchool.",
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
