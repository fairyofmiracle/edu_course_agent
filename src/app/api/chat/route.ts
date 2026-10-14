import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type UIMessage,
  isToolUIPart,
  getToolName,
} from "ai";
import { buildSystemPrompt } from "@/lib/agent/prompts";
import { getLanguageModel } from "@/lib/agent/model";
import { sanitizeMessagesForCloudRu } from "@/lib/agent/chat-messages";
import { createCourseTools } from "@/lib/agent/tools";
import { applyPatch, foldCourseFromMessages } from "@/lib/course-patches";
import { isFrameworkApproved } from "@/lib/framework-check";
import {
  briefSchema,
  courseDocumentSchema,
  createEmptyCourse,
  type CourseBrief,
  type CourseDocument,
} from "@/lib/course-schema";

export const maxDuration = 120;

export async function POST(req: Request) {
  let body: {
    messages?: UIMessage[];
    course?: CourseDocument;
    extraReferences?: string;
    brief?: Partial<CourseBrief>;
  };

  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Некорректный JSON запроса" }, { status: 400 });
  }

  const parsedCourse = courseDocumentSchema.safeParse(body.course);
  const incoming = parsedCourse.success ? parsedCourse.data : createEmptyCourse();
  const messages = body.messages ?? [];
  let course = foldCourseFromMessages(messages, incoming);
  const brief = briefSchema.partial().safeParse(body.brief);
  if (brief.success && Object.keys(brief.data).length > 0) {
    course = applyPatch(course, { type: "update_brief", brief: brief.data });
  }
  const userTurns = messages.filter((message) => message.role === "user").length;

  try {
    const tools = createCourseTools(isFrameworkApproved(course), course);
    const history = sanitizeMessagesForCloudRu(messages);
    //  ==========================================================
    //  БЛОК ДЕТАЛЬНОГО ЛОГИРОВАНИЯ ИСТОРИИ
    //  ==========================================================
    console.log("\n=== 🕵️ ОТЛАДКА: История сообщений перед streamText ===");
    history.forEach((msg, i) => {
      console.log(`[MSG ${i}] role: ${msg.role}`);
      
      if (msg.parts && msg.parts.length > 0) {
        msg.parts.forEach((part, j) => {
          if (isToolUIPart(part)) {
            const name = getToolName(part);
            // Безопасно извлекаем toolCallId и state, так как структура может меняться между версиями AI SDK
            const callId = (part as any).toolCallId || (part as any).toolInvocation?.toolCallId || 'N/A';
            const state = (part as any).state || (part as any).toolInvocation?.state || 'unknown';
            console.log(`  ├─ part[${j}]: 🛠️ TOOL [${name}] | state: ${state} | callId: ${callId}`);
          } else if (part.type === 'text') {
            const textPreview = String((part as any).text || '').substring(0, 60).replace(/\n/g, ' ');
            console.log(`  ├─ part[${j}]: 📝 TEXT "${textPreview}..."`);
          } else {
            console.log(`  ├─ part[${j}]: 📦 ${part.type}`);
          }
        });
      } else {
        console.log(`  └─ (пустое сообщение без parts)`);
      }
    });
    console.log("=======================================================\n");
    //  ==========================================================
    //  КОНЕЦ БЛОКА ЛОГИРОВАНИЯ
    //  ==========================================================

    const result = streamText({
      model: getLanguageModel("writer"),
      system: buildSystemPrompt(course, body.extraReferences, userTurns),
      messages: await convertToModelMessages(history, { tools }),
      tools,
      stopWhen: stepCountIs(20),
    });

    return result.toUIMessageStreamResponse({
      onError: (error) =>
        error instanceof Error ? error.message : "Не удалось сгенерировать курс",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Не удалось подключить модель";
    console.error("❌ Ошибка в CHAT ROUTE:", error);
    return Response.json({ error: message }, { status: 500 });
  }
}
