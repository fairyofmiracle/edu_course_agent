import { describe, expect, it } from "vitest";
import {
  chatWaitLabel,
  exportDoneLabel,
  exportKindName,
  exportWaitLabel,
  fileWaitLabel,
  usageLine,
  workProgress,
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

  it("прогресс и токены читаются без нового запроса к модели", () => {
    expect(workProgress("ask", 0).label).toMatch(/примерно ещё/);
    expect(workProgress("ask", 39_000).label).toBe("Почти готово");
    expect(workProgress("kit", 10_000).ratio).toBeGreaterThan(0);
    expect(workProgress("kit", 10_000).ratio).toBeLessThan(1);
    expect(usageLine(null)).toBe("");
    expect(usageLine({ prompt_tokens: 1200, completion_tokens: 300, total_tokens: 1500 }).replace(/\s/g, " ")).toBe(
      "Токены: 1 200 на вход, 300 на выход, 1 500 всего",
    );
  });
});
