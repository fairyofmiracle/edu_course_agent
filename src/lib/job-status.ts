const EXPORT_NAMES: Record<string, string> = {
  json: "JSON",
  docx: "DOCX",
  pptx: "PPTX",
  zip: "ZIP",
  moodle: "Moodle",
  gift: "GIFT",
  csv: "CSV",
  html: "слайды",
};

export function queueWaitLabel(status: string, position = 0): string {
  if (status === "queued") {
    const place = position > 0 ? position : 1;
    return place === 1
      ? "В очереди, место 1. Сейчас ход уйдёт к модели."
      : `В очереди, место ${place}.`;
  }
  if (status === "running") return "Модель пишет. Ход можно остановить.";
  return "";
}

export function chatWaitLabel(elapsedMs: number): string {
  if (elapsedMs < 2500) return "Отправляю запрос…";
  if (elapsedMs < 20000) return "Готовлю ответ…";
  if (elapsedMs < 60000) return "Жду ответ шлюза…";
  return "Модель пишет комплект. Это может занять несколько минут.";
}

export function fileWaitLabel(elapsedMs: number): string {
  if (elapsedMs < 1500) return "Читаю файл…";
  return "Разбираю документ…";
}

export function exportWaitLabel(
  kind: string,
  elapsedMs: number,
  place: "сервере" | "браузере" = "сервере",
): string {
  const name = EXPORT_NAMES[kind] ?? kind.toUpperCase();
  const where = place === "браузере" ? "в браузере" : "на сервере";
  if (elapsedMs < 2500) return `Собираю ${name} ${where}…`;
  return `Ещё собираю ${name}, файл тяжёлый…`;
}

export function exportDoneLabel(kind: string): string {
  const name = EXPORT_NAMES[kind] ?? kind.toUpperCase();
  return `${name} готов`;
}

export function exportKindName(kind: string): string {
  return EXPORT_NAMES[kind] ?? kind.toUpperCase();
}

const WORK_MS = { ask: 40_000, framework: 90_000, kit: 180_000 } as const;

/** Оценка по таймеру на экране. Модель для этого не вызывается. */
export function workProgress(stage: keyof typeof WORK_MS, elapsedMs: number) {
  const expected = WORK_MS[stage];
  const ratio = Math.min(0.94, Math.max(0.04, elapsedMs / expected));
  const leftSec = Math.max(0, Math.round((expected - elapsedMs) / 1000));
  const label =
    leftSec <= 8
      ? "Почти готово"
      : leftSec < 60
        ? `примерно ещё ${leftSec} с`
        : `примерно ещё ${Math.ceil(leftSec / 60)} мин`;
  return { ratio, label };
}

export function usageLine(usage: {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
} | null | undefined) {
  const total = usage?.total_tokens ?? 0;
  if (!total) return "";
  const prompt = usage?.prompt_tokens ?? 0;
  const completion = usage?.completion_tokens ?? 0;
  const format = (value: number) => value.toLocaleString("ru-RU");
  return `Токены: ${format(prompt)} на вход, ${format(completion)} на выход, ${format(total)} всего`;
}
