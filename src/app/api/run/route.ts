import { generateText, type ModelMessage } from "ai";
import { getLanguageModel } from "@/lib/agent/model";
import { contentMissing, foldSteps } from "@/lib/agent/orchestrator";
import { FRAMEWORK_PROMPT, KIT_PROMPT } from "@/lib/agent/service-prompts";
import { createTurn, toolErrors } from "@/lib/agent/turn";
import { appendServerLog, describeError } from "@/lib/server-log";
import { createEmptyCourse, type CourseDocument } from "@/lib/course-schema";
import {
  contentGaps,
  frameworkFingerprint,
  frameworkItems,
  outcomeGaps,
} from "@/lib/framework-check";

export const maxDuration = 800;

type RunBody = {
  /** РўРµРєСЃС‚ Р·Р°РїСЂРѕСЃР° РјРµС‚РѕРґРёСЃС‚Р°. */
  request?: string;
  /** РћС‚РІРµС‚С‹ РјРµС‚РѕРґРёСЃС‚Р° РЅР° СѓС‚РѕС‡РЅСЏСЋС‰РёРµ РІРѕРїСЂРѕСЃС‹, РµСЃР»Рё Р°РіРµРЅС‚ РёС… Р·Р°РґР°СЃС‚. */
  answers?: string;
  /** РўРµРєСЃС‚ Р±Р»Р°РЅРєРѕРІ, РѕР±СЂР°Р·С†РѕРІ Рё РїСЂРѕС„СЃС‚Р°РЅРґР°СЂС‚РѕРІ. */
  references?: string;
  /** РЈС‚РІРµСЂРґРёС‚СЊ РєР°СЂРєР°СЃ Р±РµР· С‡РµР»РѕРІРµРєР°, С‡С‚РѕР±С‹ РїСЂРѕРіРѕРЅ РґРѕС€С‘Р» РґРѕ РєРѕРјРїР»РµРєС‚Р°. РџРѕ СѓРјРѕР»С‡Р°РЅРёСЋ РґР°. */
  autoApprove?: boolean;
};

type TurnLog = {
  user: string;
  assistant: string;
  mode: string;
  steps: string[];
  toolErrors?: string[];
  calls: Array<{ tool: string; input: unknown }>;
};

/**
 * РџСЂРѕРіРѕРЅ Р±РµР· Р±СЂР°СѓР·РµСЂР°: С‚РµРєСЃС‚ Р·Р°РїСЂРѕСЃР° РЅР° РІС…РѕРґ, JSON РїСЂРѕРіСЂР°РјРјС‹ РЅР° РІС‹С…РѕРґ.
 * РџРѕРІС‚РѕСЂСЏРµС‚ РїСѓС‚СЊ РјРµС‚РѕРґРёСЃС‚Р°: Р·Р°РїСЂРѕСЃ в†’ РІРѕРїСЂРѕСЃС‹ в†’ РєР°СЂРєР°СЃ в†’ СѓС‚РІРµСЂР¶РґРµРЅРёРµ в†’ РєРѕРјРїР»РµРєС‚.
 */
export async function POST(req: Request) {
  let body: RunBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "РќРµРєРѕСЂСЂРµРєС‚РЅС‹Р№ JSON Р·Р°РїСЂРѕСЃР°" }, { status: 400 });
  }
  const request = body.request?.trim();
  if (!request) return Response.json({ error: "РќСѓР¶РЅРѕ РїРѕР»Рµ request" }, { status: 400 });

  let course: CourseDocument = createEmptyCourse();
  const messages: ModelMessage[] = [];
  const userTexts: string[] = [];
  const transcript: TurnLog[] = [];

  const turn = async (text: string) => {
    userTexts.push(text);
    messages.push({ role: "user", content: text });
    const setup = createTurn({ course, userTexts: [...userTexts], extraReferences: body.references });
    const result = await generateText({
      model: getLanguageModel("writer"),
      system: setup.system,
      messages,
      tools: setup.tools,
      stopWhen: setup.stopWhen,
      prepareStep: setup.prepareStep,
    });
    const failed = toolErrors(result.steps);
    course = foldSteps(course, result.steps, (tool, reason) =>
      failed.push(`${tool} не лёг в документ: ${reason}`),
    );
    messages.push(...result.response.messages);
    transcript.push({
      user: text,
      assistant: result.text,
      mode: setup.mode,
      steps: setup.planned,
      toolErrors: failed.length ? failed : undefined,
      calls: result.steps.flatMap((step) =>
        step.toolCalls.map((call) => ({ tool: call.toolName, input: call.input })),
      ),
    });
  };

  try {
    await turn(request);
    const askedQuestions = course.modules.length === 0;
    if (askedQuestions && body.answers?.trim()) await turn(body.answers.trim());
    if (course.modules.length === 0) await turn(FRAMEWORK_PROMPT);

    const frameworkOk = frameworkItems(course).every((item) => item.ok);
    let approvedBy: "auto" | null = null;
    if (frameworkOk && body.autoApprove !== false) {
      course = {
        ...course,
        frameworkApproved: true,
        frameworkFingerprint: frameworkFingerprint(course),
      };
      approvedBy = "auto";
      for (let round = 0; round < 4 && contentMissing(course).length > 0; round += 1) {
        await turn(KIT_PROMPT);
      }
    }

    const report = {
      checks: frameworkItems(course),
      competenciesWithoutQuestion: contentGaps(course),
      outcomesWithoutQuestion: outcomeGaps(course),
      modulesWithoutKit: course.modules
        .filter(
          (row) =>
            !course.lectures.some((item) => item.moduleId === row.id) ||
            !course.seminars.some((item) => item.moduleId === row.id) ||
            !course.assessments.some((item) => item.moduleId === row.id),
        )
        .map((row) => row.id),
      askedQuestions,
      approvedBy,
    };
    void appendServerLog({ text: `Прогон /api/run: ${request.slice(0, 120)}`, report });
    return Response.json({ course, report, transcript });
  } catch (error) {
    void appendServerLog({ text: `Прогон /api/run упал: ${describeError(error)}` });
    return Response.json(
      { error: describeError(error), course, transcript },
      { status: 502 },
    );
  }
}
