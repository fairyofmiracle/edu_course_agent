import { describe, expect, it } from "vitest";
import { appendTranscript } from "./transcript";

describe("appendTranscript", () => {
  it("кладёт речь в пустое поле", () => {
    expect(appendTranscript("", "  курс на 72 часа  ")).toBe("курс на 72 часа");
  });

  it("дописывает к уже набранному запросу", () => {
    expect(appendTranscript("Общеразвивающая программа", "на 72 часа")).toBe(
      "Общеразвивающая программа на 72 часа",
    );
  });

  it("пустую расшифровку не добавляет", () => {
    expect(appendTranscript("курс", "   ")).toBe("курс");
  });
});
