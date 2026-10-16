import { afterEach, describe, expect, it, vi } from "vitest";
import {
  courseLecturesHtml,
  courseToMarkdown,
  exportCourseAudit,
  exportCourseJson,
  exportCourseMarkdown,
  exportLectureHtml,
  structureMermaid,
} from "@/lib/export";
import { createEmptyCourse } from "@/lib/course-schema";
import { SAMPLE_COURSE } from "@/lib/sample-course";

describe("export", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("собирает markdown, схему и html слайдов", () => {
    const empty = createEmptyCourse();
    expect(courseToMarkdown(empty)).toContain("Без названия");
    expect(structureMermaid(empty)).toBe("");
    expect(courseLecturesHtml(empty)).toBe("");

    const markdown = courseToMarkdown(SAMPLE_COURSE);
    expect(markdown).toContain(SAMPLE_COURSE.brief.title);
    expect(markdown).toContain("## Лекции");
    expect(markdown).toContain("## Семинары");
    expect(markdown).toContain("## Тесты");
    expect(structureMermaid(SAMPLE_COURSE)).toContain("flowchart TD");

    const marked = structuredClone(SAMPLE_COURSE);
    marked.brief.title = "A & B";
    marked.lectures[0].slides[0].title = "1 < 2";
    const html = courseLecturesHtml(marked);
    expect(html).toContain("<section class=\"slide\"");
    expect(html).toContain("A &amp; B");
    expect(html).toContain("1 &lt; 2");
    const one = courseLecturesHtml(SAMPLE_COURSE, SAMPLE_COURSE.lectures[0]?.moduleId);
    expect(one).toContain(SAMPLE_COURSE.lectures[0]?.slides[0]?.title ?? "");
    expect(courseLecturesHtml(SAMPLE_COURSE, "missing")).toBe("");
  });

  it("скачивает json, markdown, проверку и слайды", () => {
    const downloads: string[] = [];
    vi.stubGlobal("URL", {
      createObjectURL: () => "blob:course",
      revokeObjectURL: () => undefined,
    });
    vi.stubGlobal("document", {
      createElement: () => ({
        href: "",
        download: "",
        click() {
          downloads.push(this.download);
        },
      }),
    });

    exportCourseJson(SAMPLE_COURSE);
    exportCourseMarkdown(SAMPLE_COURSE);
    exportCourseAudit(SAMPLE_COURSE);
    exportLectureHtml(SAMPLE_COURSE);
    exportLectureHtml(SAMPLE_COURSE, SAMPLE_COURSE.lectures[0]?.moduleId);
    exportLectureHtml(createEmptyCourse());
    expect(downloads.some((name) => name.endsWith(".json"))).toBe(true);
    expect(downloads.some((name) => name.endsWith(".md"))).toBe(true);
    expect(downloads.some((name) => name.endsWith(".html"))).toBe(true);
    expect(downloads).toHaveLength(5);
  });
});