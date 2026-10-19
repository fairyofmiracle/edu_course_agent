import { describe, expect, it } from "vitest";
import { calendarPace } from "@/lib/week-plan";

describe("calendarPace", () => {
  it("шесть занятий по 4 часа за 2 недели дают 12 часов в неделю", () => {
    const pace = calendarPace(
      ["Календарный график: 6 занятий по 4 часа, около 2 недель."],
      24,
    );
    expect(pace).toMatchObject({ perWeek: 12, weeks: 2 });
  });

  it("восемь занятий по 2 часа за 4 недели дают 4 часа в неделю", () => {
    const pace = calendarPace(["Календарный график: 8 занятий по 2 часа, 4 недели."], 16);
    expect(pace).toMatchObject({ perWeek: 4, weeks: 4 });
  });
});
