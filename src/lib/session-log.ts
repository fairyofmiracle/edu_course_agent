import { getToolName, isToolUIPart, type UIMessage } from "ai";
import type { FrameworkItem } from "@/lib/framework-check";

export type LogRole = "user" | "assistant" | "error" | "action";

export type SessionLogEntry = {
  id: string;
  at: string;
  sessionId: string;
  role: LogRole;
  text: string;
  tools?: string[];
  failed?: string[];
  messageId?: string;
};

const MAX_TEXT = 4000;
const TOOL_LABELS: Record<string, string> = {
  update_brief: "бриф",
  set_competency_map: "компетенции",
  set_structure: "план",
  set_lecture: "лекция",
  set_seminar: "семинар",
  set_assessment: "тест",
  revise_section: "правка",
};

export function clipLogText(value: string) {
  const text = value.trim();
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;
}

export function messageText(message: UIMessage) {
  return message.parts
    .flatMap((part) => (part.type === "text" && part.text ? [part.text] : []))
    .join("\n")
    .trim();
}

export function messageTools(message: UIMessage) {
  const names: string[] = [];
  for (const part of message.parts) {
    if (!isToolUIPart(part)) continue;
    const raw = getToolName(part);
    names.push(TOOL_LABELS[raw] ?? raw);
  }
  return names;
}

export function failedChecks(items: FrameworkItem[]) {
  return items.filter((item) => !item.ok).map((item) => item.label);
}

export function entryFromMessage(options: {
  sessionId: string;
  message: UIMessage;
  checks?: FrameworkItem[];
}): SessionLogEntry | null {
  const { sessionId, message, checks } = options;
  const text = messageText(message);
  const tools = message.role === "assistant" ? messageTools(message) : [];
  if (!text && tools.length === 0) return null;
  const failed = message.role === "assistant" ? failedChecks(checks ?? []) : [];
  return {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    sessionId,
    role: message.role === "user" ? "user" : "assistant",
    text: clipLogText(text || (tools.length ? `Вызовы: ${tools.join(", ")}` : "")),
    tools: tools.length ? tools : undefined,
    failed: failed.length ? failed : undefined,
    messageId: message.id,
  };
}

export function actionEntry(sessionId: string, text: string): SessionLogEntry {
  return {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    sessionId,
    role: "action",
    text,
  };
}

export function errorEntry(sessionId: string, text: string): SessionLogEntry {
  return {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    sessionId,
    role: "error",
    text: clipLogText(text),
  };
}

export function persistLog(entry: SessionLogEntry) {
  void fetch("/api/log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  }).catch(() => undefined);
}
