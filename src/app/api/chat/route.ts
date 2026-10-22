import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from "ai";
import { applyPatch, foldCourseFromMessages } from "@/lib/course-patches";
import {
  briefSchema,
  courseDocumentSchema,
  createEmptyCourse,
  type CourseBrief,
  type CourseDocument,
} from "@/lib/course-schema";
import { chatFailureText } from "@/lib/server-log";
import { messageText } from "@/lib/session-log";

export const maxDuration = 300;

function pythonAgentUrl() {
  return process.env.PYTHON_AGENT_URL?.trim().replace(/\/$/, "") ?? "";
}

async function pythonChatResponse(options: {
  baseUrl: string;
  messages: UIMessage[];
  course: CourseDocument;
  userTexts: string[];
  extraReferences?: string;
  formBrief?: Partial<CourseBrief>;
}) {
  const response = await fetch(`${options.baseUrl}/api/chat/turn`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.STUDIO_API_TOKEN?.trim()
        ? { Authorization: `Bearer ${process.env.STUDIO_API_TOKEN.trim()}` }
        : {}),
    },
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
    gatewayRetries?: number[];
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
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
      const retry = payload.gatewayRetries?.at(-1);
      const notice = retry ? `Шлюз ответил с попытки ${retry}.` : "";
      const text = [notice, payload.assistant?.trim()].filter(Boolean).join("\n\n");
      if (text) {
        const id = `python-text-${Date.now()}`;
        writer.write({ type: "text-start", id });
        writer.write({ type: "text-delta", id, delta: text });
        writer.write({ type: "text-end", id });
      }
      const usage = payload.usage;
      if (usage && (usage.total_tokens ?? 0) > 0) {
        writer.write({
          type: "data-usage",
          data: {
            prompt_tokens: usage.prompt_tokens ?? 0,
            completion_tokens: usage.completion_tokens ?? 0,
            total_tokens: usage.total_tokens ?? 0,
          },
        });
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

  const pythonUrl = pythonAgentUrl();
  if (!pythonUrl) {
    return Response.json(
      {
        error: "Чат сейчас без API. Откройте студию через Docker на порту 8000.",
      },
      { status: 503 },
    );
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
    return await pythonChatResponse({
      baseUrl: pythonUrl,
      messages,
      course,
      userTexts,
      extraReferences: body.extraReferences,
      formBrief,
    });
  } catch (error) {
    console.error("[chat] ошибка маршрута:", error);
    return Response.json(
      { error: chatFailureText(error) },
      { status: 500 },
    );
  }
}
