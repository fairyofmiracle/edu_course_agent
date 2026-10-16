import mermaid from "mermaid";

let renderCounter = 0;

export async function renderMermaidToSvg(
  chart: string,
): Promise<string> {
  mermaid.initialize({
    startOnLoad: false,
    theme: "neutral",
    securityLevel: "strict",
    fontFamily: "Arial, sans-serif",
  });

  const id = `pptx-mermaid-${++renderCounter}`;

  const { svg } = await mermaid.render(id, chart);

  return svg;
}
