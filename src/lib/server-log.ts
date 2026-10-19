import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

function dayStamp() {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export async function appendServerLog(entry: Record<string, unknown>) {
  try {
    const dir = path.join(process.cwd(), "logs");
    await mkdir(dir, { recursive: true });
    const line = JSON.stringify({
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      role: "server",
      ...entry,
    });
    await appendFile(path.join(dir, `${dayStamp()}.jsonl`), `${line}\n`, "utf8");
  } catch (error) {
    console.error("[log] не записан:", error);
  }
}

export function describeError(error: unknown) {
  if (!(error instanceof Error)) return String(error);
  const status = (error as { statusCode?: number }).statusCode;
  return status ? `${status} ${error.message}` : error.message;
}

export function chatFailureText(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  const message = describeError(error);
  if (name === "TimeoutError" || name === "AbortError" || /abort|timed out|timeout/i.test(message)) {
    return "Шлюз не ответил за отведённое время. Каркас на месте, шаг можно повторить.";
  }
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|network/i.test(message)) {
    return "Студия не достучалась до API. Проверьте, что сервер на порту 8000 запущен, и повторите шаг.";
  }
  return message;
}
