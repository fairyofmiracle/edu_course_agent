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
      error: expect.stringMatching(/PYTHON_AGENT_URL/),
    });
  });
});
