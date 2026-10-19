
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
    const allowed = [".txt", ".md", ".pdf", ".docx"];
    if (!allowed.some((ext) => name.endsWith(ext))) {
      return Response.json({ error: "Нужен файл .txt, .md, .pdf или .docx." }, { status: 400 });
    }
    if (file.size === 0) {
      return Response.json({ error: "Файл пустой." }, { status: 400 });
    }
    if (file.size > 8 * 1024 * 1024) {
      return Response.json({ error: "Файл больше 8 МБ." }, { status: 400 });
    }
    const buffer = new Uint8Array(await file.arrayBuffer());


    let text = "";
    if (name.endsWith(".docx")) {
      text = docxToText(buffer);
    } else if (name.endsWith(".pdf")) {
      const pdf = await getDocumentProxy(buffer);
      const extracted = await extractText(pdf, { mergePages: true });
      text = extracted.text;
    } else {
      text = new TextDecoder().decode(buffer);
    }
    if (!text.trim()) {
      return Response.json({ error: "В файле нет текста." }, { status: 400 });
    }

    return Response.json({
      title: file.name,
      text: clip(text),
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
    return Response.json(
      { error: "Файл не разобрался. Нужен целый .txt, .md, .pdf или .docx." },
      { status: 422 },
    );
  }
}
