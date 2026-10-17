type SchemaNode = Record<string, unknown>;

function isSchemaNode(value: unknown): value is SchemaNode {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Cloud.ru Foundation Models: у каждого узла function schema должен быть
 * type, enum, const или union (anyOf/oneOf/allOf). Иначе 400:
 * "Function schema requires a supported type, enum, const or union."
 */
export function assertCloudRuFunctionSchema(schema: unknown, path = "root") {
  if (schema === true || schema === false) return;
  if (!isSchemaNode(schema)) {
    throw new Error(`${path}: ожидался объект JSON Schema`);
  }
  if ("$ref" in schema) return;

  const hasType = typeof schema.type === "string" || Array.isArray(schema.type);
  const hasUnion =
    Array.isArray(schema.anyOf) ||
    Array.isArray(schema.oneOf) ||
    Array.isArray(schema.allOf);
  const hasEnum = Array.isArray(schema.enum);
  const hasConst = "const" in schema;

  if (!hasType && !hasUnion && !hasEnum && !hasConst) {
    throw new Error(
      `${path}: Function schema requires a supported type, enum, const or union.`,
    );
  }

  if (isSchemaNode(schema.properties)) {
    for (const [key, value] of Object.entries(schema.properties)) {
      assertCloudRuFunctionSchema(value, `${path}.properties.${key}`);
    }
  }
  if (schema.items !== undefined) {
    if (Array.isArray(schema.items)) {
      schema.items.forEach((item, index) => {
        assertCloudRuFunctionSchema(item, `${path}.items[${index}]`);
      });
    } else {
      assertCloudRuFunctionSchema(schema.items, `${path}.items`);
    }
  }
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    const variants = schema[key];
    if (!Array.isArray(variants)) continue;
    variants.forEach((item, index) => {
      assertCloudRuFunctionSchema(item, `${path}.${key}[${index}]`);
    });
  }
  if (isSchemaNode(schema.additionalProperties)) {
    assertCloudRuFunctionSchema(
      schema.additionalProperties,
      `${path}.additionalProperties`,
    );
  }
}
