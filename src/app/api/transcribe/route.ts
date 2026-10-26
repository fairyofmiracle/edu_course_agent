import { chatFailureText } from "@/lib/server-log";

export const maxDuration = 90;

function pythonAgentUrl() {
  return process.env.PYTHON_AGENT_URL?.trim().replace(/\/$/, "") ?? "";
}

export async function POST(req: Request) {
  const pythonUrl = pythonAgentUrl();
  if (!pythonUrl) {
    return Response.json(
      { error: "Голос сейчас без API. Откройте студию через Docker на порту 8000." },
      { status: 503 },
    );
  }
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "Нужна запись." }, { status: 400 });
  }
  const body = new FormData();
  body.set("file", file, file.name || "speech.webm");
  try {
    const response = await fetch(`${pythonUrl}/api/transcribe`, {
      method: "POST",
      headers: process.env.STUDIO_API_TOKEN?.trim()
        ? { Authorization: `Bearer ${process.env.STUDIO_API_TOKEN.trim()}` }
        : {},
      body,
      signal: AbortSignal.timeout(70_000),
    });
    const payload = (await response.json()) as { detail?: string; text?: string };
    if (!response.ok) {
      return Response.json(
        { error: payload.detail || "Запись не разобралась." },
        { status: response.status },
      );
    }
    return Response.json({ text: payload.text ?? "" });
  } catch (error) {
    console.error("[transcribe] ошибка маршрута:", error);
    const name = error instanceof Error ? error.name : "";
    const message = error instanceof Error ? error.message : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return Response.json({ error: "Запись не успела разобраться." }, { status: 502 });
    }
    if (/fetch failed|ECONNREFUSED|ENOTFOUND|ECONNRESET|ETIMEDOUT|network/i.test(message)) {
      return Response.json(
        { error: "Студия не достучалась до голосового API. Повторите запись." },
        { status: 502 },
      );
    }
    return Response.json({ error: chatFailureText(error) }, { status: 502 });
  }
}
