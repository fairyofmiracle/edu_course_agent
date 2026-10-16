export type SourceProbeState =
  | "reachable"
  | "unavailable"
  | "not_found"
  | "blocked"
  | "not_checked";

export type SourceProbeResult = {
  url: string;
  state: SourceProbeState;
  message: string;
  fingerprint?: string;
};

export type SourceCheck =
  | { state: "empty" }
  | { state: "disabled" }
  | { state: "down"; message: string }
  | { state: "ready"; results: SourceProbeResult[] };

const configuredBase = process.env.NEXT_PUBLIC_PYTHON_API_URL?.trim().replace(/\/$/, "") || "";

export async function checkSources(
  urls: string[],
  options: { base?: string; fetchImpl?: typeof fetch } = {},
): Promise<SourceCheck> {
  const base = (options.base ?? configuredBase).replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  if (urls.length === 0) return { state: "empty" };
  if (!base) {
    return { state: "disabled" };
  }
  try {
    const response = await fetchImpl(`${base}/api/sources/probe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls }),
    });
    if (!response.ok) {
      return { state: "down", message: `Сервер проверки ответил ${response.status}. Ссылки не подтверждены.` };
    }
    const body = (await response.json()) as { results?: SourceProbeResult[] };
    return { state: "ready", results: body.results ?? [] };
  } catch {
    return {
      state: "down",
      message: "Сервер проверки не ответил. Ссылки не подтверждены и не заменяются сохранённой копией приказа.",
    };
  }
}
