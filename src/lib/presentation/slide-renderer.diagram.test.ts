import { beforeEach, describe, expect, it, vi } from "vitest";
import PptxGenJS from "pptxgenjs";

const renderMermaidToSvg = vi.fn();

vi.mock("@/lib/presentation/mermaid-svg", () => ({
  renderMermaidToSvg: (...args: unknown[]) => renderMermaidToSvg(...args),
}));

describe("диаграмма на слайде", () => {
  beforeEach(() => {
    renderMermaidToSvg.mockReset();
    vi.stubGlobal("document", {});
  });

  it("кладёт svg на слайд и пишет заглушку, если схема не собралась", async () => {
    const { renderPresentationSlide } = await import("@/lib/presentation/slide-renderer");
    renderMermaidToSvg.mockResolvedValueOnce("<svg xmlns='http://www.w3.org/2000/svg'/>");
    const pptx = new PptxGenJS();
    await renderPresentationSlide(pptx, {
      title: "Схема",
      elements: [{ type: "diagram", mermaid: "flowchart LR\nA-->B", x: 0.5, y: 0.5, w: 6, h: 3 }],
    });
    expect(renderMermaidToSvg).toHaveBeenCalledWith("flowchart LR\nA-->B");

    renderMermaidToSvg.mockRejectedValueOnce(new Error("синтаксис"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await renderPresentationSlide(pptx, {
      title: "Схема",
      elements: [{ type: "diagram", mermaid: "сломанная схема", x: 0.5, y: 0.5, w: 6, h: 3 }],
    });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    const output = await pptx.write({ outputType: "nodebuffer", compression: true });
    expect(Buffer.from(output as ArrayBuffer).length).toBeGreaterThan(500);
  });
});
