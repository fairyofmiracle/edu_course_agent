import { describe, expect, it } from "vitest";
import { filledBriefLines, missingBriefLines, briefStatusBlock } from "@/lib/brief-status";
import { createEmptyCourse } from "@/lib/course-schema";

describe("briefStatus", () => {
  it("считает шаблон, аудиторию, часы и цель заполненными", () => {
    const course = createEmptyCourse();
    course.brief.programKind = "general";
    course.brief.audience = "Студенты 2 курса колледжа";
    course.brief.durationHours = 72;
    course.brief.goals = ["База кибербезопасности и Cisco Packet Tracer"];
    expect(missingBriefLines(course)).toEqual([]);
    expect(filledBriefLines(course).join(" ")).toMatch(/72/);
  });

  it("после двух реплик запрещает новые вопросы", () => {
    const course = createEmptyCourse();
    course.brief.audience = "колледж";
    const block = briefStatusBlock(course, 2);
    expect(block).toMatch(/нельзя задавать вопросы/i);
  });

  it("при полном брифе сразу требует каркас, даже на первом ходе", () => {
    const course = createEmptyCourse();
    course.brief.programKind = "general";
    course.brief.audience = "колледж";
    course.brief.durationHours = 72;
    course.brief.goals = ["Packet Tracer"];
    expect(briefStatusBlock(course, 1)).toMatch(/Сразу set_competency_map/);
  });
});
