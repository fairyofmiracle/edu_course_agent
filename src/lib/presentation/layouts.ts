
import PptxGenJS from "pptxgenjs";

type Slide = ReturnType<PptxGenJS["addSlide"]>;

export function addFourCardsLayout(
  pptx: PptxGenJS,
  slide: Slide,
  bullets: string[],
): void {
  const colors = ["2456D8", "0F766E", "7C3AED", "C05621"];
  const labels = ["01", "02", "03", "04"];

  bullets.slice(0, 4).forEach((bullet, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);

    const x = 0.85 + column * 5.9;
    const y = 2.3 + row * 1.9;

    slide.addShape(pptx.ShapeType.roundRect, {
      x,
      y,
      w: 5.65,
      h: 1.65,
      rectRadius: 0.12,
      line: { color: "E0E7F0", width: 1 },
      fill: { color: "F7F9FC" },
    });

    slide.addShape(pptx.ShapeType.rect, {
      x: x + 0.18,
      y: y + 0.23,
      w: 0.08,
      h: 1.15,
      line: { color: colors[index], transparency: 100 },
      fill: { color: colors[index] },
    });

    slide.addText(labels[index], {
      x: x + 0.45,
      y: y + 0.25,
      w: 0.75,
      h: 0.35,
      fontSize: 13,
      bold: true,
      color: colors[index],
      margin: 0,
    });

    slide.addText(bullet, {
      x: x + 0.45,
      y: y + 0.7,
      w: 4.7,
      h: 0.7,
      fontSize: 19,
      bold: true,
      color: "18233B",
      margin: 0,
      breakLine: false,
      fit: "shrink",
      valign: "middle",
    });
  });
}
