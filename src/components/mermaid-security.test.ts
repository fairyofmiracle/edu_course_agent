import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("MermaidBlock security", () => {
  it("uses strict securityLevel", () => {
    const source = readFileSync(
      path.join(__dirname, "MermaidBlock.tsx"),
      "utf8",
    );
    expect(source).toContain('securityLevel: "strict"');
    expect(source).not.toContain('securityLevel: "loose"');
  });
});
