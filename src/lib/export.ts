import {
  BLOOM_LABELS,
  FORMAT_LABELS,
  LEVEL_LABELS,
  QUESTION_LABELS,
  type CourseDocument,
  type Lecture,
} from "@/lib/course-schema";
import { auditCourse, type OpenCaseId } from "@/lib/course-audit";

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function slug(title: string) {
  const base = title.trim() || "course";
  return base.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 60);
}

export function exportCourseJson(course: CourseDocument) {
  download(
    `${slug(course.brief.title)}.json`,
    JSON.stringify(course, null, 2),
    "application/json",
  );
}

export function exportCourseAudit(course: CourseDocument, caseId?: OpenCaseId) {
  download(
    `${slug(course.brief.title)}-audit.json`,
    JSON.stringify(auditCourse(course, caseId), null, 2),
    "application/json",
  );
}

export function courseToMarkdown(course: CourseDocument): string {
  const { brief } = course;
  const lines: string[] = [];
  lines.push(`# ${brief.title || "Без названия"}`);
  lines.push("");
  lines.push(`- Аудитория: ${brief.audience || "—"}`);
  lines.push(`- Уровень: ${LEVEL_LABELS[brief.level]}`);
  lines.push(`- Объём: ${brief.durationHours || "—"} ч`);
  lines.push(`- Формат: ${FORMAT_LABELS[brief.format]}`);
  lines.push("");
  lines.push("## Цели");
  lines.push(...(brief.goals.length ? brief.goals.map((item) => `- ${item}`) : ["- —"]));
  lines.push("");
  lines.push("## Ограничения");
  lines.push(
    ...(brief.constraints.length ? brief.constraints.map((item) => `- ${item}`) : ["- —"]),
  );
  lines.push("");
  lines.push("## Референсы");
  if (brief.references.length === 0) lines.push("- —");
  for (const ref of brief.references) {
    lines.push(`- ${ref.title}${ref.source ? ` (${ref.source})` : ""}${ref.note ? ` — ${ref.note}` : ""}`);
  }
  lines.push("");
  lines.push("## Карта компетенций");
  for (const node of course.competencies.nodes) {
    lines.push(
      `- **${node.id}. ${node.name}** (${BLOOM_LABELS[node.bloomLevel]}) — модули: ${node.moduleIds.join(", ")}${node.description ? `. ${node.description}` : ""}`,
    );
  }
  if (course.competencies.edges.length) {
    lines.push("");
    lines.push("Связи:");
    for (const edge of course.competencies.edges) {
      lines.push(`- ${edge.from} → ${edge.to}`);
    }
  }
  lines.push("");
  lines.push("## Структура");
  for (const courseModule of course.modules) {
    lines.push(`### ${courseModule.id}. ${courseModule.title} (${courseModule.hours} ч)`);
    lines.push("Темы:");
    lines.push(...courseModule.topics.map((topic) => `- ${topic}`));
    lines.push("Результаты:");
    lines.push(...courseModule.learningOutcomes.map((item) => `- ${item}`));
    lines.push(`Компетенции: ${courseModule.competencyIds.join(", ")}`);
    lines.push("");
  }

  lines.push("## Лекции");
  for (const lecture of course.lectures) {
    const courseModule = course.modules.find((item) => item.id === lecture.moduleId);
    lines.push(`### Лекция: ${courseModule?.title ?? lecture.moduleId} (${lecture.durationMin} мин)`);
    lines.push("План:");
    lines.push(...lecture.outline.map((item) => `- ${item}`));
    lines.push("");
    lecture.slides.forEach((slide, index) => {
      lines.push(`#### Слайд ${index + 1}. ${slide.title}`);
      lines.push(...slide.bullets.map((item) => `- ${item}`));
      if (slide.mermaid) {
        lines.push("");
        lines.push("```mermaid");
        lines.push(slide.mermaid);
        lines.push("```");
      }
      if (slide.visualPrompt) lines.push(`Визуал: ${slide.visualPrompt}`);
      if (slide.speakerNotes) lines.push(`Заметки: ${slide.speakerNotes}`);
      lines.push("");
    });
  }

  lines.push("## Семинары");
  for (const seminar of course.seminars) {
    const courseModule = course.modules.find((item) => item.id === seminar.moduleId);
    lines.push(`### ${courseModule?.title ?? seminar.moduleId}`);
    for (const task of seminar.tasks) {
      lines.push(`#### ${task.title} (${task.timeMin} мин, ${task.competencyId})`);
      if (task.learningOutcome) lines.push(`Результат обучения: ${task.learningOutcome}`);
      lines.push(task.prompt);
      lines.push("Шаги:");
      lines.push(...task.steps.map((item, index) => `${index + 1}. ${item}`));
      lines.push("Критерии:");
      lines.push(...task.criteria.map((item) => `- ${item}`));
      lines.push("");
    }
  }

  lines.push("## Тесты");
  for (const assessment of course.assessments) {
    const courseModule = course.modules.find((item) => item.id === assessment.moduleId);
    lines.push(`### ${courseModule?.title ?? assessment.moduleId}`);
    assessment.questions.forEach((question, index) => {
      lines.push(`**${index + 1}. [${QUESTION_LABELS[question.type]}] ${question.stem}**`);
      if (question.options?.length) {
        lines.push(...question.options.map((option) => `- ${option}`));
      }
      lines.push(`Ответ: ${question.answer}`);
      lines.push(`Пояснение: ${question.explanation}`);
      lines.push(`Компетенция: ${question.competencyId}`);
      if (question.learningOutcome) lines.push(`Результат обучения: ${question.learningOutcome}`);
      lines.push("");
    });
  }

  return lines.join("\n");
}

export function exportCourseMarkdown(course: CourseDocument) {
  download(
    `${slug(course.brief.title)}.md`,
    courseToMarkdown(course),
    "text/markdown;charset=utf-8",
  );
}

function lecturesHtml(course: CourseDocument, lectures: Lecture[]) {
  const nav = lectures
    .map((lecture) => {
      const courseModule = course.modules.find((item) => item.id === lecture.moduleId);
      const title = courseModule?.title ?? lecture.moduleId;
      return `<a href="#${escapeHtml(lecture.moduleId)}-1">${escapeHtml(title)}</a>`;
    })
    .join("");

  const slides = lectures
    .map((lecture) => {
      const courseModule = course.modules.find((item) => item.id === lecture.moduleId);
      const title = courseModule?.title ?? lecture.moduleId;
      return lecture.slides
        .map(
          (slide, index) => `
<section class="slide" id="${escapeHtml(lecture.moduleId)}-${index + 1}">
  <p class="kicker">${escapeHtml(title)} · ${index + 1}/${lecture.slides.length}</p>
  <h1>${escapeHtml(slide.title)}</h1>
  <ul>${slide.bullets.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
  ${slide.mermaid ? `<pre class="mermaid">${escapeHtml(slide.mermaid)}</pre>` : ""}
  ${slide.visualPrompt ? `<p class="visual">${escapeHtml(slide.visualPrompt)}</p>` : ""}
  ${slide.speakerNotes ? `<aside class="notes">${escapeHtml(slide.speakerNotes)}</aside>` : ""}
</section>`,
        )
        .join("\n");
    })
    .join("\n");

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(course.brief.title || "Слайды")} — лекции</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; font-family: Georgia, "Times New Roman", serif; background: #1a2744; color: #1a2744; }
    .toc { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; gap: 8px; padding: 12px 10vw; background: #141c2e; }
    .toc a { color: #f4efe6; font-family: "Segoe UI", sans-serif; font-size: 13px; text-decoration: none; border-bottom: 1px solid transparent; }
    .toc a:hover { border-bottom-color: #e2b39a; }
    .slide { min-height: 100vh; box-sizing: border-box; padding: 8vh 10vw; background: #f4efe6; border-bottom: 1px solid #d9d0c3; scroll-snap-align: start; }
    html { scroll-snap-type: y mandatory; }
    .kicker { font-family: "Segoe UI", sans-serif; letter-spacing: 0.08em; text-transform: uppercase; font-size: 13px; color: #b85c38; }
    h1 { font-size: 42px; line-height: 1.15; margin: 0 0 24px; }
    ul { font-size: 22px; line-height: 1.45; }
    .mermaid { background: #fffdf8; border: 1px solid #d9d0c3; padding: 12px; overflow: auto; }
    .visual, .notes { font-family: "Segoe UI", sans-serif; color: #5c564c; }
    .notes { font-size: 14px; border-top: 1px solid #d9d0c3; padding-top: 16px; }
  </style>
</head>
<body>
<nav class="toc">${nav}</nav>
${slides}
<script type="module">
  const slides = [...document.querySelectorAll(".slide")];
  const go = (dir) => {
    const current = slides.findIndex((slide) => {
      const top = slide.getBoundingClientRect().top;
      return top >= -8 && top < window.innerHeight * 0.45;
    });
    const index = current < 0 ? 0 : current;
    slides[Math.min(slides.length - 1, Math.max(0, index + dir))]?.scrollIntoView({ behavior: "smooth" });
  };
  window.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") {
      event.preventDefault();
      go(1);
    }
    if (event.key === "ArrowLeft" || event.key === "PageUp") {
      event.preventDefault();
      go(-1);
    }
  });
  if (document.querySelector(".mermaid")) {
    try {
      const mermaid = (await import("https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs")).default;
      mermaid.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "loose" });
      await mermaid.run({ querySelector: ".mermaid" });
    } catch {}
  }
</script>
</body>
</html>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function courseLecturesHtml(course: CourseDocument, moduleId?: string) {
  const lectures = moduleId
    ? course.lectures.filter((item) => item.moduleId === moduleId)
    : course.lectures;
  if (lectures.length === 0) return "";
  return lecturesHtml(course, lectures);
}

export function exportLectureHtml(course: CourseDocument, moduleId?: string) {
  const html = courseLecturesHtml(course, moduleId);
  if (!html) return;
  const lectures = moduleId
    ? course.lectures.filter((item) => item.moduleId === moduleId)
    : course.lectures;
  const suffix =
    lectures.length === 1
      ? slug(
          course.modules.find((item) => item.id === lectures[0].moduleId)?.title ??
            lectures[0].moduleId,
        )
      : "slides";
  download(`${slug(course.brief.title)}-${suffix}.html`, html, "text/html;charset=utf-8");
}

export function structureMermaid(course: CourseDocument): string {
  if (course.modules.length === 0) return "";
  const nodes = course.modules
    .map((module) => `  ${module.id}["${module.title} · ${module.hours} ч"]`)
    .join("\n");
  const edges = course.modules
    .slice(0, -1)
    .map((module, index) => `  ${module.id} --> ${course.modules[index + 1].id}`)
    .join("\n");
  return `flowchart TD\n${nodes}\n${edges}`;
}
