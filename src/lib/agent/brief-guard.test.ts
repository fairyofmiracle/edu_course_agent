import { describe, expect, it } from "vitest";
import { guardBrief, mentionedHours } from "@/lib/agent/brief-guard";
import { createEmptyCourse } from "@/lib/course-schema";

const CYBER =
  "Сделайте курс по кибербезопасности для студентов колледжа, примерно на месяц, чтобы после него ребята могли пойти работать в эту сферу.";

describe("guardBrief", () => {
  it("не даёт превратить «примерно месяц» в 72 часа и не выбирает шаблон сам", () => {
    const { brief, dropped } = guardBrief(
      { durationHours: 72, programKind: "qualification", audience: "студенты колледжа" },
      createEmptyCourse().brief,
      { userTexts: [CYBER] },
    );
    expect(brief.durationHours).toBeUndefined();
    expect(brief.programKind).toBeUndefined();
    expect(dropped).toEqual(["durationHours", "programKind"]);
    expect(brief.title).toBe("Сделайте курс по кибербезопасности для студентов колледжа");
  });

  it("принимает часы и тип из ответа методиста", () => {
    const { brief } = guardBrief(
      { durationHours: 72, programKind: "qualification" },
      createEmptyCourse().brief,
      { userTexts: [CYBER, "Повышение квалификации, 72 часа, очно, экзамен на стенде"] },
    );
    expect(brief.durationHours).toBe(72);
    expect(brief.programKind).toBe("qualification");
  });

  it("не меняет уже заданный объём, если в последней реплике его нет", () => {
    const current = { ...createEmptyCourse().brief, title: "ИИ", durationHours: 36 };
    const { brief } = guardBrief({ durationHours: 72 }, current, {
      userTexts: ["ИИ в работе учителя, 72 часа", "по времени 36 часов", "Собери только каркас"],
    });
    expect(brief.durationHours).toBeUndefined();
  });

  it("находит часы в разных записях", () => {
    expect(mentionedHours("Объем 16 часов, по 2 часа, практики не меньше 8 ч, 256 ак. ч")).toEqual([
      16, 2, 8, 256,
    ]);
  });

  it("из ответа методиста сам вытаскивает 72 часа и qualification", () => {
    const { brief } = guardBrief(
      { goals: ["стенд"] },
      createEmptyCourse().brief,
      {
        userTexts: [
          CYBER,
          "Тип программы: повышение квалификации. Объём: 72 часа. Слушатели: студенты 3 курса.",
        ],
      },
    );
    expect(brief.durationHours).toBe(72);
    expect(brief.programKind).toBe("qualification");
  });
});
