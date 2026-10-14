import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { COURSE_TOOL_NAMES } from "@/lib/agent/tools";

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
      const parts = (message.parts ?? []).flatMap((part): UIMessage["parts"] => {
        if (!isToolUIPart(part)) return [part];
        
        const name = getToolName(part);
        // Удаляем инструменты, которых нет в текущем списке
        if (!allowed.has(name)) return [];
        
        // ⚠️ ГЛАВНОЕ ИЗМЕНЕНИЕ:
        // Cloud.ru не понимает состояния 'output-error' и незавершенных вызовов.
        // Оставляем ТОЛЬКО успешно завершенные вызовы.
        if (part.state !== "output-available") return [];
        
        return [part];
      });
      
      return { ...message, parts };
    })
    // Не удаляем user-сообщения, даже если они вдруг стали пустыми после фильтрации
    .filter((message) => {
      if (message.role === "user") return true;
      return (message.parts ?? []).length > 0;
    });
}