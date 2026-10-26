export function appendTranscript(current: string, spoken: string) {
  const next = spoken.replace(/\s+/g, " ").trim();
  if (!next) return current;
  const base = current.trim();
  return base ? `${base} ${next}` : next;
}
