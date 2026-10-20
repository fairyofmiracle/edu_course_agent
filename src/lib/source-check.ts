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
  requisites?: "found" | "missing" | "unchecked";
};

export type SourceCheck =
  | { state: "empty" }
  | { state: "disabled" }
  | { state: "down"; message: string }
  | { state: "ready"; results: SourceProbeResult[] };

type ProbeReference = {
  source?: string | null;
  title?: string;
  note?: string | null;
};

/** Ключ проверки: ссылки и номера. Текст лекции и чат в него не входят. */
export function sourceProbeRequest(course: { brief: { references: ProbeReference[] } }) {
  const urls = course.brief.references
    .map((reference) => reference.source?.trim() || "")
    .filter((source) => /^https?:\/\//i.test(source));
  const expect: Record<string, string> = {};
  for (const url of urls) {
    const reference = course.brief.references.find((item) => item.source?.trim() === url);
    const number = `${reference?.title ?? ""} ${reference?.note ?? ""}`.match(/№\s*(\d+)/)?.[1] ?? "";
    if (number) expect[url] = number;
  }
  const cacheKey =
    urls.length === 0
      ? ""
      : `${urls.join("\n")}\n--\n${urls.map((url) => `${url}=${expect[url] ?? ""}`).join("\n")}`;
  return { urls, expect, cacheKey };
}

export function parseSourceProbeKey(cacheKey: string) {
  if (!cacheKey) return { urls: [] as string[], expect: {} as Record<string, string> };
  const [urlPart, expectPart = ""] = cacheKey.split("\n--\n");
  const urls = urlPart ? urlPart.split("\n") : [];
  const expect: Record<string, string> = {};
  for (const row of expectPart ? expectPart.split("\n") : []) {
    const cut = row.lastIndexOf("=");
    if (cut <= 0) continue;
    const url = row.slice(0, cut);
    const number = row.slice(cut + 1);
    if (number) expect[url] = number;
  }
  return { urls, expect };
}

const configuredBase = process.env.NEXT_PUBLIC_PYTHON_API_URL?.trim().replace(/\/$/, "") || "";

export async function checkSources(
  urls: string[],
  options: { base?: string; fetchImpl?: typeof fetch; expect?: Record<string, string> } = {},
): Promise<SourceCheck> {
  const gate = (options.base ?? configuredBase).replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  if (urls.length === 0) return { state: "empty" };
  if (!gate) {
    return { state: "disabled" };
  }
  const probeUrl = options.base
    ? `${gate}/api/sources/probe`
    : "/api/backend/api/sources/probe";
  try {
    const response = await fetchImpl(probeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls, expect: options.expect ?? {} }),
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
