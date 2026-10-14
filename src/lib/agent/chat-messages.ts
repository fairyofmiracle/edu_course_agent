import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { COURSE_TOOL_NAMES } from "@/lib/agent/tools";

const FINISHED_TOOL = new Set(["output-available", "output-error"]);

/**
 * Удаляет из истории незавершённые вызовы инструментов
 * и вызовы инструментов, не объявленных для Cloud.ru.
 */
export function sanitizeMessagesForCloudRu(
  messages: UIMessage[],
  declared: readonly string[] = COURSE_TOOL_NAMES,
): UIMessage[] {
  const allowed = new Set(declared);

  return messages
    .map((message) => {
      const parts = (message.parts ?? []).filter((part) => {
        // Обычный текст и другие части сообщений оставляем
        if (!isToolUIPart(part)) return true;

        // определяем название инструмента
        const name = getToolName(part);

        // удаляем вызовы инструментов которых нет в списке
        if (!allowed.has(name)) return false;

        // удаляем незавершённые вызовы инструментов.
        if (!FINISHED_TOOL.has(part.state)) return false;

        // остальные части оставляем
        return true;
      });

      return { ...message, parts };
    })
    .filter((message) => message.parts.length > 0);
}
