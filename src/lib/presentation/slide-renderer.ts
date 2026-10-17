import PptxGenJS from "pptxgenjs";
import { renderMermaidToSvg } from "@/lib/presentation/mermaid-svg";
import {
  presentationSlideSchema,
  type PresentationSlide,
} from "@/lib/presentation/slide-schema";
import { renderFlowchart } from "@/lib/presentation/flowchart-renderer";

type PptxSlide = ReturnType<PptxGenJS["addSlide"]>;

const SLIDE_WIDTH = 13.333;
const SLIDE_HEIGHT = 7.5;

function svgToDataUri(svg: string): string {
  const bytes = new TextEncoder().encode(svg);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

function isInsideSlide(
  x: number,
  y: number,
  w: number,
  h: number,
): boolean {
  const epsilon = 0.01;

  return (
    x >= 0 &&
    y >= 0 &&
    w > 0 &&
    h > 0 &&
    x + w <= SLIDE_WIDTH + epsilon &&
    y + h <= SLIDE_HEIGHT + epsilon
  );
}

export async function renderPresentationSlide(
  pptx: PptxGenJS,
  source: PresentationSlide,
): Promise<PptxSlide> {
  const validated = presentationSlideSchema.parse(source);

  const slide = pptx.addSlide();
  slide.background = { color: "FFFFFF" };

  for (const element of validated.elements) {
    const { x, y, w, h } = element;

    if (!isInsideSlide(x, y, w, h)) {
      throw new Error(
        `Элемент ${element.type} выходит за границы слайда`,
      );
    }

    switch (element.type) {
      case "flowchart": {
        renderFlowchart(pptx, slide, element);
        break;
      }

      case "text": {
        slide.addText(element.text, {
          x,
          y,
          w,
          h,
          fontFace: "Aptos",
          fontSize: element.fontSize,
          bold: element.bold,
          color: element.color,
          margin: 0.05,
          breakLine: false,
          fit: "shrink",
          valign: "middle",
        });

        break;
      }

      case "shape": {
        const shapeTypes = {
          rect: pptx.ShapeType.rect,
          roundRect: pptx.ShapeType.roundRect,
          ellipse: pptx.ShapeType.ellipse,
          line: pptx.ShapeType.line,
        };

        const shapeType = shapeTypes[element.shape];

        slide.addShape(shapeType, {
          x,
          y,
          w,
          h,
          fill: { color: element.fill },
          line: {
            color: element.fill,
            width: 1,
          },
        });

        break;
      }

      case "diagram": {
        if (typeof document === "undefined") {
          slide.addText("Диаграмма Mermaid доступна при экспорте из браузера", {
            x,
            y,
            w,
            h,
            fontSize: 14,
            color: "64748B",
            align: "center",
            valign: "middle",
          });
          break;
        }
        try {
          const svg = await renderMermaidToSvg(element.mermaid);

          slide.addImage({
            data: svgToDataUri(svg),
            x,
            y,
            w,
            h,
          });
        } catch (error) {
          console.warn("Не удалось отобразить Mermaid-схему:", error);

          slide.addText("Не удалось построить диаграмму", {
            x,
            y,
            w,
            h,
            fontSize: 14,
            color: "B91C1C",
            align: "center",
            valign: "middle",
            margin: 0.1,
          });
        }

        break;
      }
    }
  }

  if (validated.speakerNotes) {
    slide.addNotes(validated.speakerNotes);
  }

  return slide;
}
