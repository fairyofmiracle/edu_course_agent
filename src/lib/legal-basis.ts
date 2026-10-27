import type { CourseBrief, CourseDocument } from "@/lib/course-schema";

export type LegalDocument = {
  id: string;
  title: string;
  source: string;
  note: string;
};

/** Официальное опубликование, не копия текста в репозитории. */
export const LAW_273: LegalDocument = {
  id: "fz-273",
  title: "Федеральный закон от 29.12.2012 № 273-ФЗ «Об образовании в Российской Федерации»",
  source: "http://publication.pravo.gov.ru/document/0001201212300007",
  note: "Официальное опубликование 30.12.2012, номер 0001201212300007. Основание программ повышения квалификации.",
};

export const ORDER_629: LegalDocument = {
  id: "order-629",
  title: "Приказ Минпросвещения России от 27.07.2022 № 629",
  source: "http://publication.pravo.gov.ru/document/0001202209270013",
  note: "Порядок по дополнительным общеобразовательным программам. Официальное опубликование 27.09.2022, регистрация Минюста 26.09.2022 № 70226.",
};

export const ORDER_266: LegalDocument = {
  id: "order-266",
  title: "Приказ Минобрнауки России от 24.03.2025 № 266",
  source: "http://publication.pravo.gov.ru/document/0001202504230011",
  note: "Порядок по дополнительным профессиональным программам. Официальное опубликование 23.04.2025. Действует с 01.09.2025 и признаёт утратившим силу приказ от 01.07.2013 № 499. Методист подтверждает применимость.",
};

export const ORDER_499: LegalDocument = {
  id: "order-499",
  title: "Приказ Минобрнауки России от 01.07.2013 № 499",
  source: "https://www.consultant.ru/document/cons_doc_LAW_151143/",
  note: "Утратил силу с 01.09.2025. В требование он входит как прежнее основание программ повышения квалификации. Действующий порядок — приказ № 266.",
};

export function isOfficialPublication(source: string) {
  const value = source.trim().replace(/\/+$/, "").replace(/^https:\/\//i, "http://").toLowerCase();
  return [LAW_273.source, ORDER_629.source, ORDER_266.source].some(
    (item) => item.replace(/\/+$/, "").replace(/^https:\/\//i, "http://").toLowerCase() === value,
  );
}

export function requiredLegalBasis(kind: CourseBrief["programKind"]): LegalDocument[] {
  if (kind === "general") return [ORDER_629];
  if (kind === "qualification") return [LAW_273, ORDER_266];
  return [];
}

const TITLE_MARKERS: Record<string, RegExp> = {
  "fz-273": /273-фз/,
  "order-629": /№\s*629(?!\d)/,
  "order-266": /№\s*266(?!\d)/,
  "order-499": /№\s*499(?!\d)/,
};

function mentioned(brief: CourseBrief, document: LegalDocument) {
  const source = document.source.toLocaleLowerCase("ru-RU");
  const marker = TITLE_MARKERS[document.id];
  return brief.references.some((reference) => {
    const referenceSource = (reference.source ?? "").toLocaleLowerCase("ru-RU");
    if (referenceSource.includes(source)) return true;
    return marker?.test(reference.title.toLocaleLowerCase("ru-RU")) ?? false;
  });
}

export function mergeLegalBasis(brief: CourseBrief): CourseBrief {
  const required = requiredLegalBasis(brief.programKind);
  if (required.length === 0) return brief;
  const references = [...brief.references];
  for (const document of [...required].reverse()) {
    if (mentioned({ ...brief, references }, document)) continue;
    references.unshift({
      title: document.title,
      source: document.source,
      note: document.note,
    });
  }
  return { ...brief, references: references.slice(0, 20) };
}

export function missingLegalBasis(course: CourseDocument) {
  const brief = course.brief;
  return requiredLegalBasis(brief.programKind).filter((document) => !mentioned(brief, document));
}

export function citesRepealedOrder499(course: CourseDocument) {
  if (course.brief.programKind !== "qualification") return false;
  return course.brief.references.some((reference) => {
    if ((reference.source ?? "") === ORDER_266.source) return false;
    if (/№\s*266(?!\d)/.test(reference.title)) return false;
    return /№\s*499(?!\d)/.test(reference.title);
  });
}
