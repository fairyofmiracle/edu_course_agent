import { afterEach, describe, expect, it, vi } from "vitest";

describe("GET /health", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("проксирует camelCase с API", async () => {
    vi.stubEnv("PYTHON_AGENT_URL", "http://api.local");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          status: "ok",
          service: "edu-course-python",
          llmConfigured: true,
          llmHost: "hub.gigaschool.ru",
          exports: ["json", "docx", "pptx"],
        }),
      ),
    );
    const { GET } = await import("./route");
    const body = await (await GET()).json();
    expect(body.llmConfigured).toBe(true);
    expect(body.llmHost).toBe("hub.gigaschool.ru");
    expect(body).not.toHaveProperty("llm_configured");
  });

  it("без API всё равно отдаёт контракт", async () => {
    delete process.env.PYTHON_AGENT_URL;
    const { GET } = await import("./route");
    const body = await (await GET()).json();
    expect(body.status).toBe("ok");
    expect(body.llmConfigured).toBe(false);
    expect(body.exports).toEqual(["json", "docx", "pptx"]);
  });
});
