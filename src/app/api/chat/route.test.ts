import { afterEach, describe, expect, it, vi } from "vitest";

describe("POST /api/chat", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("без PYTHON_AGENT_URL не зовёт модель сама", async () => {
    delete process.env.PYTHON_AGENT_URL;
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://studio.local/api/chat", {
        method: "POST",
        body: JSON.stringify({ messages: [] }),
      }),
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/без API|порте 8000/),
    });
  });

  it("пишет попытку шлюза и передаёт токен", async () => {
    vi.resetModules();
    vi.stubEnv("PYTHON_AGENT_URL", "http://studio.local");
    vi.stubEnv("STUDIO_API_TOKEN", "secret");
    const fetchImpl = vi.fn(
      async () =>
        Response.json({
          assistant: "Каркас готов.",
          patches: [],
          gatewayRetries: [2],
        }),
    );
    vi.stubGlobal("fetch", fetchImpl);
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://studio.local/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "Нужен курс" }] }],
        }),
      }),
    );
    const text = await response.text();
    expect(text).toContain("Шлюз ответил с попытки 2.");
    expect(text).not.toContain("из 3");
    const headers = fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer secret");
  });
});
