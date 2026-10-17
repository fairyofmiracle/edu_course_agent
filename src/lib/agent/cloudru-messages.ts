type ToolCall = {
  id: string;
  type?: string;
  function: { name: string; arguments: string };
};

export type OpenAIMessage = {
  role: string;
  content?: unknown;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  [key: string]: unknown;
};

const CONTROL_TOKEN = /<\|[^|<>]{0,40}\|>/g;

export function stripControlTokens(value: string) {
  return value.replace(CONTROL_TOKEN, "");
}

function cleanContent(content: unknown): unknown {
  if (typeof content === "string") return stripControlTokens(content);
  if (Array.isArray(content)) {
    return content.map((part) =>
      part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
        ? { ...part, text: stripControlTokens((part as { text: string }).text) }
        : part,
    );
  }
  return content;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
          ? (part as { text: string }).text
          : "",
      )
      .join("\n");
  }
  return "";
}

function joinText(a: string, b: string) {
  const left = a.trim();
  const right = b.trim();
  if (!left) return right;
  if (!right || left === right) return left;
  return `${left}\n\n${right}`;
}

/**
 * GigaChat в Cloud.ru принимает только строгое чередование: user → assistant,
 * у assistant не больше одного tool_call, и сразу за ним его tool-ответ.
 * Иначе 400 «Unexpected user message or missing tool result».
 */
export function normalizeCloudRuMessages(input: OpenAIMessage[]): OpenAIMessage[] {
  const results = new Map<string, OpenAIMessage>();
  for (const message of input) {
    if (message.role === "tool" && message.tool_call_id) {
      results.set(message.tool_call_id, message);
    }
  }

  const paired: OpenAIMessage[] = [];
  for (const raw of input) {
    const message: OpenAIMessage = { ...raw, content: cleanContent(raw.content) };
    if (message.role === "tool") continue;
    if (message.role !== "assistant" || !message.tool_calls?.length) {
      paired.push(message);
      continue;
    }
    const calls = message.tool_calls.filter((call) => results.has(call.id));
    const text = contentText(message.content);
    if (calls.length === 0) {
      if (text.trim()) paired.push({ role: "assistant", content: text });
      continue;
    }
    calls.forEach((call, index) => {
      paired.push({
        role: "assistant",
        content: index === 0 ? text : "",
        tool_calls: [
          {
            ...call,
            function: {
              ...call.function,
              arguments: stripControlTokens(call.function.arguments ?? "{}"),
            },
          },
        ],
      });
      const result = results.get(call.id)!;
      paired.push({ ...result, content: cleanContent(result.content) });
    });
  }

  const merged: OpenAIMessage[] = [];
  for (const message of paired) {
    const prev = merged[merged.length - 1];
    const plain = message.role === "user" || (message.role === "assistant" && !message.tool_calls);
    if (prev && plain && prev.role === message.role && !prev.tool_calls) {
      merged[merged.length - 1] = {
        ...prev,
        content: joinText(contentText(prev.content), contentText(message.content)),
      };
      continue;
    }
    if (message.role === "assistant" && !message.tool_calls && !contentText(message.content).trim()) {
      continue;
    }
    if (message.role === "user" && prev?.role === "tool") {
      merged.push({ role: "assistant", content: "Изменения внесены в документ." });
    }
    merged.push(message);
  }
  return merged;
}

export function normalizeCloudRuBody(body: string): string {
  let parsed: { messages?: OpenAIMessage[] };
  try {
    parsed = JSON.parse(body);
  } catch {
    return body;
  }
  if (!Array.isArray(parsed.messages)) return body;
  return JSON.stringify({ ...parsed, messages: normalizeCloudRuMessages(parsed.messages) });
}
