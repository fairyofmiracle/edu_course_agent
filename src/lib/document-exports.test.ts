import { Packer } from "docx";
import { afterEach, describe, expect, it, vi } from "vitest";
import { docxToText } from "@/lib/docx-text";
import {
  buildCourseDocx,
  courseDocxHeadings,
  exportAssessmentDocx,
  exportCourseDocx,
  exportSeminarDocx,
} from "@/lib/export-docx";
import { buildCoursePptxAsync } from "@/lib/export-pptx";
import { SAMPLE_COURSE } from "@/lib/sample-course";

describe("document exports", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("собирает бланк общеразвивающей программы и оставляет приказ пустым", async () => {
    const headings = courseDocxHeadings(SAMPLE_COURSE);
    expect(headings).toContain("ДОПОЛНИТЕЛЬНАЯ ОБЩЕОБРАЗОВАТЕЛЬНАЯ ОБЩЕРАЗВИВАЮЩАЯ ПРОГРАММА");
    expect(headings).toContain("Приказом № ____-ОБР от «___» __________ ______ г.");
    expect(headings).toContain("2.1. Учебный план");
    expect(headings).toContain("Паспорт результата");
    expect(headings).toContain("Приложение 1. Оценочные материалы");
    expect(headings).toContain("3.4. Кадровое обеспечение");
    expect(headings.join("\n")).not.toMatch(/Преподаватель:\s*[А-ЯЁ]/);
    const buffer = await Packer.toBuffer(buildCourseDocx(SAMPLE_COURSE));
    expect(buffer.byteLength).toBeGreaterThan(10_000);
    const text = docxToText(buffer);
    expect(text).toContain("2.1. Учебный план");
    expect(() => docxToText(new Uint8Array([1, 2, 3, 4]))).toThrow(/docx/);
  });

  it("для повышения квалификации ставит характеристику и предупреждение про приказ № 499", () => {
    const course = structuredClone(SAMPLE_COURSE);
    course.brief.programKind = "qualification";
    const headings = courseDocxHeadings(course);
    expect(headings).toContain("1.1. Аннотация программы");
    expect(headings).toContain("1.9. Выдаваемый документ");
    expect(headings.join("\n")).toContain("утратил силу с 01.09.2025");
  });


  it("скачивает программу, семинар и тест и молчит, если модуля нет", async () => {
    const downloads: string[] = [];
    vi.stubGlobal("document", {
      createElement: () => ({
        href: "",
        download: "",
        click(this: { download: string }) {
          downloads.push(this.download);
        },
      }),
    });
    vi.stubGlobal("URL", {
      createObjectURL: () => "blob:course",
      revokeObjectURL: () => {},
    });
    await exportCourseDocx(SAMPLE_COURSE);
    await exportSeminarDocx(SAMPLE_COURSE, "m1");
    await exportAssessmentDocx(SAMPLE_COURSE, "m1");
    await exportSeminarDocx(SAMPLE_COURSE, "нет-такого");
    await exportAssessmentDocx(SAMPLE_COURSE, "нет-такого");
    expect(downloads).toHaveLength(3);
    expect(downloads[0]).toMatch(/\.docx$/);
    expect(downloads[1]).toMatch(/семинар\.docx$/);
    expect(downloads[2]).toMatch(/тест\.docx$/);
  });

  it("собирает непустой PPTX", async () => {
    const pptx = await buildCoursePptxAsync(SAMPLE_COURSE, "m1");

    const output = await pptx.write({
      outputType: "nodebuffer",
      compression: true,
    });

    expect(output).toBeInstanceOf(Uint8Array);
    expect((output as Uint8Array).byteLength).toBeGreaterThan(10_000);
  });
});
