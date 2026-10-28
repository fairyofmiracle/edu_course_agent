import { describe, expect, it } from "vitest";
import { matchesHoursFilter } from "@/lib/course-library";

describe("фильтр часов каталога", () => {
  it("делит объём на диапазоны", () => {
    expect(matchesHoursFilter(16, "lt36")).toBe(true);
    expect(matchesHoursFilter(36, "lt36")).toBe(false);
    expect(matchesHoursFilter(36, "36to72")).toBe(true);
    expect(matchesHoursFilter(72, "36to72")).toBe(true);
    expect(matchesHoursFilter(144, "gte72")).toBe(true);
    expect(matchesHoursFilter(0, "lt36")).toBe(false);
    expect(matchesHoursFilter(16, "all")).toBe(true);
  });
});
