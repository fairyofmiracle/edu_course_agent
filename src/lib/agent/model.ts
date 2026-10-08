import { createOpenAI } from "@ai-sdk/openai";
import { getSberAccessToken } from "@/lib/sber-auth";

export async function getLanguageModel() {
  const credentials = process.env.GIGACHAT_CREDENTIALS?.trim();
  if (!credentials) {
    throw new Error(
      "Не задан GIGACHAT_CREDENTIALS. Добавьте ключ авторизации GigaChat в .env.local — см. .env.example.",
    );
  }

  const accessToken = await getSberAccessToken({
    credentials,
    scope: process.env.GIGACHAT_SCOPE?.trim() || "GIGACHAT_API_PERS",
  });

  const gigachat = createOpenAI({
    name: "gigachat",
    apiKey: accessToken,
    baseURL: process.env.GIGACHAT_BASE_URL?.trim() || "https://api.giga.chat/v1",
  });

  return gigachat.chat(process.env.GIGACHAT_MODEL?.trim() || "GigaChat");
}
