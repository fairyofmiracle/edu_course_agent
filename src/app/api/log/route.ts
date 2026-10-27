import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";

const MAX_LINE = 8000;

function dayStamp(value?: string) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function studioToken(): string {
  return process.env.STUDIO_API_TOKEN?.trim() ?? "";
}

function bearerMatches(req: Request, expected: string): boolean {
  const header = req.headers.get("authorization") ?? "";
  const supplied = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";
  if (!supplied || supplied.length !== expected.length) {
    return false;
  }
  try {
    return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
  } catch {
    return false;
  }
}

/** Browser persistLog is same-origin and has no STUDIO_API_TOKEN. */
function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) {
    return false;
  }
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  const token = studioToken();
  // Prod token: allow Bearer OR same-origin browser writes. Cross-origin without
  // Bearer stays closed. Local/dev without token stays open.
  if (token && !bearerMatches(req, token) && !isSameOrigin(req)) {
    return Response.json(
      { error: "API студии закрыт. Нужен STUDIO_API_TOKEN." },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return Response.json({ error: "Нужна запись лога" }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  const line = JSON.stringify({
    ...record,
    savedAt: new Date().toISOString(),
  });
  if (line.length > MAX_LINE) {
    return Response.json({ error: "Запись слишком длинная" }, { status: 400 });
  }

  const dir = path.join(process.cwd(), "logs");
  await mkdir(dir, { recursive: true });
  const at = typeof record.at === "string" ? record.at : undefined;
  const file = path.join(dir, `${dayStamp(at)}.jsonl`);
  await appendFile(file, `${line}\n`, "utf8");
  return Response.json({ ok: true, file: path.basename(file) });
}
