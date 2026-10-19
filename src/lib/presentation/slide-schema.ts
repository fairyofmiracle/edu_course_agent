import { z } from "zod";

function absent<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (value === null ? undefined : value), schema);
}

const positionSchema = z.object({
  x: z.number().min(0).max(13.33),
  y: z.number().min(0).max(7.5),
  w: z.number().positive().max(13.33),
  h: z.number().positive().max(7.5),
});

const textElementSchema = positionSchema.extend({
  type: z.literal("text"),
  text: z.string().min(1).max(2000),
  fontSize: z.number().min(8).max(48).default(20),
  bold: z.boolean().default(false),
  color: z.string().regex(/^[0-9A-Fa-f]{6}$/).default("1C1614"),
});

const shapeElementSchema = positionSchema.extend({
  type: z.literal("shape"),
  shape: z.enum(["rect", "roundRect", "ellipse", "line"]),
  fill: z.string().regex(/^[0-9A-Fa-f]{6}$/).default("F7F3F0"),
});

const tableElementSchema = positionSchema.extend({
  type: z.literal("table"),
  headers: z.array(z.string().min(1).max(40)).min(2).max(6),
  rows: z.array(z.array(z.string().min(1).max(80)).min(1).max(6)).min(1).max(8),
});

const diagramElementSchema = positionSchema.extend({
  type: z.literal("diagram"),
  mermaid: z.string().min(1).max(3000),
});

const flowchartNodeSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(120),
  shape: z.enum(["rect", "roundRect", "diamond"]).default("roundRect"),
});

const flowchartEdgeSchema = z.object({
  from: z.string().min(1).max(40),
  to: z.string().min(1).max(40),
  label: z.string().max(60).optional(),
});

const flowchartElementSchema = positionSchema.extend({
  type: z.literal("flowchart"),
  direction: z.enum(["horizontal", "vertical"]).default("horizontal"),
  nodes: z.array(flowchartNodeSchema).min(2).max(8),
  edges: z.array(flowchartEdgeSchema).min(1).max(16),
}).superRefine((diagram, ctx) => {
  const ids = new Set<string>();

  diagram.nodes.forEach((node, index) => {
    if (ids.has(node.id)) {
      ctx.addIssue({
        code: "custom",
        path: ["nodes", index, "id"],
        message: `Повторяющийся ID узла: ${node.id}`,
      });
    }
    ids.add(node.id);
  });

  diagram.edges.forEach((edge, index) => {
    if (!ids.has(edge.from) || !ids.has(edge.to)) {
      ctx.addIssue({
        code: "custom",
        path: ["edges", index],
        message: "Связь ссылается на несуществующий узел",
      });
    }

    if (edge.from === edge.to) {
      ctx.addIssue({
        code: "custom",
        path: ["edges", index],
        message: "Связь узла с самим собой пока не поддерживается",
      });
    }
  });
});

export const slideElementSchema = z.discriminatedUnion("type", [
  textElementSchema,
  shapeElementSchema,
  diagramElementSchema,
  flowchartElementSchema,
  tableElementSchema,
]).refine(
  (element) =>
    element.x + element.w <= 13.33 &&
    element.y + element.h <= 7.5,
  { message: "Элемент выходит за границы слайда" },
);

export const presentationSlideSchema = z.object({
  title: z.string().min(1).max(140),
  elements: z.array(slideElementSchema).min(1).max(40),
  speakerNotes: absent(z.string().max(2000).optional()),
});

export const presentationDocumentSchema = z.object({
  title: z.string().min(1).max(180),
  slides: z.array(presentationSlideSchema).min(1).max(100),
});

export type SlideElement = z.infer<typeof slideElementSchema>;
export type PresentationSlide = z.infer<typeof presentationSlideSchema>;
export type PresentationDocument = z.infer<typeof presentationDocumentSchema>;
