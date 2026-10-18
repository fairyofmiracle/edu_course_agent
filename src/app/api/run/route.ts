import { appendServerLog, describeError } from "@/lib/server-log";

export const maxDuration = 800;

type RunBody = {
  request?: string;
  answers?: string;
  references?: string;
  autoApprove?: boolean;
  caseId?: number;
};

/**
 * Прогон без браузера: текст запроса на вход, JSON программы на выход.
 * Оркестрация только в FastAPI. Без autoApprove останавливается на каркасе.
 */
export async function POST(req: Request) {
  let body: RunBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Некорректный JSON запроса" }, { status: 400 });
  }
  const request = body.request?.trim();
  if (!request) return Response.json({ error: "Нужно поле request" }, { status: 400 });

  const pythonUrl = process.env.PYTHON_AGENT_URL?.trim();
  if (!pythonUrl) {
    return Response.json(
      {
        error:
          "Не задан PYTHON_AGENT_URL. Прогон идёт только через FastAPI — см. .env.example.",
      },
      { status: 503 },
    );
  }

  try {
    const response = await fetch(`${pythonUrl.replace(/\/$/, "")}/api/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(790_000),
    });
    return new Response(response.body, {
      status: response.status,
      headers: { "Content-Type": response.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (error) {
    const text = describeError(error);
    void appendServerLog({ text: `Python /api/run недоступен: ${text}` });
    return Response.json({ error: text }, { status: 502 });
  }
}
