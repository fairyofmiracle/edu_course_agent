import { describe, expect, it, vi } from "vitest";
import { checkSources } from "@/lib/source-check";

describe("checkSources", () => {
  it("пустой список и отсутствие адреса не ходят в сеть", async () => {
    const fetchImpl = vi.fn();
    expect(await checkSources([], { fetchImpl })).toEqual({ state: "empty" });
    expect(await checkSources(["https://example.org"], { base: "", fetchImpl })).toEqual({
      state: "disabled",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("отдаёт результаты, пустой ответ и ошибки сервера", async () => {
    const ok = vi.fn(async () => Response.json({ results: [{ url: "https://example.org", state: "reachable", message: "ок" }] }));
    const ready = await checkSources(["https://example.org"], { base: "http://studio.local/", fetchImpl: ok });
    expect(ready.state).toBe("ready");
    expect(ok).toHaveBeenCalledWith(
      "http://studio.local/api/sources/probe",
      expect.objectContaining({ method: "POST" }),
    );

    const blank = await checkSources(["https://example.org"], {
      base: "http://studio.local",
      fetchImpl: async () => Response.json({}),
    });
    expect(blank).toEqual({ state: "ready", results: [] });

    const down = await checkSources(["https://example.org"], {
      base: "http://studio.local",
      fetchImpl: async () => new Response("no", { status: 503 }),
    });
    expect(down.state).toBe("down");
    if (down.state === "down") expect(down.message).toContain("503");

    const offline = await checkSources(["https://example.org"], {
      base: "http://studio.local",
      fetchImpl: async () => {
        throw new Error("offline");
      },
    });
    expect(offline.state).toBe("down");
    if (offline.state === "down") expect(offline.message).toContain("не ответил");
  });
});
