import { afterEach, describe, expect, it, vi } from "vitest";

const chat = vi.fn((name: string) => ({ model: name }));
const createOpenAI = vi.fn(() => ({ chat }));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: (...args: unknown[]) => createOpenAI(...args),
}));

vi.mock("@/lib/agent/cloudru-messages", () => ({
  normalizeCloudRuBody: (body: string) => body.replace("RAW", "CLEAN"),
}));

describe("getLanguageModel", () => {
  afterEach(() => {
    vi.resetModules();
    delete process.env.OPENAI_API_KEY;
    delete process.env.CLOUDRU_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.CLOUDRU_MODEL;
    delete process.env.CLOUDRU_MODEL_WRITER;
  });

  it("без ключа не ходит в модель", async () => {
    const { getLanguageModel } = await import("./model");
    expect(() => getLanguageModel()).toThrow(/OPENAI_API_KEY/);
  });

  it("берёт chat и writer модели", async () => {
    process.env.OPENAI_API_KEY = "k";
    process.env.CLOUDRU_MODEL = "GigaChat/GigaChat-3-Pro";
    process.env.CLOUDRU_MODEL_WRITER = "GigaChat/GigaChat-3-Pro";
    const { getLanguageModel } = await import("./model");
    expect(getLanguageModel("chat")).toEqual({ model: "GigaChat/GigaChat-3-Pro" });
    expect(getLanguageModel("writer")).toEqual({ model: "GigaChat/GigaChat-3-Pro" });
    expect(createOpenAI).toHaveBeenCalled();
  });

  it("нормализует тело запроса и пишет ошибку Cloud.ru", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 400,
      clone: () => ({ text: async () => "bad" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    process.env.OPENAI_API_KEY = "k";
    const { getLanguageModel } = await import("./model");
    getLanguageModel("chat");
    const customFetch = createOpenAI.mock.calls.at(-1)?.[0]?.fetch as typeof fetch;
    await customFetch("https://example.test", { body: '{"x":"RAW"}' });
    await customFetch("https://example.test");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test",
      expect.objectContaining({ body: '{"x":"CLEAN"}' }),
    );
    vi.unstubAllGlobals();
  });
});
