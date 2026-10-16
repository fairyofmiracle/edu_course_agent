import type { CourseDocument } from "@/lib/course-schema";

export type StackHit = {
  id: string;
  label: string;
  status: "supported" | "eol" | "unknown" | "unavailable";
  place: string;
  detail: string;
  source: string;
};

export type StackFreshness =
  | { state: "empty" }
  | { state: "disabled" }
  | { state: "down"; message: string }
  | { state: "ready"; hits: StackHit[] };

const configuredBase = process.env.NEXT_PUBLIC_PYTHON_API_URL?.trim().replace(/\/$/, "") || "";

export function stackTexts(course: CourseDocument) {
  return course.modules
    .flatMap((module) =>
      [module.title, ...module.topics, ...module.plan.map((row) => row.title), ...module.learningOutcomes]
        .filter((text) => text.trim())
        .map((text) => `Модуль «${module.title}»: ${text}`),
    )
    .slice(0, 80);
}

export async function checkStack(
  texts: string[],
  options: { base?: string; fetchImpl?: typeof fetch } = {},
): Promise<StackFreshness> {
  const base = (options.base ?? configuredBase).replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  if (texts.length === 0) return { state: "empty" };
  if (!base) return { state: "disabled" };
  try {
    const response = await fetchImpl(`${base}/api/stack/freshness`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts }),
    });
    if (!response.ok) {
      return {
        state: "down",
        message: `Сервер проверки ответил ${response.status}. Сроки поддержки не подтверждены.`,
      };
    }
    const body = (await response.json()) as { state?: string; hits?: StackHit[] };
    if (body.state === "empty") return { state: "empty" };
    return { state: "ready", hits: body.hits ?? [] };
  } catch {
    return {
      state: "down",
      message: "Сервер проверки не ответил. Сроки поддержки не подтверждены и не заменяются догадкой.",
    };
  }
}
