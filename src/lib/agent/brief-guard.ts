import type { CourseBrief } from "@/lib/course-schema";

export type BriefGuardContext = {
  /** Все реплики методиста в сессии, по порядку. */
  userTexts: string[];
  /** Поля, которые методист задал формой шаблона: им верим без проверки текста. */
  formBrief?: Partial<CourseBrief>;
};

const HOURS = /(\d+)\s*-?\s*(?:академическ\S*\s+|ак\.?\s*)?(?:час|ч(?![а-яё]))/gi;

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

const TITLE_MARKER =
  /программ\w*|курс\w*|повышен\w*\s+квалификац\w*|общеразвивающ\w*|обучен\w*|слушател\w*|академ\w*\s*час|(?:курс|программ\w*)\s+по\s+|(?:назван\w*|тема)\s*[:—-]|«[^»]{3,160}»/i;
const WEAK_TITLE_LEAD = /^(?:делаем|сделаем|давайте|давай|хочу|нужно|прошу)\b/i;
const LEAD_STRIP =
  /^(?:сделайте|сделаем|делаем|давайте|давай|хочу|нужна|нужен|нужно|прошу)\s+/i;

/** Soft RU+EN swear filter — mirror backend brief_guard.contains_profanity */
const PROFANITY =
  /(?<![A-Za-zА-Яа-яЁё])(?:бля(?:д|т|ть|ди|дск)?\w*|сука\w*|сучк\w*|ж+о+п+\w*|хуй\w*|хуя\w*|хуе\w*|хуё\w*|нахуй\w*|нахер\w*|похуй\w*|пизд\w*|еба\w*|ёба\w*|ебл\w*|ёбл\w*|ебу\w*|ёбу\w*|ебан\w*|ёбан\w*|муда\w*|мудил\w*|гавно\w*|говно\w*|залуп\w*|пидор\w*|пидар\w*|долбо[её]б\w*|у[её]б\w*)|(?<![A-Za-z])(?:fuck\w*|fucking|motherfuck\w*|shit\w*|bullshit|asshole\w*|dickhead\w*|bitch\w*|cunt\w*|bastard\w*|wtf\b)/i;

export const PROFANITY_REPLY =
  "Переформулируйте запрос без грубостей — из мата программу не собираю.";

export function collapseRepeats(text: string): string {
  return (text || "").replace(/(.)\1{2,}/gu, "");
}

function containsProfanity(text: string): boolean {
  const raw = text || "";
  return PROFANITY.test(raw) || PROFANITY.test(collapseRepeats(raw));
}

const VOLUME_ONLY_REPLY =
  /^\s*(?:объ[её]м\s*[:—-]?\s*)?\d+(?:[.,]\d+)?\s*(?:академическ\S*\s+|ак\.?\s*)?(?:час(?:а|ов)?|ч)\b/i;

function isUnusableTitle(text: string): boolean {
  const cleaned = (text || "").trim();
  if (cleaned.length < 2) return true;
  if (containsProfanity(cleaned)) return true;
  return false;
}

const VOLUME_FIELD_TITLE = /^(?:объ[её]м|длительность|продолжительность|часов?|hours?|duration)\.?$/i;

const BARE_DURATION = /^(?:месяц(?:а|ев)?|недел[яюи]|день|дня|дней|год(?:а|ов)?|час(?:а|ов)?)\.?$/i;

function clarifyingTitleFromReply(text: string): string {
  let cleaned = (text || "").trim();
  if (!cleaned || SERVICE_PROMPT.test(cleaned)) return "";
  if (containsProfanity(cleaned)) return "";
  if (VOLUME_ONLY_REPLY.test(cleaned)) return "";
  if (BARE_DURATION.test(cleaned)) return "";
  if (VOLUME_FIELD_TITLE.test(cleaned)) return "";
  cleaned = cleaned.replace(/^(?:назван\w*|тема|программ\w*)\s*[:—-]\s*/i, "").trim();
  if (cleaned.length < 2 || isUnusableTitle(cleaned)) return "";
  let title = cleaned.split(/[\n;]/)[0]?.trim().slice(0, 160) ?? "";
  if (title) title = title[0].toUpperCase() + title.slice(1);
  return title && !isUnusableTitle(title) ? title : "";
}

function isGarbageTitle(text: string): boolean {
  const cleaned = (text || "").trim();
  if (cleaned.length < 3) return true;
  if (containsProfanity(cleaned)) return true;
  const words = cleaned.match(/[A-Za-zА-Яа-яЁё0-9+#.]+/g) ?? [];
  if (words.length <= 2 && !TITLE_MARKER.test(cleaned)) return true;
  if (WEAK_TITLE_LEAD.test(cleaned) && !TITLE_MARKER.test(cleaned)) return true;
  return false;
}

export function titleFromRequest(text: string): string {
  if (containsProfanity(text)) return "";
  const quoted = text.match(/«([^»]{3,160})»/);
  if (quoted) {
    const q = quoted[1].trim();
    return containsProfanity(q) || isGarbageTitle(q) ? "" : q;
  }
  let cleaned = text.trim().replace(LEAD_STRIP, "");
  let head = cleaned.split(/\s[—–-]\s|[.,;:\n]/)[0]?.trim() ?? "";
  if (head) head = head[0].toUpperCase() + head.slice(1);
  head = head.slice(0, 160);
  if (!head || containsProfanity(head)) return "";
  if (isGarbageTitle(head) && !TITLE_MARKER.test(text)) return "";
  if (!TITLE_MARKER.test(text) && !TITLE_MARKER.test(head)) return "";
  return head;
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

const VOLUME = /(?:объ[её]м\S*|на)\s*[:—-]?\s*(\d+)\s*(?:академическ\S*\s+|ак\.?\s*)?(?:час|ч(?![а-яё]))/i;

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
    const last =
      [...context.userTexts].reverse().find((text) => text.trim() && !SERVICE_PROMPT.test(text.trim())) ?? "";
    const title =
      titleFromRequest(last) || titleFromRequest(first) || clarifyingTitleFromReply(last);
    if (title) brief.title = title;
  }

  if (!current.audience.trim() && !brief.audience?.trim()) {
    const audience = audienceFromText(texts);
    if (audience) brief.audience = audience;
  }

  if (!current.attestationForm.trim() && !brief.attestationForm?.trim()) {
    const attest = attestationFromText(texts);
    if (attest) brief.attestationForm = attest;
  }

  if (brief.title && (containsProfanity(brief.title) || isUnusableTitle(brief.title))) {
    delete brief.title;
    dropped.push("title");
  }

  if (brief.goals?.length) {
    const clean = brief.goals.filter((g) => !containsProfanity(String(g)));
    if (clean.length !== brief.goals.length) {
      brief.goals = clean;
      dropped.push("goals");
    }
  }

  if ((!brief.goals || brief.goals.length === 0) && current.goals.length === 0) {
    const title = brief.title || current.title;
    if (title && !containsProfanity(title)) brief.goals = [`Освоить программу «${title}»`];
  }

  if (
    brief.attestationHours === undefined &&
    current.attestationHours <= 0 &&
    (brief.attestationForm || current.attestationForm)
  ) {
    const hours = attestationHoursFromText(texts);
    if (hours) brief.attestationHours = hours;
  }

  return { brief, dropped };
}

export function audienceFromText(texts: string[]): string | null {
  for (let index = texts.length - 1; index >= 0; index -= 1) {
    const text = texts[index];
    const labeled = text.match(/слушател\S*\s*[:—-]\s*([^\n.]{8,200})/i);
    if (labeled) return labeled[1].trim().replace(/\s+/g, " ").slice(0, 400);
    const sentence = text.match(
      /слушател\S*\s+([^\n.]{8,200}?)(?=\.\s|Итоговая|Срок|Возьмите|$)/i,
    );
    if (sentence) return `Слушатели ${sentence[1].trim()}`.replace(/\s+/g, " ").slice(0, 400);
    const forWhom = text.match(/для\s+([а-яёa-z0-9 «»"'-]{8,120}?)(?:,|\.|$)/i);
    if (forWhom) return forWhom[1].trim().replace(/\s+/g, " ").slice(0, 400);
  }
  return null;
}

export function attestationHoursFromText(texts: string[]): number | null {
  for (let index = texts.length - 1; index >= 0; index -= 1) {
    const match = texts[index].match(
      /(?:аттестаци\S*|защит\S*)[^.]*?(\d{1,2})\s*(?:академическ\S*\s+|ак\.?\s*)?(?:час|ч(?![а-яё]))/i,
    );
    if (match) return Number(match[1]);
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
