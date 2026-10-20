import { describe, expect, it } from "vitest";
import { guardBrief, mentionedHours, volumeFromText } from "@/lib/agent/brief-guard";
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
    expect(brief.audience).toMatch(/студенты 3 курса/i);
  });

  it("из полного запроса DevOps достаёт название, аудиторию и 256 часов", () => {
    const request =
      "Нужна программа повышения квалификации в форме стажировки «DevOps-инженер от Linux до CI/CD» на 256 часов. Слушатели проходят стажировку в ИТ-компаниях региона, вся работа самостоятельная под руководством наставника от компании, аудиторных занятий нет. Итоговая аттестация занимает 2 часа и проходит в форме защиты отчёта о стажировке.";
    const { brief } = guardBrief({}, createEmptyCourse().brief, { userTexts: [request] });
    expect(brief.title).toBe("DevOps-инженер от Linux до CI/CD");
    expect(brief.durationHours).toBe(256);
    expect(brief.programKind).toBe("qualification");
    expect(brief.audience).toMatch(/стажировку в ИТ-компаниях/i);
    expect(brief.attestationHours).toBe(2);
    expect(brief.goals?.length).toBeGreaterThan(0);
  });

  it("слышит объём больше трёх знаков", () => {
    expect(volumeFromText(["нужна программа на 1024 часа"])).toBe(1024);
    expect(mentionedHours("1024 часа")).toEqual([1024]);
  });
});
