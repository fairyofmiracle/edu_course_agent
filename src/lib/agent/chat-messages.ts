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

  // 1. Собираем все tool_call_id, для которых ЕСТЬ результат
  const completedCallIds = new Set<string>();
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      if (!isToolUIPart(part)) continue;
      const name = getToolName(part);
      if (!allowed.has(name)) continue;
      if (!FINISHED_TOOL.has(part.state)) continue;
      // toolInvocation содержит toolCallId
      const callId = (part as any).toolInvocation?.toolCallId;
      if (callId) completedCallIds.add(callId);
    }
  }

  // 2. Фильтруем части, сохраняя парность
  return messages
    .map((message) => {
      const parts = (message.parts ?? []).flatMap((part) => {
        if (!isToolUIPart(part)) return [part];

        const name = getToolName(part);
        // Инструмент не объявлен в текущем списке tools — удаляем
        if (!allowed.has(name)) return [];

        // Завершённый вызов — оставляем
        if (FINISHED_TOOL.has(part.state)) return [part];

        // Незавершённый вызов — оставляем ТОЛЬКО если для него уже есть результат
        // (это значит, что результат просто ещё не попал в UI-состояние, но на бэке он есть)
        const callId = (part as any).toolInvocation?.toolCallId;
        if (callId && completedCallIds.has(callId)) return [part];

        // Иначе — удаляем, чтобы не слать в модель "висящий" tool_call
        return [];
      });
      return { ...message, parts };
    })
    // 3. Не удаляем user-сообщения, даже если у них нет parts
    // (но assistant/tool с пустыми parts — удаляем, они бессмысленны)
    .filter((message) => {
      if (message.role === "user") return true;
      return (message.parts ?? []).length > 0;
    });
}
