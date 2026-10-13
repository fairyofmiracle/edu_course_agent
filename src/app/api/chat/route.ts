import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import { buildSystemPrompt } from "@/lib/agent/prompts";
import { getLanguageModel } from "@/lib/agent/model";
import { createCourseTools } from "@/lib/agent/tools";
import { isFrameworkApproved } from "@/lib/framework-check";
import {
  courseDocumentSchema,
  createEmptyCourse,
  type CourseDocument,
} from "@/lib/course-schema";

export const maxDuration = 120;

export async function POST(req: Request) {
  let body: {
    messages?: UIMessage[];
    course?: CourseDocument;
    extraReferences?: string;
  };

  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Некорректный JSON запроса" }, { status: 400 });
  }

  const parsedCourse = courseDocumentSchema.safeParse(body.course);
  const course = parsedCourse.success ? parsedCourse.data : createEmptyCourse();

  try {
    const tools = createCourseTools(isFrameworkApproved(course));
    const result = streamText({
      model: getLanguageModel(),
      system: buildSystemPrompt(course, body.extraReferences),
      messages: await convertToModelMessages(body.messages ?? [], { tools }),
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
    return Response.json({ error: message }, { status: 500 });
  }
}
