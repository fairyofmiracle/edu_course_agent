import { describe, expect, it } from "vitest";
import { resolveBloomLevel } from "@/lib/agent/tools";

describe("resolveBloomLevel", () => {
  it("maps Russian UI labels", () => {
    expect(resolveBloomLevel("Знать", "x", [], [], [], 0)).toBe("remember");
    expect(resolveBloomLevel("понимать", "x", [], [], [], 0)).toBe("understand");
    expect(resolveBloomLevel("Применять", "x", [], [], [], 0)).toBe("apply");
    expect(resolveBloomLevel("Анализировать", "x", [], [], [], 0)).toBe("analyze");
  });

  it("infers evaluate from wording when omitted", () => {
    expect(
      resolveBloomLevel(undefined, "Оценка качества", ["критерии"], ["оценивать"], ["выбор лучшего"], 0),
    ).toBe("evaluate");
  });

  it("does not collapse all missing levels to apply", () => {
    const levels = Array.from({ length: 6 }, (_, i) =>
      resolveBloomLevel(undefined, `Узел ${i}`, ["факт"], ["шаг"], ["приём"], i),
    );
    expect(new Set(levels).size).toBeGreaterThanOrEqual(3);
    expect(levels.every((l) => l === "apply")).toBe(false);
  });
});
