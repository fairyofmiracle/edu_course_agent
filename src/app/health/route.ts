const FALLBACK = {
  status: "ok" as const,
  service: "edu-course-python",
  llmConfigured: false,
  llmHost: "",
  exports: ["json", "docx", "pptx"],
};

function pythonBase() {
  return process.env.PYTHON_AGENT_URL?.trim().replace(/\/$/, "") ?? "";
}

/** Тот же контракт, что у FastAPI /health — судья бьёт в :8000, а не во внутренний api. */
export async function GET() {
  const base = pythonBase();
  if (base) {
    try {
      const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(4000) });
      if (response.ok) {
        const body = (await response.json()) as Record<string, unknown>;
        return Response.json({
          status: body.status ?? "ok",
          service: body.service ?? FALLBACK.service,
          llmConfigured: Boolean(body.llmConfigured ?? body.llm_configured),
          llmHost: String(body.llmHost ?? body.llm_host ?? ""),
          exports: Array.isArray(body.exports) ? body.exports : FALLBACK.exports,
        });
      }
    } catch {
      // студия жива, шлюз не ответил — контракт всё равно camelCase
    }
  }
  return Response.json(FALLBACK);
}
