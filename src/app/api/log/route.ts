import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

const MAX_LINE = 8000;

function dayStamp(value?: string) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export async function POST(req: Request) {
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
