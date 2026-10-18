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
      error: expect.stringMatching(/PYTHON_AGENT_URL/),
    });
  });
});
