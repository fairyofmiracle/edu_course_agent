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

type ChatPayload = {
  detail?: string;
  jobId?: string;
  status?: string;
  position?: number;
  error?: string;
  result?: ChatPayload;
  assistant?: string;
  patches?: Array<{ type: string; [key: string]: unknown }>;
  gatewayRetries?: number[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    calls: number;
  };
};

function agentHeaders() {
  return {
    "Content-Type": "application/json",
    ...(process.env.STUDIO_API_TOKEN?.trim()
      ? { Authorization: `Bearer ${process.env.STUDIO_API_TOKEN.trim()}` }
      : {}),
  };
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function cancelJob(baseUrl: string, jobId: string) {
  await fetch(`${baseUrl}/api/chat/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: "POST",
    headers: agentHeaders(),
  }).catch(() => undefined);
}

async function waitForJob(
  baseUrl: string,
  jobId: string,
  signal: AbortSignal,
  writeQueue: (status: string, position: number) => void,
) {
  const started = Date.now();
  while (Date.now() - started < 280_000) {
    if (signal.aborted) break;
    const response = await fetch(`${baseUrl}/api/chat/jobs/${encodeURIComponent(jobId)}`, {
      headers: agentHeaders(),
      signal,
    });
    const job = (await response.json()) as ChatPayload;
    if (!response.ok) {
      throw new Error(job.detail || job.error || `Python backend: HTTP ${response.status}`);
    }
    writeQueue(job.status ?? "queued", job.position ?? 0);
    if (job.status === "done") {
      if (!job.result) throw new Error("Очередь закрыла ход без программы.");
      return job.result;
    }
    if (job.status === "cancelled") throw new Error("Ход остановлен.");
    if (job.status === "error") throw new Error(job.error || "Ход в очереди не собрался.");
    await sleep(800, signal);
  }
  throw new Error("Шлюз не ответил за отведённое время. Каркас на месте, шаг можно повторить.");
}

async function pythonChatResponse(options: {
  baseUrl: string;
  messages: UIMessage[];
  course: CourseDocument;
  userTexts: string[];
  extraReferences?: string;
  formBrief?: Partial<CourseBrief>;
  signal: AbortSignal;
}) {
  const stream = createUIMessageStream({
    originalMessages: options.messages,
    execute: async ({ writer }) => {
      const response = await fetch(`${options.baseUrl}/api/chat/turn`, {
        method: "POST",
        headers: agentHeaders(),
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
        signal: options.signal,
      });
      let payload = (await response.json()) as ChatPayload;
      if (response.status === 202 && payload.jobId) {
        const jobId = payload.jobId;
        const writeQueue = (status: string, position: number) => {
          writer.write({
            type: "data-queue",
            data: { status, position },
          });
        };
        writeQueue(payload.status ?? "queued", payload.position ?? 1);
        try {
          payload = await waitForJob(options.baseUrl, jobId, options.signal, writeQueue);
        } catch (error) {
          await cancelJob(options.baseUrl, jobId);
          throw error;
        }
      } else if (!response.ok) {
        throw new Error(payload.detail || `Python backend: HTTP ${response.status}`);
      }

      if (payload.usage) {
        writer.write({
          type: "message-metadata",
          messageMetadata: {
            usage: payload.usage,
          },
        });
      }
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
  const deadline = AbortSignal.timeout(290_000);
  const signal = req.signal
    ? AbortSignal.any([req.signal, deadline])
    : deadline;

  try {
    return await pythonChatResponse({
      baseUrl: pythonUrl,
      messages,
      course,
      userTexts,
      extraReferences: body.extraReferences,
      formBrief,
      signal,
    });
  } catch (error) {
    console.error("[chat] ошибка маршрута:", error);
    return Response.json(
      { error: chatFailureText(error) },
      { status: 500 },
    );
  }
}
