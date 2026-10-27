import { afterEach, describe, expect, it, vi } from "vitest";

const appendFile = vi.fn(async () => undefined);
const mkdir = vi.fn(async () => undefined);

vi.mock("node:fs/promises", () => ({
  appendFile,
  mkdir,
}));

describe("POST /api/log auth", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    appendFile.mockClear();
    mkdir.mockClear();
    vi.resetModules();
  });

  it("writes without token in local/dev", async () => {
    vi.stubEnv("STUDIO_API_TOKEN", "");
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "ping" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(appendFile).toHaveBeenCalledOnce();
  });

  it("rejects cross-origin write when STUDIO_API_TOKEN set but Authorization missing", async () => {
    vi.stubEnv("STUDIO_API_TOKEN", "studio-secret-token");
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/log", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://evil.example",
        },
        body: JSON.stringify({ event: "ping" }),
      }),
    );
    expect(res.status).toBe(401);
    expect(appendFile).not.toHaveBeenCalled();
  });

  it("rejects write without Origin when STUDIO_API_TOKEN set", async () => {
    vi.stubEnv("STUDIO_API_TOKEN", "studio-secret-token");
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "ping" }),
      }),
    );
    expect(res.status).toBe(401);
    expect(appendFile).not.toHaveBeenCalled();
  });

  it("writes same-origin without Bearer when STUDIO_API_TOKEN set", async () => {
    vi.stubEnv("STUDIO_API_TOKEN", "studio-secret-token");
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/log", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost",
        },
        body: JSON.stringify({ event: "ping" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(appendFile).toHaveBeenCalledOnce();
  });

  it("writes when Bearer matches STUDIO_API_TOKEN", async () => {
    vi.stubEnv("STUDIO_API_TOKEN", "studio-secret-token");
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/log", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer studio-secret-token",
        },
        body: JSON.stringify({ event: "ping" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(appendFile).toHaveBeenCalledOnce();
  });
});
