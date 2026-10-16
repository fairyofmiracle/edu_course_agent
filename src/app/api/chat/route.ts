import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  type UIMessage,
} from "ai";
import { getLanguageModel } from "@/lib/agent/model";
import { sanitizeMessagesForCloudRu } from "@/lib/agent/chat-messages";
import { createTurn, toolErrors } from "@/lib/agent/turn";
import { messageText } from "@/lib/session-log";
import { appendServerLog, describeError } from "@/lib/server-log";
import { applyPatch, foldCourseFromMessages } from "@/lib/course-patches";
import {
  briefSchema,
  courseDocumentSchema,
  createEmptyCourse,
  type CourseBrief,
  type CourseDocument,
} from "@/lib/course-schema";

export const maxDuration = 300;

async function pythonChatResponse(options: {
  baseUrl: string;
  messages: UIMessage[];
  course: CourseDocument;
  userTexts: string[];
  extraReferences?: string;
  formBrief?: Partial<CourseBrief>;
}) {
  const response = await fetch(`${options.baseUrl.replace(/\/$/, "")}/api/chat/turn`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      course: options.course,
      userTexts: options.userTexts,
      messages: options.messages
        .filter((message) => message.role === "user" || message.role === "assistant")
        .map((message) => ({ role: message.role, content: messageText(message) }))
        .filter((message) => message.content.trim()),
      extraReferences: options.extraReferences,
      formBrief: options.formBrief,
    }),
    signal: AbortSignal.timeout(290_000),
  });
  const payload = (await response.json()) as {
    detail?: string;
    assistant?: string;
    patches?: Array<{ type: string; [key: string]: unknown }>;
  };
  if (!response.ok) {
    throw new Error(payload.detail || `Python backend: HTTP ${response.status}`);
  }

  const stream = createUIMessageStream({
    originalMessages: options.messages,
    execute: ({ writer }) => {
      for (const [index, patch] of (payload.patches ?? []).entries()) {
        const toolCallId = `python-${Date.now()}-${index}`;
        writer.write({
          type: "tool-input-available",
          toolCallId,
          toolName: patch.type,
          input: {},
          dynamic: true,
        });
        writer.write({
          type: "tool-output-available",
          toolCallId,
          output: patch,
          dynamic: true,
        });
      }
      const text = payload.assistant?.trim();
      if (text) {
        const id = `python-text-${Date.now()}`;
        writer.write({ type: "text-start", id });
        writer.write({ type: "text-delta", id, delta: text });
        writer.write({ type: "text-end", id });
      }
    },
  });
  return createUIMessageStreamResponse({ stream });
}

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
    return Response.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const parsedCourse = courseDocumentSchema.safeParse(body.course);
  const messages = body.messages ?? [];
  let course = parsedCourse.success
    ? parsedCourse.data
    : foldCourseFromMessages(messages, createEmptyCourse());
  const brief = briefSchema.partial().safeParse(body.brief);
  const formBrief = brief.success && Object.keys(brief.data).length > 0 ? brief.data : undefined;
  if (formBrief) course = applyPatch(course, { type: "update_brief", brief: formBrief });
  const userTexts = messages.filter((message) => message.role === "user").map(messageText);

  try {
    const pythonUrl = process.env.PYTHON_AGENT_URL?.trim();
    if (pythonUrl) {
      return await pythonChatResponse({
        baseUrl: pythonUrl,
        messages,
        course,
        userTexts,
        extraReferences: body.extraReferences,
        formBrief,
      });
    }

    const turn = createTurn({ course, userTexts, extraReferences: body.extraReferences, formBrief });
    const history = sanitizeMessagesForCloudRu(messages);
    console.log(`[chat] режим ${turn.mode}, реплик ${userTexts.length}, сообщений ${history.length}`);

    const result = streamText({
      model: getLanguageModel("writer"),
      system: turn.system,
      messages: await convertToModelMessages(history, { tools: turn.tools }),
      tools: turn.tools,
      stopWhen: turn.stopWhen,
      prepareStep: turn.prepareStep,
      onError: ({ error }) => {
        console.error("[chat] ошибка модели:", error);
        void appendServerLog({ text: describeError(error), mode: turn.mode, steps: turn.planned });
      },
      onFinish: ({ steps }) => {
        const failed = toolErrors(steps);
        void appendServerLog({
          text: `Ход завершён: ${steps.length} шагов`,
          mode: turn.mode,
          steps: turn.planned,
          toolErrors: failed.length ? failed : undefined,
        });
      },
    });

    return result.toUIMessageStreamResponse({
      onError: (error) =>
        error instanceof Error ? error.message : "Не удалось собрать программу",
    });
  } catch (error) {
    console.error("[chat] ошибка маршрута:", error);
    const message = error instanceof Error ? error.message : "Не удалось подключить модель";
    return Response.json({ error: message }, { status: 500 });
  }
}
