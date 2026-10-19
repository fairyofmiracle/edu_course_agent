const EXPORT_NAMES: Record<string, string> = {
  json: "JSON",
  docx: "DOCX",
  pptx: "PPTX",
};

export function chatWaitLabel(elapsedMs: number): string {
  if (elapsedMs < 2500) return "Отправляю запрос…";
  if (elapsedMs < 20000) return "Модель думает…";
  if (elapsedMs < 70000) return "Жду шлюз. При обрыве будет повтор 2 из 3…";
  return "Долгий ответ. Повтор 3 из 3 или собираю запасной комплект…";
}

export function fileWaitLabel(elapsedMs: number): string {
  if (elapsedMs < 1500) return "Читаю файл…";
  return "Разбираю документ…";
}

export function exportWaitLabel(kind: string, elapsedMs: number): string {
  const name = EXPORT_NAMES[kind] ?? kind.toUpperCase();
  if (elapsedMs < 2500) return `Собираю ${name} на сервере…`;
  return `Ещё собираю ${name}, файл тяжёлый…`;
}

export function exportDoneLabel(kind: string): string {
  const name = EXPORT_NAMES[kind] ?? kind.toUpperCase();
  return `${name} готов`;
}

export function exportKindName(kind: string): string {
  return EXPORT_NAMES[kind] ?? kind.toUpperCase();
}
