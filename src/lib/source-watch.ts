export type SourceStamp = {
  url: string;
  fingerprint: string;
  seenAt: string;
};

export type SourceNotice =
  | { kind: "unchecked" }
  | { kind: "offline"; seenAt: string }
  | { kind: "first" }
  | { kind: "same"; seenAt: string }
  | { kind: "changed"; seenAt: string };

const STORAGE_KEY = "edu-course-source-watch";

export function noticeFor(previous: SourceStamp | undefined, fingerprint: string): SourceNotice {
  if (!fingerprint) {
    return previous ? { kind: "offline", seenAt: previous.seenAt } : { kind: "unchecked" };
  }
  if (!previous) return { kind: "first" };
  if (previous.fingerprint === fingerprint) return { kind: "same", seenAt: previous.seenAt };
  return { kind: "changed", seenAt: previous.seenAt };
}

export function noticeText(notice: SourceNotice, when: (iso: string) => string): string {
  if (notice.kind === "unchecked") return "";
  if (notice.kind === "first") {
    return "Первая проверка. Запомнили отметку страницы, текст приказа не сохраняли. Если официальная страница изменится, здесь появится предупреждение.";
  }
  if (notice.kind === "same") {
    return `Отметка страницы та же, что при проверке ${when(notice.seenAt)}. Текст приказа не хранится. Если официальная страница изменится, здесь появится предупреждение.`;
  }
  if (notice.kind === "offline") {
    return `Прошлая отметка от ${when(notice.seenAt)} сохранена. Сайт сейчас не ответил, поэтому об изменении страницы сказать нельзя.`;
  }
  return `Отметка страницы изменилась после проверки ${when(notice.seenAt)}. Откройте ссылку и сверьте документ: это ещё не значит, что вышел новый приказ. Текст по-прежнему не хранится.`;
}

function isStamp(value: unknown): value is SourceStamp {
  if (!value || typeof value !== "object") return false;
  const stamp = value as SourceStamp;
  return Boolean(stamp.url && stamp.fingerprint && stamp.seenAt);
}

export function readStamps(storage: Pick<Storage, "getItem">): Record<string, SourceStamp> {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, SourceStamp] => isStamp(entry[1])),
    );
  } catch {
    return {};
  }
}

export function writeStamp(storage: Pick<Storage, "getItem" | "setItem">, stamp: SourceStamp) {
  const stamps = readStamps(storage);
  stamps[stamp.url] = stamp;
  storage.setItem(STORAGE_KEY, JSON.stringify(stamps));
}
