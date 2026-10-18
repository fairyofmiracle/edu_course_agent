
const ALLOWED_ENDPOINTS = new Set([
  "https://foundation-models.api.cloud.ru/v1",
  "https://hub.gigaschool.ru/api/v1/llm/v1",
]);

export function validateLlmEndpoint(value: string): string {
  let url: URL;

  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Некорректный адрес LLM API");
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  ) {
    throw new Error("Недопустимый адрес LLM API");
  }

  const normalized = `${url.origin}${url.pathname.replace(/\/+$/, "")}`;

  if (!ALLOWED_ENDPOINTS.has(normalized)) {
    throw new Error(
      `LLM API запрещён политикой проекта: ${url.hostname}`,
    );
  }

  return normalized;
}
