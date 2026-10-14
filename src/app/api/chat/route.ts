import { convertToModelMessages, streamText, type UIMessage } from "ai";
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
    return Response.json({ error: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ JSON Р·Р°РїСЂРѕСЃР°" }, { status: 400 });
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
    const turn = createTurn({ course, userTexts, extraReferences: body.extraReferences, formBrief });
    const history = sanitizeMessagesForCloudRu(messages);
    console.log(`[chat] СЂРµР¶РёРј ${turn.mode}, СЂРµРїР»РёРє ${userTexts.length}, СЃРѕРѕР±С‰РµРЅРёР№ ${history.length}`);

    const result = streamText({
      model: getLanguageModel("writer"),
      system: turn.system,
      messages: await convertToModelMessages(history, { tools: turn.tools }),
      tools: turn.tools,
      stopWhen: turn.stopWhen,
      prepareStep: turn.prepareStep,
      onError: ({ error }) => {
        console.error("[chat] РѕС€РёР±РєР° РјРѕРґРµР»Рё:", error);
        void appendServerLog({ text: describeError(error), mode: turn.mode, steps: turn.planned });
      },
      onFinish: ({ steps }) => {
        const failed = toolErrors(steps);
        void appendServerLog({
          text: `РҐРѕРґ Р·Р°РІРµСЂС€С‘РЅ: ${steps.length} С€Р°РіРѕРІ`,
          mode: turn.mode,
          steps: turn.planned,
          toolErrors: failed.length ? failed : undefined,
        });
      },
    });

    return result.toUIMessageStreamResponse({
      onError: (error) =>
        error instanceof Error ? error.message : "РќРµ СѓРґР°Р»РѕСЃСЊ СЃРіРµРЅРµСЂРёСЂРѕРІР°С‚СЊ РєСѓСЂСЃ",
    });
  } catch (error) {
    console.error("[chat] РѕС€РёР±РєР° РјР°СЂС€СЂСѓС‚Р°:", error);
    const message = error instanceof Error ? error.message : "РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕРґРєР»СЋС‡РёС‚СЊ РјРѕРґРµР»СЊ";
    return Response.json({ error: message }, { status: 500 });
  }
}
