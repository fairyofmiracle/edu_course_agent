import { createOpenAI } from "@ai-sdk/openai";

const DEFAULT_BASE_URL = "https://foundation-models.api.cloud.ru/v1";
const DEFAULT_MODEL = "t-tech/T-pro-it-2.0";

export function getLanguageModel() {
  const apiKey = process.env.CLOUDRU_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "Не задан CLOUDRU_API_KEY. Добавьте ключ Foundation Models из Cloud.ru Evolution в .env.local — см. .env.example.",
    );
  }

  const cloud = createOpenAI({
    name: "cloudru",
    apiKey,
    baseURL: process.env.CLOUDRU_BASE_URL?.trim() || DEFAULT_BASE_URL,
  });

  return cloud.chat(process.env.CLOUDRU_MODEL?.trim() || DEFAULT_MODEL);
}
