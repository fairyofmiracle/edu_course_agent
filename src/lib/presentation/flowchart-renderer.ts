import PptxGenJS from "pptxgenjs";
import type { SlideElement } from "@/lib/presentation/slide-schema";

type FlowchartElement = Extract<SlideElement, { type: "flowchart" }>;
type PptxSlide = ReturnType<PptxGenJS["addSlide"]>;

type Position = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export function renderFlowchart(
  pptx: PptxGenJS,
  slide: PptxSlide,
  element: FlowchartElement,
): void {
  const { x, y, w, h, nodes, edges, direction } = element;
  const horizontal = direction === "horizontal";
  const count = nodes.length;
  const gap = 0.35;

  const nodeW = horizontal
    ? (w - gap * (count - 1)) / count
    : Math.min(w * 0.7, 3);

  const nodeH = horizontal
    ? Math.min(h * 0.45, 1.2)
    : (h - gap * (count - 1)) / count;

  if (nodeW < 0.5 || nodeH < 0.4) {
    throw new Error("Недостаточно места для диаграммы");
  }

  const positions = new Map<string, Position>();

  nodes.forEach((node, index) => {
    positions.set(node.id, {
      x: horizontal ? x + index * (nodeW + gap) : x + (w - nodeW) / 2,
      y: horizontal ? y + (h - nodeH) / 2 : y + index * (nodeH + gap),
      w: nodeW,
      h: nodeH,
    });
  });

  // Сначала рисуем стрелки, затем блоки поверх них.
  for (const edge of edges) {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);

    if (!from || !to) {
      throw new Error("Связь содержит неизвестный узел");
    }

    const forward = horizontal
      ? from.x < to.x
      : from.y < to.y;

    const startX = horizontal
      ? forward ? from.x + from.w : from.x
      : from.x + from.w / 2;

    const startY = horizontal
      ? from.y + from.h / 2
      : forward ? from.y + from.h : from.y;

    const endX = horizontal
      ? forward ? to.x : to.x + to.w
      : to.x + to.w / 2;

    const endY = horizontal
      ? to.y + to.h / 2
      : forward ? to.y : to.y + to.h;

    // В PptxGenJS направление линии зависит от её геометрии.
    slide.addShape(pptx.ShapeType.line, {
      x: Math.min(startX, endX),
      y: Math.min(startY, endY),
      w: Math.max(Math.abs(endX - startX), 0.001),
      h: Math.max(Math.abs(endY - startY), 0.001),
      flipH: startX > endX,
      flipV: startY > endY,
      line: {
        color: "64748B",
        width: 1.5,
        endArrowType: "triangle",
      },
    });
  }

  for (const node of nodes) {
    const pos = positions.get(node.id)!;

    const shapeType =
      node.shape === "diamond"
        ? pptx.ShapeType.diamond
        : node.shape === "rect"
          ? pptx.ShapeType.rect
          : pptx.ShapeType.roundRect;

    slide.addShape(shapeType, {
      ...pos,
      fill: { color: "EEF2F8" },
      line: { color: "94A3B8", width: 1 },
    });

    slide.addText(node.label, {
      ...pos,
      fontFace: "Aptos",
      fontSize: 14,
      bold: true,
      color: "18233B",
      align: "center",
      valign: "middle",
      margin: 0.08,
      fit: "shrink",
    });
  }
}
