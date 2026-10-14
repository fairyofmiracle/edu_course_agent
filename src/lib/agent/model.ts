import { createOpenAI } from "@ai-sdk/openai";

const DEFAULT_BASE_URL = "https://foundation-models.api.cloud.ru/v1";
const DEFAULT_CHAT_MODEL = "ai-sage/GigaChat3-10B-A1.8B";
const DEFAULT_WRITER_MODEL = "GigaChat/GigaChat-3-Pro";

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
  });

  const chatModel = process.env.CLOUDRU_MODEL?.trim() || DEFAULT_CHAT_MODEL;
  const writerModel =
    process.env.CLOUDRU_MODEL_WRITER?.trim() || process.env.CLOUDRU_MODEL?.trim() || DEFAULT_WRITER_MODEL;

  return cloud.chat(role === "chat" ? chatModel : writerModel);
}
