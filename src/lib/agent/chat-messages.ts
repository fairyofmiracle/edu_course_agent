import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { COURSE_TOOL_NAMES } from "@/lib/agent/tools";

const FINISHED_TOOL = new Set(["output-available", "output-error"]);

/**
 * Cloud.ru падает с 400, если в истории есть tool_call без результата
 * или вызов функции, которой нет в текущем массиве tools.
 */
export function sanitizeMessagesForCloudRu(
  messages: UIMessage[],
  declared: readonly string[] = COURSE_TOOL_NAMES,
): UIMessage[] {
  const allowed = new Set(declared);
  return messages
    .map((message) => {
      const parts = (message.parts ?? []).flatMap((part) => {
        if (!isToolUIPart(part)) return [part];
        const name = getToolName(part);
        if (!allowed.has(name)) return [];
        if (!FINISHED_TOOL.has(part.state)) return [];
        return [part];
      });
      return { ...message, parts };
    })
    .filter((message) => (message.parts ?? []).length > 0);
}
