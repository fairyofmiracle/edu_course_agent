import type { CourseDocument } from "@/lib/course-schema";

export function filledBriefLines(course: CourseDocument) {
  const { brief } = course;
  const lines: string[] = [];
  if (brief.title.trim()) lines.push(`название: ${brief.title}`);
  if (brief.audience.trim()) lines.push(`аудитория: ${brief.audience}`);
  if (brief.durationHours > 0) lines.push(`объём: ${brief.durationHours} ч`);
  if (brief.programKind !== "unset") lines.push(`шаблон: ${brief.programKind}`);
  if (brief.goals.length) lines.push(`цели: ${brief.goals.join("; ")}`);
  if (brief.attestationForm.trim()) {
    lines.push(
      `аттестация: ${brief.attestationForm}${brief.attestationHours ? `, ${brief.attestationHours} ч` : ""}`,
    );
  }
  if (brief.level) lines.push(`уровень: ${brief.level}`);
  return lines;
}

export function missingBriefLines(course: CourseDocument) {
  const { brief } = course;
  const missing: string[] = [];
  if (!brief.audience.trim()) missing.push("аудитория");
  if (!brief.durationHours) missing.push("объём в часах");
  if (!brief.goals.length) missing.push("цель");
  if (brief.programKind === "unset") missing.push("тип программы (general или qualification)");
  return missing;
}

export function briefStatusBlock(course: CourseDocument, userTurns: number) {
  const known = filledBriefLines(course);
  const missing = missingBriefLines(course);
  const mustBuild =
    missing.length === 0 ||
    (userTurns >= 2 && Boolean(course.brief.audience.trim() || course.brief.goals.length));

  return [
    "Сводка брифа (не переспрашивай то, что уже есть):",
    known.length ? `Уже известно: ${known.join(" · ")}` : "Уже известно: ничего, это первый заход.",
    missing.length ? `Ещё нет: ${missing.join(", ")}.` : "Ещё нет: ничего критичного.",
    `Реплик методиста в этой сессии: ${userTurns}.`,
    mustBuild
      ? "Дальше нельзя задавать вопросы. Сразу set_competency_map и set_structure. Часы выровняет сервер."
      : "Если чего-то нет — задай ОДНИМ сообщением все недостающие вопросы, максимум пять. Потом остановись.",
  ].join("\n");
}
