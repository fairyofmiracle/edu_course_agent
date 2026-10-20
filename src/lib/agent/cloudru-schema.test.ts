import { describe, expect, it } from "vitest";
import { toJSONSchema } from "zod/v4/core";
import { z } from "zod";
import { createCourseTools } from "@/lib/agent/tools";
import { assertCloudRuFunctionSchema } from "@/lib/agent/cloudru-schema";

async function schemaOf(tool: { inputSchema: unknown }) {
  const input = tool.inputSchema as {
    jsonSchema?: unknown;
    _zod?: unknown;
  };
  if (input && typeof input === "object" && "jsonSchema" in input) {
    return await input.jsonSchema;
  }
  return toJSONSchema(input as z.ZodType, {
    target: "draft-7",
    io: "input",
    reused: "inline",
  });
}

describe("Cloud.ru function schemas", () => {
  it("принимает ссылку, союз и вложенные узлы и отвергает пустышку", () => {
    expect(() => assertCloudRuFunctionSchema(true)).not.toThrow();
    expect(() => assertCloudRuFunctionSchema({ $ref: "#/defs/brief" })).not.toThrow();
    expect(() =>
      assertCloudRuFunctionSchema({
        type: "array",
        items: [{ type: "string" }, { enum: ["a"] }],
        anyOf: [{ type: "array", items: { type: "number" } }, { const: 1 }],
        additionalProperties: { type: "boolean" },
      }),
    ).not.toThrow();
    expect(() => assertCloudRuFunctionSchema("строка")).toThrow(/объект JSON Schema/);
    expect(() => assertCloudRuFunctionSchema({ anyOf: [null] })).toThrow(/объект JSON Schema/);
  });

  it("ломается на z.any() без type", () => {
    const broken = toJSONSchema(
      z.object({
        data: z.any(),
      }),
      { target: "draft-7", io: "input", reused: "inline" },
    );
    expect(() => assertCloudRuFunctionSchema(broken)).toThrow(/supported type/);
  });

  it("набор tools один и тот же до и после утверждения каркаса", () => {
    expect(Object.keys(createCourseTools(false))).toEqual(Object.keys(createCourseTools(true)));
  });

  it("все tools проходят проверку Cloud.ru", async () => {
    const tools = createCourseTools(false);
    for (const [name, courseTool] of Object.entries(tools)) {
      const schema = await schemaOf(courseTool);
      expect(() => assertCloudRuFunctionSchema(schema, name), name).not.toThrow();
    }
  });
});
