import { inflateRawSync } from "node:zlib";

const LOCAL_FILE = 0x04034b50;
const CENTRAL_FILE = 0x02014b50;
const END_CENTRAL = 0x06054b50;

function findEnd(buffer: Buffer) {
  const start = Math.max(0, buffer.length - 22 - 65535);
  for (let offset = buffer.length - 22; offset >= start; offset -= 1) {
    if (buffer.readUInt32LE(offset) === END_CENTRAL) return offset;
  }
  return -1;
}

export function docxToText(data: Uint8Array): string {
  const buffer = Buffer.from(data);
  const end = findEnd(buffer);
  if (end < 0) throw new Error("Файл не похож на docx");
  const count = buffer.readUInt16LE(end + 10);
  let cursor = buffer.readUInt32LE(end + 16);
  let xml = "";

  for (let index = 0; index < count && cursor + 46 <= buffer.length; index += 1) {
    if (buffer.readUInt32LE(cursor) !== CENTRAL_FILE) break;
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    cursor += 46 + nameLength + extraLength + commentLength;
    if (name !== "word/document.xml") continue;
    if (buffer.readUInt32LE(localOffset) !== LOCAL_FILE) break;
    const localName = buffer.readUInt16LE(localOffset + 26);
    const localExtra = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localName + localExtra;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    const raw = method === 0 ? compressed : inflateRawSync(compressed);
    xml = raw.toString("utf8");
    break;
  }

  if (!xml) throw new Error("В файле нет текста документа");

  const text = xml
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!text) throw new Error("Документ пустой");
  return text;
}
