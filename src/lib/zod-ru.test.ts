import { describe, expect, it } from "vitest";
import { z } from "zod";
import { courseCompleteness, isCourseEmpty } from "@/lib/course-schema";
import { createEmptyCourse } from "@/lib/course-schema";
import { SAMPLE_COURSE } from "@/lib/sample-course";
import { contentGaps, outcomeGaps } from "@/lib/framework-check";
import { russianZodError } from "@/lib/zod-ru";

describe("русские сообщения схемы и полнота курса", () => {
  it("переводит ошибку zod и считает пустой курс", () => {
    const parsed = z.object({ title: z.string().min(1) }).safeParse({});
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(russianZodError(parsed.error)).toContain("title");

    const root = z.string().safeParse(1);
    if (!root.success) expect(russianZodError(root.error).startsWith("корень")).toBe(true);

    const empty = createEmptyCourse();
    expect(isCourseEmpty(empty)).toBe(true);
    expect(courseCompleteness(empty).score).toBe(0);
    expect(isCourseEmpty(SAMPLE_COURSE)).toBe(false);
    expect(courseCompleteness(SAMPLE_COURSE).score).toBeGreaterThan(0);
    expect(outcomeGaps(SAMPLE_COURSE)).toEqual([]);
    expect(contentGaps(createEmptyCourse())).toEqual([]);
  });
});