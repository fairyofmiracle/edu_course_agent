import { describe, expect, it } from "vitest";
import {
  chatWaitLabel,
  queueWaitLabel,
  exportDoneLabel,
  exportKindName,
  exportWaitLabel,
  fileWaitLabel,
  workProgress,
} from "./job-status";

describe("job status labels", () => {
  it("очередь показывает место и ход модели", () => {
    expect(queueWaitLabel("queued", 1)).toMatch(/место 1/);
    expect(queueWaitLabel("queued", 3)).toMatch(/место 3/);
    expect(queueWaitLabel("running")).toMatch(/остановить/);
    expect(queueWaitLabel("done")).toBe("");
  });

  it("чат идёт от отправки к повторам", () => {
    expect(chatWaitLabel(0)).toMatch(/Отправляю/);
    expect(chatWaitLabel(4000)).toMatch(/Готовлю ответ/);
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
    expect(exportKindName("moodle")).toBe("Moodle");
    expect(exportDoneLabel("moodle")).toBe("Moodle готов");
  });

  it("прогресс оценивается без нового запроса к модели", () => {
    expect(workProgress("ask", 0).label).toMatch(/примерно ещё/);
    expect(workProgress("ask", 39_000).label).toBe("Почти готово");
    expect(workProgress("kit", 10_000).ratio).toBeGreaterThan(0);
    expect(workProgress("kit", 10_000).ratio).toBeLessThan(1);
  });
});
