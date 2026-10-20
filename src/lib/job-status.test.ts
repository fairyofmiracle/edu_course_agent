import { describe, expect, it } from "vitest";
import {
  chatWaitLabel,
  exportDoneLabel,
  exportKindName,
  exportWaitLabel,
  fileWaitLabel,
} from "./job-status";

describe("job status labels", () => {
  it("чат идёт от отправки к повторам", () => {
    expect(chatWaitLabel(0)).toMatch(/Отправляю/);
    expect(chatWaitLabel(4000)).toMatch(/думает/);
    expect(chatWaitLabel(25000)).toMatch(/Жду ответ шлюза/);
    expect(chatWaitLabel(80000)).toMatch(/пишет комплект/);
  });

  it("файл и выгрузка показывают этап", () => {
    expect(fileWaitLabel(200)).toMatch(/Читаю/);
    expect(fileWaitLabel(4000)).toMatch(/Разбираю/);
    expect(exportWaitLabel("docx", 500)).toMatch(/DOCX на сервере/);
    expect(exportWaitLabel("pptx", 4000)).toMatch(/тяжёл/);
    expect(exportDoneLabel("json")).toBe("JSON готов");
    expect(exportWaitLabel("gift", 100, "браузере")).toMatch(/GIFT в браузере/);
    expect(exportKindName("moodle")).toBe("MOODLE");
    expect(exportDoneLabel("moodle")).toBe("MOODLE готов");
  });
});
