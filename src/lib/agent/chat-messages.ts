import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { COURSE_TOOL_NAMES } from "@/lib/agent/tools";

/**
 * Подготавливает историю сообщений для Cloud.ru.
 * Удаляет недоступные, незавершённые и ошибочные вызовы инструментов.
 */
export function sanitizeMessagesForCloudRu(
  messages: UIMessage[],
  declared: readonly string[] = COURSE_TOOL_NAMES,
): UIMessage[] {
  const allowed = new Set(declared);

  return messages
    .map((message) => {
      const parts = (message.parts ?? []).filter((part) => {
        // Обычные текстовые и другие части сообщения сохраняем.
        if (!isToolUIPart(part)) return true;

        const name = getToolName(part);

        // Удаляем вызовы инструментов, недоступных в текущем запросе.
        if (!allowed.has(name)) return false;

        // Cloud.ru получает только успешно завершённые вызовы.
        if (part.state !== "output-available") return false;

        return true;
      });

      return { ...message, parts };
    })
    .filter((message) => {
      // Сохраняем пользовательские сообщения, даже если parts пуст.
      if (message.role === "user") return true;

      return message.parts.length > 0;
    });
}
