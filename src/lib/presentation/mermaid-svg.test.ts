import { beforeEach, describe, expect, it, vi } from "vitest";

const initialize = vi.fn();
const render = vi.fn(async () => ({ svg: "<svg>ok</svg>" }));

vi.mock("mermaid", () => ({
  default: { initialize, render },
}));

describe("renderMermaidToSvg", () => {
  beforeEach(() => {
    initialize.mockClear();
    render.mockClear();
  });

  it("рисует диаграмму в svg", async () => {
    const { renderMermaidToSvg } = await import("./mermaid-svg");
    const svg = await renderMermaidToSvg("graph TD; A-->B");
    expect(svg).toBe("<svg>ok</svg>");
    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({ startOnLoad: false, securityLevel: "strict" }),
    );
    expect(render).toHaveBeenCalledWith(expect.stringMatching(/^pptx-mermaid-/), "graph TD; A-->B");
  });
});
