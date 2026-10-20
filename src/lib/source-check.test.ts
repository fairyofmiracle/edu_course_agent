import { afterEach, describe, expect, it, vi } from "vitest";
import { checkSources, parseSourceProbeKey, sourceProbeRequest } from "@/lib/source-check";

describe("checkSources", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("без явной базы ходит через сайт", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_PYTHON_API_URL", "http://studio.local");
    const { checkSources: proxied } = await import("./source-check");
    const fetchImpl = vi.fn(async () => Response.json({ results: [] }));
    const ready = await proxied(["https://example.org"], { fetchImpl });
    expect(ready.state).toBe("ready");
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe("/api/backend/api/sources/probe");
  });

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
    const sent = JSON.parse(String(ok.mock.calls[0]?.[1]?.body));
    expect(sent).toEqual({ urls: ["https://example.org"], expect: {} });

    const withNumber = vi.fn(async () =>
      Response.json({
        results: [{ url: "https://example.org", state: "reachable", message: "ок", requisites: "found" }],
      }),
    );
    const numbered = await checkSources(["https://example.org"], {
      base: "http://studio.local",
      fetchImpl: withNumber,
      expect: { "https://example.org": "629" },
    });
    expect(numbered.state).toBe("ready");
    expect(JSON.parse(String(withNumber.mock.calls[0]?.[1]?.body)).expect).toEqual({
      "https://example.org": "629",
    });

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

  it("ключ проверки зависит от ссылки и номера, а не от текста лекции", () => {
    const course = {
      brief: {
        references: [
          { title: "Приказ № 629", source: "https://example.org/order?x=1", note: "" },
        ],
      },
      lectures: [{ slides: [{ title: "Первый текст" }] }],
    };
    const first = sourceProbeRequest(course);
    const edited = sourceProbeRequest({
      ...course,
      lectures: [{ slides: [{ title: "Совсем другой слайд" }] }],
    });
    expect(first.cacheKey).toBe(edited.cacheKey);
    expect(first.expect).toEqual({ "https://example.org/order?x=1": "629" });
    expect(first.cacheKey).toContain("https://example.org/order?x=1=629");
    expect(parseSourceProbeKey(first.cacheKey)).toEqual({
      urls: ["https://example.org/order?x=1"],
      expect: { "https://example.org/order?x=1": "629" },
    });
    expect(sourceProbeRequest({ brief: { references: [] } }).cacheKey).toBe("");
    expect(parseSourceProbeKey("")).toEqual({ urls: [], expect: {} });
    expect(parseSourceProbeKey("https://example.org\n--\nбез номера\nhttps://example.org=")).toEqual({
      urls: ["https://example.org"],
      expect: {},
    });
  });
});
