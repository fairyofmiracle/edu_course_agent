import { z } from "zod";

export const bloomLevelSchema = z.enum([
  "remember",
  "understand",
  "apply",
  "analyze",
  "evaluate",
  "create",
]);

export const courseLevelSchema = z.enum(["beginner", "intermediate", "advanced"]);
export const courseFormatSchema = z.enum(["lecture", "blended", "workshop"]);
export const programKindSchema = z.enum(["unset", "general", "qualification"]);
export const questionTypeSchema = z.enum(["mcq", "open"]);

function absent<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (value === null ? undefined : value), schema);
}

export const referenceSchema = z.object({
  title: z.string().min(1).max(200),
  source: absent(z.string().max(500).optional()),
  note: absent(z.string().max(1500).optional()),
  /** confirmed — принят / авто; unconfirmed — на проверке; source_attached — синоним confirmed */
  status: absent(z.enum(["confirmed", "unconfirmed", "source_attached"]).optional()),
});

export const briefSchema = z.object({
  title: z.string().max(180).default(""),
  audience: z.string().max(400).default(""),
  level: courseLevelSchema.default("intermediate"),
  durationHours: z.number().min(0).default(0),
  format: courseFormatSchema.default("blended"),
  formatNamed: z.boolean().default(false),
  programKind: programKindSchema.default("unset"),
  attestationHours: z.number().min(0).max(80).default(0),
  attestationForm: z.string().max(180).default(""),
  goals: z.array(z.string().min(1).max(300)).max(12).default([]),
  constraints: z.array(z.string().min(1).max(300)).max(12).default([]),
  references: z.array(referenceSchema).max(20).default([]),
});

export const competencyNodeSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(180),
  bloomLevel: bloomLevelSchema,
  moduleIds: z.array(z.string().min(1).max(40)).max(24),
  description: absent(z.string().max(400).optional()),
  knowledge: z.array(z.string().min(1).max(240)).max(8).default([]),
  skills: z.array(z.string().min(1).max(240)).max(8).default([]),
  abilities: z.array(z.string().min(1).max(240)).max(8).default([]),
  laborFunctionCode: absent(z.string().max(40).optional()),
});

export const competencyEdgeSchema = z.object({
  from: z.string().min(1).max(40),
  to: z.string().min(1).max(40),
});

export const competencyMapSchema = z.object({
  nodes: z.array(competencyNodeSchema).max(40),
  edges: z.array(competencyEdgeSchema).max(80),
});

export const topicPlanSchema = z.object({
  title: z.string().min(1).max(200),
  lectureHours: z.number().min(0).default(0),
  practiceHours: z.number().min(0).default(0),
  labHours: z.number().min(0).default(0),
  selfStudyHours: z.number().min(0).default(0),
});

export const moduleSchema = z.object({
  id: z.string().min(1).max(40),
  title: z.string().min(1).max(180),
  hours: z.number().min(0.5),
  lectureHours: z.number().min(0).default(0),
  practiceHours: z.number().min(0).default(0),
  labHours: z.number().min(0).default(0),
  selfStudyHours: z.number().min(0).default(0),
  topics: z.array(z.string().min(1).max(200)).min(1).max(20),
  plan: z.array(topicPlanSchema).max(20).default([]),
  learningOutcomes: z.array(z.string().min(1).max(300)).min(1).max(12),
  competencyIds: z.array(z.string().min(1).max(40)).max(12).default([]),
});

export const slideSchema = z.object({
  title: z.string().min(1).max(140),
  bullets: z.array(z.string().min(1).max(280)).min(2).max(6),
  mermaid: absent(z.string().max(1500).optional()),
  visualPrompt: absent(z.string().max(280).optional()),
  speakerNotes: absent(z.string().max(600).optional()),
  table: absent(z.array(z.array(z.string().min(1).max(80)).min(1).max(8)).min(2).max(8).optional()),
});

export const lectureSchema = z.object({
  moduleId: z.string().min(1).max(40),
  durationMin: z.number().min(15).max(240),
  outline: z.array(z.string().min(1).max(240)).min(3).max(10),
  slides: z.array(slideSchema).min(3).max(12),
});

export const seminarTaskSchema = z.object({
  title: z.string().min(1).max(180),
  prompt: z.string().min(1).max(1200),
  steps: z.array(z.string().min(1).max(280)).min(2).max(8),
  timeMin: z.number().min(10).max(180),
  criteria: z.array(z.string().min(1).max(240)).min(2).max(6),
  competencyId: z.string().min(1).max(40),
  learningOutcome: absent(z.string().max(300).optional()),
});

export const seminarSchema = z.object({
  moduleId: z.string().min(1).max(40),
  tasks: z.array(seminarTaskSchema).min(1).max(4),
});

export const questionSchema = z.object({
  type: questionTypeSchema,
  stem: z.string().min(1).max(500),
  options: absent(z.array(z.string().min(1).max(240)).max(6).optional()),
  answer: z.string().min(1).max(600),
  explanation: z.string().min(1).max(600),
  competencyId: z.string().min(1).max(40),
  learningOutcome: z.string().min(1).max(300),
});

export const assessmentSchema = z.object({
  moduleId: z.string().min(1).max(40),
  questions: z.array(questionSchema).min(4).max(10),
});

export const courseDocumentSchema = z.object({
  id: z.string().min(1),
  updatedAt: z.string().min(1),
  brief: briefSchema,
  competencies: competencyMapSchema,
  modules: z.array(moduleSchema).max(24),
  lectures: z.array(lectureSchema).max(24),
  seminars: z.array(seminarSchema).max(24),
  assessments: z.array(assessmentSchema).max(24),
  frameworkApproved: z.boolean().default(false),
  frameworkFingerprint: z.string().max(12000).default(""),
});

export type BloomLevel = z.infer<typeof bloomLevelSchema>;
export type CourseLevel = z.infer<typeof courseLevelSchema>;
export type CourseFormat = z.infer<typeof courseFormatSchema>;
export type CourseBrief = z.infer<typeof briefSchema>;
export type CompetencyMap = z.infer<typeof competencyMapSchema>;
export type CourseModule = z.infer<typeof moduleSchema>;
export type Lecture = z.infer<typeof lectureSchema>;
export type Seminar = z.infer<typeof seminarSchema>;
export type Assessment = z.infer<typeof assessmentSchema>;
export type CourseDocument = z.infer<typeof courseDocumentSchema>;
export type Slide = z.infer<typeof slideSchema>;

export const BLOOM_LABELS: Record<BloomLevel, string> = {
  remember: "Знать",
  understand: "Понимать",
  apply: "Применять",
  analyze: "Анализировать",
  evaluate: "Оценивать",
  create: "Создавать",
};

export const LEVEL_LABELS: Record<CourseLevel, string> = {
  beginner: "Начальный",
  intermediate: "Средний",
  advanced: "Продвинутый",
};

export const QUESTION_LABELS: Record<"mcq" | "open", string> = {
  mcq: "Выбор",
  open: "Открытый",
};

export const FORMAT_LABELS: Record<CourseFormat, string> = {
  lecture: "Лекции",
  blended: "Смешанный",
  workshop: "Практикум",
};

export const PROGRAM_KIND_LABELS: Record<
  z.infer<typeof programKindSchema>,
  string
> = {
  unset: "Шаблон не выбран",
  general: "Общеразвивающая",
  qualification: "Повышение квалификации",
};

export function createEmptyCourse(): CourseDocument {
  return {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `course-${Date.now()}`,
    updatedAt: new Date().toISOString(),
    brief: {
      title: "",
      audience: "",
      level: "intermediate",
      durationHours: 0,
      format: "blended",
      formatNamed: false,
      programKind: "unset",
      attestationHours: 0,
      attestationForm: "",
      goals: [],
      constraints: [],
      references: [],
    },
    competencies: { nodes: [], edges: [] },
    modules: [],
    lectures: [],
    seminars: [],
    assessments: [],
    frameworkApproved: false,
    frameworkFingerprint: "",
  };
}


/** Подпись в UI, когда название ещё не задали. В документ не пишем. */
export const DEFAULT_COURSE_TITLE = "Новая программа";

export function isBlankCourseTitle(title: string | undefined | null): boolean {
  const t = (title ?? "").trim();
  return !t || t === DEFAULT_COURSE_TITLE;
}

export function displayCourseTitle(title: string | undefined | null): string {
  const t = (title ?? "").trim();
  return t || DEFAULT_COURSE_TITLE;
}

export function isCourseEmpty(course: CourseDocument): boolean {
  return (
    isBlankCourseTitle(course.brief.title) &&
    !course.brief.audience.trim() &&
    !(course.brief.durationHours > 0) &&
    course.brief.goals.length === 0 &&
    course.modules.length === 0 &&
    course.competencies.nodes.length === 0 &&
    course.lectures.length === 0 &&
    course.seminars.length === 0 &&
    course.assessments.length === 0
  );
}

export function courseCompleteness(course: CourseDocument) {
  const moduleCount = Math.max(course.modules.length, 1);
  const checks = {
    brief: Boolean(course.brief.title && course.brief.audience),
    competencies: course.competencies.nodes.length > 0,
    structure: course.modules.length > 0,
    lectures: course.lectures.length / moduleCount,
    seminars: course.seminars.length / moduleCount,
    assessments: course.assessments.length / moduleCount,
  };
  const score =
    (Number(checks.brief) +
      Number(checks.competencies) +
      Number(checks.structure) +
      Math.min(1, checks.lectures) +
      Math.min(1, checks.seminars) +
      Math.min(1, checks.assessments)) /
    6;
  return { ...checks, score };
}
