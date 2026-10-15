import { Packer } from "docx";
import { describe, expect, it } from "vitest";
import { buildCourseDocx } from "@/lib/export-docx";
import { buildCoursePptx } from "@/lib/export-pptx";
import { SAMPLE_COURSE } from "@/lib/sample-course";

describe("document exports", () => {
  it("собирает непустой DOCX", async () => {
    const buffer = await Packer.toBuffer(buildCourseDocx(SAMPLE_COURSE));
    expect(buffer.byteLength).toBeGreaterThan(10_000);
  });

  it("собирает непустой PPTX", async () => {
    const output = await buildCoursePptx(SAMPLE_COURSE, "m1").write({
      outputType: "nodebuffer",
      compression: true,
    });
    expect(output).toBeInstanceOf(Uint8Array);
    expect((output as Uint8Array).byteLength).toBeGreaterThan(10_000);
  });
});
