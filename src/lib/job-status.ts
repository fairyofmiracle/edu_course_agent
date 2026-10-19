const EXPORT_NAMES: Record<string, string> = {
  json: "JSON",
  docx: "DOCX",
  pptx: "PPTX",
};

export function chatWaitLabel(elapsedMs: number): string {
  if (elapsedMs < 2500) return "Отправляю запрос…";
  if (elapsedMs < 20000) return "Модель думает…";
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
