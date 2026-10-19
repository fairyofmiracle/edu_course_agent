
import { extractText, getDocumentProxy } from "unpdf";
import { docxToText } from "@/lib/docx-text";
import {
  fetchReferencePage,
  ReferenceFetchError,
} from "@/lib/safe-reference-fetch";

const MAX_CHARS = 12000;

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(text: string) {
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}…` : text;
}

export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";

  try {
    // Загрузка материала по ссылке
    if (contentType.includes("application/json")) {
      const { url } = (await req.json()) as { url?: string };

      if (!url) {
        return Response.json({ error: "Нужен url" }, { status: 400 });
      }

      const page = await fetchReferencePage(url);

      return Response.json({
        title: page.title,
        text: clip(stripHtml(page.html)),
      });
    }

    // Загрузка  с компьютера
    const form = await req.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return Response.json({ error: "Нужен файл" }, { status: 400 });
    }

    const name = file.name.toLowerCase();
    const buffer = new Uint8Array(await file.arrayBuffer());


    if (name.endsWith(".docx")) {
      return Response.json({
        title: file.name,
        text: clip(docxToText(buffer)),
      });
    }

    if (name.endsWith(".pdf")) {
      const pdf = await getDocumentProxy(buffer);
      const extracted = await extractText(pdf, { mergePages: true });

      return Response.json({
        title: file.name,
        text: clip(extracted.text),
      });
    }

    // Обработка остальных текстовых файлов
    const decoded = new TextDecoder().decode(buffer);

    return Response.json({
      title: file.name,
      text: clip(decoded),
    });
  } catch (error) {
    // Ошибки безопасной загрузки ссылок
    if (error instanceof ReferenceFetchError) {
      return Response.json(
        { error: error.message },
        { status: error.status },
      );
    }

    // Остальные ошибки обработки
    const message =
      error instanceof Error ? error.message : "Ошибка извлечения";

    return Response.json({ error: message }, { status: 500 });
  }
}
