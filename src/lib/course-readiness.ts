import type { CourseDocument } from "@/lib/course-schema";
import { isFrameworkApproved } from "@/lib/framework-check";
import { auditCourse, type AuditStatus } from "@/lib/course-audit";

export type StageBadge = "ready" | "partial" | "empty";

export type KitCount = { have: number; need: number };

export type CourseReadiness = {
  framework: StageBadge;
  materials: StageBadge;
  checks: AuditStatus | "empty";
  kit: {
    lecture: KitCount;
    seminar: KitCount;
    test: KitCount;
  };
};

function kitCounts(course: CourseDocument): CourseReadiness["kit"] {
  const modules = course.modules ?? [];
  const needLecture = modules.filter((m) => (m.lectureHours ?? 0) > 0).length;
  const needSeminar = modules.length;
  const needTest = modules.length;
  const haveLecture = modules.filter((m) =>
    (course.lectures ?? []).some((l) => l.moduleId === m.id && (l.slides?.length ?? 0) > 0),
  ).length;
  const haveSeminar = modules.filter((m) =>
    (course.seminars ?? []).some((s) => s.moduleId === m.id && (s.tasks?.length ?? 0) > 0),
  ).length;
  const haveTest = modules.filter((m) =>
    (course.assessments ?? []).some((a) => a.moduleId === m.id && (a.questions?.length ?? 0) > 0),
  ).length;
  return {
    lecture: { have: haveLecture, need: needLecture },
    seminar: { have: haveSeminar, need: needSeminar },
    test: { have: haveTest, need: needTest },
  };
}

function materialsBadge(kit: CourseReadiness["kit"]): StageBadge {
  const parts = [kit.lecture, kit.seminar, kit.test];
  const need = parts.reduce((sum, p) => sum + p.need, 0);
  const have = parts.reduce((sum, p) => sum + p.have, 0);
  if (need === 0) return "empty";
  if (have === 0) return "empty";
  if (have >= need) return "ready";
  return "partial";
}

function checksBadge(course: CourseDocument): AuditStatus | "empty" {
  if ((course.modules?.length ?? 0) === 0) return "empty";
  const summary = auditCourse(course).summary;
  if (summary.fail > 0) return "fail";
  if (summary.warning > 0) return "warning";
  if (summary.pass > 0) return "pass";
  return "empty";
}

export function courseReadiness(course: CourseDocument): CourseReadiness {
  const kit = kitCounts(course);
  const framework: StageBadge = isFrameworkApproved(course)
    ? "ready"
    : (course.modules?.length ?? 0) > 0
      ? "partial"
      : "empty";
  return {
    framework,
    materials: materialsBadge(kit),
    checks: checksBadge(course),
    kit,
  };
}

/** Lightweight readiness from a raw course payload (server list / partial JSON). */
export function readinessFromPayload(payload: unknown): CourseReadiness | null {
  if (!payload || typeof payload !== "object") return null;
  try {
    // Prefer full typed path when shape is close enough; fall back to coarse counts.
    const course = payload as CourseDocument;
    if (!course.brief || !Array.isArray(course.modules)) return null;
    return courseReadiness(course);
  } catch {
    return null;
  }
}

export function formatKitLegend(kit: CourseReadiness["kit"]): string {
  const L = `Л ${kit.lecture.have}/${kit.lecture.need}`;
  const Z = `З ${kit.seminar.have}/${kit.seminar.need}`;
  const T = `Т ${kit.test.have}/${kit.test.need}`;
  return `${L} · ${Z} · ${T}`;
}

export const STAGE_LABEL: Record<StageBadge, string> = {
  ready: "готово",
  partial: "в работе",
  empty: "пусто",
};

export const CHECKS_LABEL: Record<AuditStatus | "empty", string> = {
  pass: "ок",
  warning: "вручную",
  fail: "ошибки",
  empty: "пусто",
  disabled: "выкл.",
};
