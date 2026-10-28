/** Map chat-pending materials into course brief.references ("Материалы"). */
export type PendingMaterial = { label: string; body: string; source?: string };

export type MaterialReference = {
  title: string;
  source: string;
  note: string;
};

/** File/URL attached in chat → reference row after the methodologist sends. */
export function materialToReference(item: PendingMaterial): MaterialReference {
  const source = (item.source ?? "").trim() || item.label;
  const isUrl = /^https?:\/\//i.test(source);
  return {
    title: item.label,
    source,
    note: isUrl ? "Ссылка добавлена методистом" : "Файл загружен методистом",
  };
}
