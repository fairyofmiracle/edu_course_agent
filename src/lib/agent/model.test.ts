import { afterEach, describe, expect, it, vi } from "vitest";

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
  afterEach(() => {
    vi.resetModules();
    delete process.env.OPENAI_API_KEY;
    delete process.env.CLOUDRU_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.CLOUDRU_BASE_URL;
    delete process.env.CLOUDRU_MODEL;
    delete process.env.CLOUDRU_MODEL_WRITER;
  });

  it("без ключа не ходит в модель", async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.CLOUDRU_API_KEY;
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

  it("ключ Cloud.ru перекрывает чужой адрес OpenAI", async () => {
    process.env.CLOUDRU_API_KEY = "cloud-key";
    process.env.CLOUDRU_BASE_URL = "https://foundation-models.api.cloud.ru/v1";
    process.env.OPENAI_API_KEY = "sk-foreign";
    process.env.OPENAI_BASE_URL = "https://api.openai.com/v1";
    const { getLanguageModel } = await import("./model");
    getLanguageModel("chat");
    expect(createOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "cloud-key",
        baseURL: "https://foundation-models.api.cloud.ru/v1",
      }),
    );
  });

  it("берёт шлюз хакатона и отклоняет зарубежный API", async () => {
    process.env.OPENAI_API_KEY = "k";
    process.env.OPENAI_BASE_URL = "https://hub.gigaschool.ru/api/v1/llm/v1";
    process.env.CLOUDRU_BASE_URL = "https://foundation-models.api.cloud.ru/v1";
    const { getLanguageModel } = await import("./model");
    getLanguageModel("chat");
    expect(createOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "k",
        baseURL: "https://hub.gigaschool.ru/api/v1/llm/v1",
      }),
    );

    process.env.OPENAI_BASE_URL = "https://api.openai.com/v1";
    vi.resetModules();
    const { getLanguageModel: getAgain } = await import("./model");
    expect(() => getAgain("chat")).toThrow(/LLM API запрещён/);
  });
});
