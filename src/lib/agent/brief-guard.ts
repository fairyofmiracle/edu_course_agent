import type { CourseBrief } from "@/lib/course-schema";

export type BriefGuardContext = {
  /** Все реплики методиста в сессии, по порядку. */
  userTexts: string[];
  /** Поля, которые методист задал формой шаблона: им верим без проверки текста. */
  formBrief?: Partial<CourseBrief>;
};

const HOURS = /(\d{1,3})\s*-?\s*(?:академическ\S*\s+|ак\.?\s*)?(?:час|ч(?![а-яё]))/gi;

export function mentionedHours(text: string): number[] {
  return [...text.matchAll(HOURS)].map((match) => Number(match[1])).filter((value) => value > 0);
}

const KIND_MARKERS: Record<"general" | "qualification", RegExp> = {
  general: /общеразвива|сертификат/i,
  qualification: /повышени\S*\s+квалификац|удостоверени|профстандарт|профессиональн\S*\s+стандарт|стажировк/i,
};

export function mentionedKind(texts: string[]): "general" | "qualification" | null {
  for (let index = texts.length - 1; index >= 0; index -= 1) {
    const text = texts[index];
    const general = KIND_MARKERS.general.test(text);
    const qualification = KIND_MARKERS.qualification.test(text);
    if (qualification) return "qualification";
    if (general) return "general";
  }
  return null;
}

export const SERVICE_PROMPT = /^(Собери |Каркас утверждён)/;

export function titleFromRequest(text: string): string {
  const quoted = text.match(/«([^»]{3,160})»/);
  if (quoted) return quoted[1].trim();
  const head = text.split(/\s[—–-]\s|[.,;:\n]/)[0]?.trim() ?? "";
  return head.slice(0, 160);
}

/** GigaChat копирует значения по умолчанию из схемы: "", 0, "unset", []. Они не должны затирать бриф. */
export function dropEmptyFields(patch: Partial<CourseBrief>): Partial<CourseBrief> {
  const entries = Object.entries(patch).filter(([, value]) => {
    if (value === undefined || value === null) return false;
    if (typeof value === "string") return value.trim() !== "" && value !== "unset";
    if (typeof value === "number") return value > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
  });
  return Object.fromEntries(entries) as Partial<CourseBrief>;
}

const VOLUME = /(?:объ[её]м\S*|на)\s*[:—-]?\s*(\d{1,3})\s*(?:академическ\S*\s+|ак\.?\s*)?(?:час|ч(?![а-яё]))/i;

export function volumeFromText(texts: string[]): number | null {
  for (let index = texts.length - 1; index >= 0; index -= 1) {
    const match = texts[index].match(VOLUME);
    if (match) return Number(match[1]);
  }
  return null;
}

/**
 * Модель любит дорисовать бриф: «месяц» → 72 ч, «удостоверение» без запроса.
 * Объём и шаблон принимаем, только если их назвал методист.
 */
export function guardBrief(
  patch: Partial<CourseBrief>,
  current: CourseBrief,
  context: BriefGuardContext,
): { brief: Partial<CourseBrief>; dropped: string[] } {
  const brief = dropEmptyFields(patch);
  const dropped: string[] = [];
  const texts = context.userTexts.filter((text) => !SERVICE_PROMPT.test(text.trim()));

  if (brief.durationHours === undefined && current.durationHours <= 0) {
    const volume = volumeFromText(texts);
    if (volume) brief.durationHours = volume;
  }
  if (!brief.programKind && current.programKind === "unset") {
    const kind = mentionedKind(texts);
    if (kind) brief.programKind = kind;
  }
  const form = context.formBrief ?? {};
  const last = context.userTexts[context.userTexts.length - 1] ?? "";

  if (brief.durationHours !== undefined && brief.durationHours !== current.durationHours) {
    const said = context.userTexts.flatMap(mentionedHours);
    const saidNow = mentionedHours(last);
    const fromForm = form.durationHours !== undefined && form.durationHours === brief.durationHours;
    const allowed =
      fromForm ||
      (current.durationHours > 0 ? saidNow.includes(brief.durationHours) : said.includes(brief.durationHours));
    if (!allowed) {
      delete brief.durationHours;
      dropped.push("durationHours");
    }
  }

  if (brief.programKind && brief.programKind !== "unset" && brief.programKind !== current.programKind) {
    const fromForm = form.programKind === brief.programKind;
    if (!fromForm && mentionedKind(context.userTexts) !== brief.programKind) {
      delete brief.programKind;
      dropped.push("programKind");
    }
  }

  if (!current.title.trim() && !brief.title?.trim()) {
    const first =
      context.userTexts.find((text) => text.trim() && !SERVICE_PROMPT.test(text.trim())) ?? "";
    const title = titleFromRequest(first);
    if (title) brief.title = title;
  }

  if (!current.audience.trim() && !brief.audience?.trim()) {
    const audience = audienceFromText(texts);
    if (audience) brief.audience = audience;
  }

  if (!current.attestationForm.trim() && !brief.attestationForm?.trim()) {
    const form = attestationFromText(texts);
    if (form) brief.attestationForm = form;
  }

  return { brief, dropped };
}

export function audienceFromText(texts: string[]): string | null {
  for (let index = texts.length - 1; index >= 0; index -= 1) {
    const labeled = texts[index].match(
      /слушател\S*\s*[:—-]\s*([^\n.]{8,200})/i,
    );
    if (labeled) return labeled[1].trim().replace(/\s+/g, " ").slice(0, 400);
    const forWhom = texts[index].match(/для\s+([а-яёa-z0-9 «»"'-]{8,120}?)(?:,|\.|$)/i);
    if (forWhom) return forWhom[1].trim().replace(/\s+/g, " ").slice(0, 400);
  }
  return null;
}

export function attestationFromText(texts: string[]): string | null {
  for (let index = texts.length - 1; index >= 0; index -= 1) {
    const match = texts[index].match(
      /(?:аттестаци\S*|экзамен|зач[её]т|защит\S*)\s*[:—-]?\s*([^\n]{5,180})/i,
    );
    if (!match) continue;
    const value = match[0].trim().replace(/\s+/g, " ").slice(0, 180);
    if (value) return value;
  }
  return null;
}
