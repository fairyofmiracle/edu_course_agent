import { extractText, getDocumentProxy } from "unpdf";
import { docxToText } from "@/lib/docx-text";

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
    if (contentType.includes("application/json")) {
      const { url } = (await req.json()) as { url?: string };
      if (!url) {
        return Response.json({ error: "Нужен url" }, { status: 400 });
      }
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return Response.json({ error: "Разрешены только http(s) ссылки" }, { status: 400 });
      }
      const response = await fetch(parsed.toString(), {
        signal: AbortSignal.timeout(8000),
        headers: { Accept: "text/html,text/plain,*/*" },
      });
      if (!response.ok) {
        return Response.json(
          { error: `Не удалось скачать референс (${response.status})` },
          { status: 400 },
        );
      }
      const raw = await response.text();
      const text = clip(stripHtml(raw));
      return Response.json({ title: parsed.hostname, text });
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return Response.json({ error: "Нужен файл" }, { status: 400 });
    }

    const name = file.name.toLowerCase();
    const buffer = new Uint8Array(await file.arrayBuffer());

    if (name.endsWith(".docx")) {
      return Response.json({ title: file.name, text: clip(docxToText(buffer)) });
    }

    if (name.endsWith(".pdf")) {
      const pdf = await getDocumentProxy(buffer);
      const extracted = await extractText(pdf, { mergePages: true });
      const text = clip(extracted.text);
      return Response.json({ title: file.name, text });
    }

    const decoded = new TextDecoder().decode(buffer);
    return Response.json({ title: file.name, text: clip(decoded) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка извлечения";
    return Response.json({ error: message }, { status: 500 });
  }
}
