import { afterEach, describe, expect, it, vi } from "vitest";

describe("POST /api/run", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("без PYTHON_AGENT_URL не собирает программу сама", async () => {
    delete process.env.PYTHON_AGENT_URL;
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://studio.local/api/run", {
        method: "POST",
        body: JSON.stringify({ request: "Собери курс" }),
      }),
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/без API|порте 8000/),
    });
  });

  it("при обрыве API не отдаёт технический текст", async () => {
    vi.stubEnv("PYTHON_AGENT_URL", "http://api.local");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("fetch failed HTTP 502 Traceback");
      }),
    );
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://studio.local/api/run", {
        method: "POST",
        body: JSON.stringify({ request: "Собери курс" }),
      }),
    );
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error).not.toMatch(/Traceback|502|fetch failed/);
    expect(body.error).toMatch(/не достучалась|кнопкой|повторите/i);
  });
});
