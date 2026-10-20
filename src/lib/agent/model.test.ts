import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

type OpenAIOptions = {
  apiKey?: string;
  baseURL?: string;
  name?: string;
};

const chat = vi.fn((name: string) => ({ model: name }));
const createOpenAI = vi.fn((_options?: OpenAIOptions) => ({ chat }));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: (options?: OpenAIOptions) => createOpenAI(options),
}));

describe("getLanguageModel", () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.CLOUDRU_API_KEY;
    delete process.env.CLOUDRU_BASE_URL;
    delete process.env.GIGASCHOOL_API_KEY;
    delete process.env.GIGASCHOOL_BASE_URL;
  });
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.CLOUDRU_API_KEY;
    delete process.env.CLOUDRU_BASE_URL;
    delete process.env.GIGASCHOOL_API_KEY;
    delete process.env.GIGASCHOOL_BASE_URL;
    delete process.env.CLOUDRU_MODEL;
    delete process.env.CLOUDRU_MODEL_WRITER;
  });

  it("без ключа не ходит в модель", async () => {
    delete process.env.CLOUDRU_API_KEY;
    delete process.env.GIGASCHOOL_API_KEY;

    const { getLanguageModel } = await import("./model");

    expect(() => getLanguageModel()).toThrow(
      /CLOUDRU_API_KEY или GIGASCHOOL_API_KEY/,
    );
    expect(createOpenAI).not.toHaveBeenCalled();
  });

  it("берёт chat и writer модели через GigaSchool", async () => {
    delete process.env.CLOUDRU_API_KEY;
    process.env.GIGASCHOOL_API_KEY = "giga-key";
    process.env.CLOUDRU_MODEL = "GigaChat/GigaChat-3-Pro";
    process.env.CLOUDRU_MODEL_WRITER = "GigaChat/GigaChat-3-Pro";

    const { getLanguageModel } = await import("./model");

    expect(getLanguageModel("chat")).toEqual({
      model: "GigaChat/GigaChat-3-Pro",
    });

    expect(getLanguageModel("writer")).toEqual({
      model: "GigaChat/GigaChat-3-Pro",
    });

    expect(createOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "giga-key",
        baseURL: "https://hub.gigaschool.ru/api/v1/llm/v1",
      }),
    );
  });

  it("ключ Cloud.ru имеет приоритет перед GigaSchool", async () => {
    process.env.CLOUDRU_API_KEY = "cloud-key";
    process.env.GIGASCHOOL_API_KEY = "giga-key";

    const { getLanguageModel } = await import("./model");

    getLanguageModel("chat");

    expect(createOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "cloud-key",
        baseURL: "https://foundation-models.api.cloud.ru/v1",
      }),
    );
  });

  it("отклоняет зарубежный LLM API", async () => {
    delete process.env.CLOUDRU_API_KEY;
    process.env.GIGASCHOOL_API_KEY = "giga-key";
    process.env.GIGASCHOOL_BASE_URL = "https://api.openai.com/v1";

    const { getLanguageModel } = await import("./model");

    expect(() => getLanguageModel("chat")).toThrow(
      /LLM API запрещён/,
    );

    expect(createOpenAI).not.toHaveBeenCalled();
  });

  it("не отправляет ключ Cloud.ru на адрес GigaSchool", async () => {
    process.env.CLOUDRU_API_KEY = "cloud-key";
    process.env.CLOUDRU_BASE_URL = "https://hub.gigaschool.ru/api/v1/llm/v1";

    const { getLanguageModel } = await import("./model");

    expect(() => getLanguageModel("chat")).toThrow(
      /Для CLOUDRU_API_KEY разрешён только шлюз Cloud.ru/,
    );

    expect(createOpenAI).not.toHaveBeenCalled();
  });

  it("не отправляет ключ GigaSchool на адрес Cloud.ru", async () => {
    delete process.env.CLOUDRU_API_KEY;
    process.env.GIGASCHOOL_API_KEY = "giga-key";
    process.env.GIGASCHOOL_BASE_URL = "https://foundation-models.api.cloud.ru/v1";

    const { getLanguageModel } = await import("./model");

    expect(() => getLanguageModel("chat")).toThrow(
      /Для GIGASCHOOL_API_KEY разрешён только шлюз GigaSchool/,
    );

    expect(createOpenAI).not.toHaveBeenCalled();
  });

  it("игнорирует устаревшие переменные OPENAI", async () => {
    delete process.env.CLOUDRU_API_KEY;
    delete process.env.GIGASCHOOL_API_KEY;

    process.env.OPENAI_API_KEY = "old-key";
    process.env.OPENAI_BASE_URL = "https://hub.gigaschool.ru/api/v1/llm/v1";

    const { getLanguageModel } = await import("./model");

    expect(() => getLanguageModel("chat")).toThrow(
      /CLOUDRU_API_KEY или GIGASCHOOL_API_KEY/,
    );

    expect(createOpenAI).not.toHaveBeenCalled();
  });

  it("логирует ответ шлюза и пропускает тело без JSON", async () => {
    const { cloudRuFetch } = await import("./model");
    const fetchImpl = vi.fn(async () => new Response("ошибка шлюза", { status: 429 }));
    vi.stubGlobal("fetch", fetchImpl);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const plain = await cloudRuFetch("https://foundation-models.api.cloud.ru/v1/chat", { method: "GET" });
    expect(plain.status).toBe(429);
    expect(error).not.toHaveBeenCalled();

    const broken = await cloudRuFetch("https://foundation-models.api.cloud.ru/v1/chat", {
      method: "POST",
      body: "не json",
    });
    expect(broken.status).toBe(429);
    expect(String(error.mock.calls.at(-1)?.[0])).toContain("тело не JSON");

    const ok = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", ok);
    const sent = await cloudRuFetch("https://foundation-models.api.cloud.ru/v1/chat", {
      method: "POST",
      body: JSON.stringify({
        tools: [{ name: "set_structure" }],
        tool_choice: "auto",
        messages: [{ role: "assistant", tool_calls: [{ function: { name: "set_structure" } }] }],
      }),
    });
    expect(sent.ok).toBe(true);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
    vi.unstubAllGlobals();
  });
});
