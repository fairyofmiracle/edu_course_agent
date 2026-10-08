const OAUTH_URL = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth";

type CachedToken = {
  accessToken: string;
  expiresAt: number;
};

const cache = new Map<string, CachedToken>();

function basicCredentials(credentials: string) {
  return credentials.trim().replace(/^Basic\s+/i, "");
}

function expiryMs(expiresAt: number) {
  return expiresAt > 10_000_000_000 ? expiresAt : expiresAt * 1000;
}

export function explainSberError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  if (/certificate|CERT_|self-signed|UNABLE_TO_VERIFY|fetch failed/i.test(message)) {
    return `${message}. Если это ошибка сертификата Сбера, укажите NODE_EXTRA_CA_CERTS с корневым сертификатом НУЦ Минцифры.`;
  }
  return message;
}

export async function getSberAccessToken(options: {
  credentials: string;
  scope: string;
}) {
  const credentials = basicCredentials(options.credentials);
  const cacheKey = `${options.scope}:${credentials}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt - 60_000 > Date.now()) {
    return cached.accessToken;
  }

  let response: Response;
  try {
    response = await fetch(OAUTH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        RqUID: crypto.randomUUID(),
        Authorization: `Basic ${credentials}`,
      },
      body: new URLSearchParams({ scope: options.scope }),
    });
  } catch (error) {
    throw new Error(explainSberError(error, "Не удалось получить токен доступа"));
  }

  const payload = (await response.json().catch(() => null)) as {
    access_token?: string;
    expires_at?: number;
    error_description?: string;
    message?: string;
  } | null;

  if (!response.ok || !payload?.access_token) {
    const detail = payload?.error_description || payload?.message;
    throw new Error(
      detail
        ? `Авторизация Сбера: ${detail}`
        : `Авторизация Сбера ответила ${response.status}`,
    );
  }

  const expiresAt =
    typeof payload.expires_at === "number" ? expiryMs(payload.expires_at) : Date.now() + 25 * 60_000;
  cache.set(cacheKey, { accessToken: payload.access_token, expiresAt });
  return payload.access_token;
}
