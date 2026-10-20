import PptxGenJS from "pptxgenjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_COURSE } from "@/lib/sample-course";

vi.mock("@/lib/presentation/course-to-presentation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/presentation/course-to-presentation")>();
  return {
    ...actual,
    courseToPresentation: (course: typeof SAMPLE_COURSE, moduleId?: string) => {
      if (course.brief.title === "__empty__") {
        return { title: "Пусто", slides: [] };
      }
      return actual.courseToPresentation(course, moduleId);
    },
  };
});

describe("export-pptx", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("синхронный экспорт без слайдов даёт обложку", async () => {
    const { buildCoursePptx } = await import("@/lib/export-pptx");
    const course = structuredClone(SAMPLE_COURSE);
    course.brief.title = "__empty__";
    const pptx = buildCoursePptx(course);
    expect(pptx.title).toContain("материалы лекций");
  }, 20_000);

  it("синхронный экспорт со слайдами просит async", async () => {
    const { buildCoursePptx } = await import("@/lib/export-pptx");
    expect(() => buildCoursePptx(SAMPLE_COURSE, "m1")).toThrow(/buildCoursePptxAsync/);
  });

  it("пишет файл лекций выбранного модуля", async () => {
    const writeFile = vi.spyOn(PptxGenJS.prototype, "writeFile").mockResolvedValue(undefined);
    const { exportCoursePptx } = await import("@/lib/export-pptx");
    await exportCoursePptx(SAMPLE_COURSE, "m1");
    expect(writeFile).toHaveBeenCalled();
    const names = writeFile.mock.calls.map((call) => String(call[0]?.fileName ?? ""));
    expect(names.every((name) => name.endsWith(".pptx"))).toBe(true);
  });
});
