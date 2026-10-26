"use client";

import { useEffect, useState } from "react";
import { CompetencyMap } from "@/components/CompetencyMap";
import { SourceChecks } from "@/components/SourceChecks";
import { StackFreshnessPanel } from "@/components/StackFreshness";
import { LectureDeck } from "@/components/LectureDeck";
import { MermaidBlock } from "@/components/MermaidBlock";
import { NavIcon } from "@/components/NavIcon";
import { auditCourse, type AuditStatus } from "@/lib/course-audit";
import { isHttpSource } from "@/lib/verbatim";
import { exportAssessmentDocx, exportSeminarDocx } from "@/lib/export-docx";
import { briefGaps, moduleKindsGap, programBalanceNote, validateCourseHours } from "@/lib/course-validation";
import { moduleFlowChart } from "@/lib/presentation/course-to-presentation";
import { calendarPace } from "@/lib/week-plan";
import { contentGaps, frameworkItems, hasBuiltMaterials, isFrameworkApproved, outcomeGaps } from "@/lib/framework-check";
import {
  BLOOM_LABELS,
  FORMAT_LABELS,
  LEVEL_LABELS,
  PROGRAM_KIND_LABELS,
  QUESTION_LABELS,
  type CourseDocument,
} from "@/lib/course-schema";

export type WorkspaceTab =
  | "overview"
  | "structure"
  | "competencies"
  | "lectures"
  | "seminars"
  | "tests"
  | "checks";

const CONTENT_TABS: WorkspaceTab[] = ["lectures", "seminars", "tests"];

const WORKSPACE_TABS: { id: WorkspaceTab; label: string; hint: string; icon: "overview" | "plan" | "competencies" | "lectures" | "seminars" | "tests" | "checks" }[] = [
  { id: "overview", label: "Обзор", hint: "Шаблон, аудитория и проверка часов. Каркас утверждают здесь.", icon: "overview" },
  { id: "structure", label: "План", hint: "Модули и разбивка часов по неделям. Календарные даты сюда не ставятся.", icon: "plan" },
  { id: "competencies", label: "Компетенции", hint: "Чему научатся: знания, умения и навыки по каждой компетенции.", icon: "competencies" },
  { id: "lectures", label: "Лекции", hint: "Черновик модели. Штамп паспорта от формулировок слайдов не зависит.", icon: "lectures" },
  { id: "seminars", label: "Семинары", hint: "Файлы заданий: открыть просмотр или скачать.", icon: "seminars" },
  { id: "tests", label: "Тесты", hint: "Файлы проверки: открыть просмотр или скачать.", icon: "tests" },
  { id: "checks", label: "Проверка", hint: "Часы, связи, комплект, источники и оценивание каждого результата.", icon: "checks" },
];

type CourseWorkspaceProps = {
  course: CourseDocument;
  tab: WorkspaceTab;
};

export function CourseTabs({
  tab,
  approved,
  onTabChange,
}: {
  tab: WorkspaceTab;
  approved: boolean;
  onTabChange: (tab: WorkspaceTab) => void;
}) {
  const tabs = WORKSPACE_TABS.filter((item) => approved || !CONTENT_TABS.includes(item.id));
  return (
    <nav className="nav-sections" aria-label="Разделы курса">
      {tabs.map((item) => (
        <button
          key={item.id}
          type="button"
          className={["journal-tab", tab === item.id ? "active" : ""].filter(Boolean).join(" ")}
          title={item.hint}
          onClick={() => onTabChange(item.id)}
        >
          <NavIcon name={item.icon} />
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

export function CourseWorkspace({ course, tab }: CourseWorkspaceProps) {
  const contentOpen = isFrameworkApproved(course) || hasBuiltMaterials(course);
  const locked = CONTENT_TABS.includes(tab) && !contentOpen;

  return (
    <section className="workspace">
      <div className="workspace-body">
        {locked ? (
          <LockedContentState />
        ) : (
          <>
            {tab === "overview" ? <Overview course={course} /> : null}
            {tab === "structure" ? <Structure course={course} /> : null}
            {tab === "competencies" ? <CompetencyMap course={course} /> : null}
            {tab === "lectures" ? <LectureDeck course={course} /> : null}
            {tab === "seminars" ? <Seminars course={course} /> : null}
            {tab === "tests" ? <Tests course={course} /> : null}
            {tab === "checks" ? <AuditPanel course={course} /> : null}
          </>
        )}
      </div>
    </section>
  );
}

function LockedContentState() {
  return (
    <div className="hero-empty compact">
      <h2>Сначала утвердите каркас</h2>
    </div>
  );
}

function AuditPanel({ course }: { course: CourseDocument }) {
  const report = auditCourse(course);
  const groups: { status: AuditStatus; title: string }[] = [
    { status: "fail", title: "Не выполнено" },
    { status: "warning", title: "Вручную" },
    { status: "pass", title: "Пройдено" },
  ];
  return (
    <div className="audit">
      <div className="audit-counts">
        {groups.map((group) => (
          <p key={group.status} className={`audit-count ${group.status}`}>
            <strong>{report.summary[group.status]}</strong>
            <span>{group.title}</span>
          </p>
        ))}
      </div>
      {groups.map((group) => {
        const items = report.items.filter((entry) => entry.status === group.status);
        if (items.length === 0 || group.status === "pass") return null;
        return (
          <section key={group.status} className="audit-group">
            {items.map((entry) => (
              <article key={entry.id} className={`audit-card ${entry.status}`}>
                <h3>{entry.label}</h3>
                {entry.details ? <span>{entry.details}</span> : null}
              </article>
            ))}
          </section>
        );
      })}
      <details className="audit-passed">
        <summary>Пройдено: {report.summary.pass}</summary>
        {report.items
          .filter((entry) => entry.status === "pass")
          .map((entry) => (
            <p key={entry.id}>{entry.label}</p>
          ))}
      </details>
      <SourceChecks course={course} />
      <StackFreshnessPanel course={course} />
    </div>
  );
}

function FrameworkCheck({ course }: { course: CourseDocument }) {
  const items = frameworkItems(course);
  const gaps = contentGaps(course);
  const hourErrors = validateCourseHours(course);
  return (
    <article>
      <h3>Проверка каркаса</h3>
      <ul className="check-list">
        {items.map((item) => (
          <li key={item.id} className={item.ok ? "ok" : "bad"}>
            {item.label}
          </li>
        ))}
      </ul>
      {course.assessments.length > 0 && gaps.length > 0 ? (
        <p className="voice-error">
          Вопросы не закрывают компетенции: {gaps.join(", ")}
        </p>
      ) : null}
      {course.assessments.length > 0 && outcomeGaps(course).length > 0 ? (
        <p className="voice-error">
          Нет вопроса на результат: {outcomeGaps(course).join("; ")}
        </p>
      ) : null}
      {course.brief.durationHours > 0 && course.modules.length > 0 && (
        <div>
          <h4>Проверка учебных часов</h4>

          {hourErrors.length === 0 ? (
            <p className="muted">
              ✓ Баланс учебных часов соблюдён.
            </p>
          ) : (
            <ul className="check-list">
              {hourErrors.map((error, index) => (
                <li key={`${index}-${error}`} className="bad">
                  {error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}


    </article>
  );
}

function kitOf(course: CourseDocument, moduleId: string) {
  return {
    lecture: course.lectures.some((item) => item.moduleId === moduleId && item.slides.length > 0),
    seminar: course.seminars.some((item) => item.moduleId === moduleId && item.tasks.length > 0),
    test: course.assessments.some((item) => item.moduleId === moduleId && item.questions.length > 0),
  };
}

function ModuleBoard({ course }: { course: CourseDocument }) {
  const [moduleId, setModuleId] = useState(course.modules[0]?.id ?? "");
  const selected = course.modules.find((item) => item.id === moduleId) ?? course.modules[0];
  if (!selected) return null;
  const marks = kitOf(course, selected.id);
  const topics = selected.plan.length
    ? selected.plan
    : selected.topics.map((title) => ({
        title,
        lectureHours: 0,
        practiceHours: 0,
        labHours: 0,
        selfStudyHours: 0,
      }));
  return (
    <div className="module-board">
      <div className="module-rail" role="list">
        {course.modules.map((item, index) => {
          const kit = kitOf(course, item.id);
          const gap = moduleKindsGap(item);
          return (
            <button
              key={item.id}
              type="button"
              role="listitem"
              className={[item.id === selected.id ? "active" : "", gap ? "hours-bad" : ""].filter(Boolean).join(" ")}
              title={gap ?? undefined}
              onClick={() => setModuleId(item.id)}
            >
              <span className="mono">{String(index + 1).padStart(2, "0")}</span>
              <strong>{item.title}</strong>
              <span className="hours">{item.hours} ч</span>
              {gap ? <span className="hours-gap">{gap}</span> : null}
              <span className="kit-marks" aria-label="Комплект модуля">
                <i className={kit.lecture ? "on" : ""}>Л</i>
                <i className={kit.seminar ? "on" : ""}>З</i>
                <i className={kit.test ? "on" : ""}>Т</i>
              </span>
            </button>
          );
        })}
      </div>
      <article className="module-detail">
        <p className="kicker">Модуль</p>
        <h3>{selected.title}</h3>
        <p className="muted">
          {selected.hours} ч
          {selected.competencyIds.length
            ? ` · ${selected.competencyIds.map((id) => competencyName(course, id)).join(", ")}`
            : ""}
        </p>
        <span className="kit-marks detail-marks">
          <i className={marks.lecture ? "on" : ""}>Лекция</i>
          <i className={marks.seminar ? "on" : ""}>Задание</i>
          <i className={marks.test ? "on" : ""}>Тест</i>
        </span>
        <h4>Темы</h4>
        <ol className="plan-list">
          {topics.map((topic) => (
            <li key={topic.title}>
              <strong>{topic.title}</strong>
              {selected.plan.length ? <span>{topicHoursLine(topic)}</span> : null}
            </li>
          ))}
        </ol>
        <h4>Результаты</h4>
        <ul>
          {selected.learningOutcomes.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <MermaidBlock chart={moduleFlowChart(selected)} />
      </article>
    </div>
  );
}

function Overview({ course }: { course: CourseDocument }) {
  const { brief } = course;
  const gaps = briefGaps(course);
  return (
    <div className="overview">
      {!brief.title && course.modules.length === 0 && gaps.length > 0 ? (
        <p className="program-soon">Пока нет: {gaps.join(", ")}.</p>
      ) : null}
      <section className="about-card">
        <h2>О программе</h2>
        <p className="about-label">Целевая аудитория</p>
        <p className="about-audience">{brief.audience.trim() || "Аудитория ещё не названа"}</p>
        <dl className="meta-grid">
          <div>
            <dt>Объём</dt>
            <dd>{brief.durationHours ? `${brief.durationHours} ч` : "—"}</dd>
          </div>
          <div>
            <dt>Шаблон</dt>
            <dd>{PROGRAM_KIND_LABELS[brief.programKind]}</dd>
          </div>
          <div>
            <dt>Аттестация</dt>
            <dd>
              {brief.attestationHours ? `${brief.attestationHours} ч` : "0 ч"}
              {brief.attestationForm ? ` · ${brief.attestationForm}` : ""}
            </dd>
          </div>
          <div>
            <dt>Формат</dt>
            <dd>{FORMAT_LABELS[brief.format]}</dd>
          </div>
          <div>
            <dt>Уровень</dt>
            <dd>{LEVEL_LABELS[brief.level]}</dd>
          </div>
        </dl>
      </section>
      {course.modules.length > 0 ? (
        <>
        <table className="hours-table">
          <thead>
            <tr>
              <th>Модуль</th>
              <th>Лекции</th>
              <th>Семинары</th>
              <th>Лабораторные</th>
              <th>Самостоятельно</th>
              <th>Всего</th>
            </tr>
          </thead>
          <tbody>
            {course.modules.map((courseModule) => {
              const gap = moduleKindsGap(courseModule);
              return (
                <tr key={courseModule.id} className={gap ? "hours-bad" : undefined}>
                  <td>
                    {courseModule.title}
                    {gap ? <span className="hours-gap">{gap}</span> : null}
                  </td>
                  <td>{courseModule.lectureHours}</td>
                  <td>{courseModule.practiceHours}</td>
                  <td>{courseModule.labHours}</td>
                  <td>{courseModule.selfStudyHours}</td>
                  <td>{courseModule.hours}</td>
                </tr>
              );
            })}
            <tr className={programBalanceNote(course) ? "hours-bad" : undefined}>
              <td>
                Аттестация
                {programBalanceNote(course) ? (
                  <span className="hours-gap">{programBalanceNote(course)}</span>
                ) : null}
              </td>
              <td />
              <td />
              <td />
              <td />
              <td>{course.brief.attestationHours}</td>
            </tr>
          </tbody>
        </table>
        </>
      ) : null}
      <div className="two-col">
        <article>
          <h3>Цели</h3>
          <ul>
            {brief.goals.length ? brief.goals.map((item) => <li key={item}>{item}</li>) : <li>—</li>}
          </ul>
        </article>
        <article>
          <h3>Ограничения</h3>
          <ul>
            {brief.constraints.length ? (
              brief.constraints.map((item) => <li key={item}>{item}</li>)
            ) : (
              <li>—</li>
            )}
          </ul>
        </article>
      </div>
      <FrameworkCheck course={course} />
      <article>
        <h3>Референсы</h3>
        <ul>
          {brief.references.length ? (
            brief.references.map((item) => (
              <li key={item.title}>
                <strong>{item.title}</strong>
                {item.source ? ` · ${item.source}` : ""}
                {item.note ? ` — ${item.note}` : ""}
                {" · "}
                {item.source?.trim() && !isHttpSource(item.source)
                  ? "файл методиста"
                  : "не подтверждён"}
              </li>
            ))
          ) : (
            <li>—</li>
          )}
        </ul>
      </article>
    </div>
  );
}

function snapHalf(value: number) {
  return Math.round(value * 2) / 2;
}

function weeksOf(
  modules: Array<{ id: string; title: string; hours: number }>,
  perWeek: number,
) {
  const weeks: Array<Array<{ id: string; title: string; hours: number; continued: boolean }>> = [];
  let pieces: Array<{ id: string; title: string; hours: number; continued: boolean }> = [];
  let used = 0;
  const flush = () => {
    if (pieces.length === 0) return;
    weeks.push(pieces);
    pieces = [];
    used = 0;
  };
  for (const module of modules) {
    let left = snapHalf(module.hours);
    let continued = false;
    while (left > 0) {
      const room = snapHalf(perWeek - used);
      if (room <= 0) {
        flush();
        continue;
      }
      const take = snapHalf(Math.min(left, room));
      if (take <= 0) break;
      pieces.push({ id: module.id, title: module.title, hours: take, continued });
      used = snapHalf(used + take);
      left = snapHalf(left - take);
      continued = true;
      if (used >= perWeek) flush();
    }
  }
  flush();
  return weeks;
}

function formatHours(value: number) {
  return String(snapHalf(value)).replace(".", ",");
}

function topicHoursLine(topic: {
  lectureHours: number;
  practiceHours: number;
  labHours: number;
  selfStudyHours: number;
}) {
  const parts = [
    topic.lectureHours > 0 ? `лекция ${formatHours(topic.lectureHours)} ч` : "",
    topic.practiceHours > 0 ? `практика ${formatHours(topic.practiceHours)} ч` : "",
    topic.labHours > 0 ? `лабораторная ${formatHours(topic.labHours)} ч` : "",
    topic.selfStudyHours > 0 ? `самостоятельно ${formatHours(topic.selfStudyHours)} ч` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "часы по видам ещё не разложены";
}

function weekWord(count: number) {
  if (count % 10 === 1 && count % 100 !== 11) return "неделя";
  if (count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14)) return "недели";
  return "недель";
}

function WeekPlan({ course }: { course: CourseDocument }) {
  const total = snapHalf(course.modules.reduce((sum, item) => sum + item.hours, 0));
  const pace = calendarPace(course.brief.constraints, total);
  const [perWeek, setPerWeek] = useState(pace?.perWeek ?? 4);
  useEffect(() => {
    setPerWeek(pace?.perWeek ?? 4);
  }, [course.id, pace?.line, pace?.perWeek]);
  const weeks = weeksOf(course.modules, perWeek);
  const sameAsGraph = pace?.weeks != null && weeks.length === pace.weeks;
  return (
    <section className="week-plan">
      <header className="week-plan-head">
        <div>
          <p className="kicker">По неделям</p>
          <h3>Разбивка часов</h3>
          <p className="muted">
            {pace?.line ? `${pace.line} ` : ""}
            {formatHours(total)} ч
            {sameAsGraph
              ? ` на ${weeks.length} ${weekWord(weeks.length)}, по ${formatHours(perWeek)} ч.`
              : ` · сейчас ${weeks.length} ${weekWord(weeks.length)} по ${formatHours(perWeek)} ч.`}
          </p>
        </div>
        <label>
          Часов в неделю
          <input
            type="number"
            min={0.5}
            max={40}
            step={0.5}
            value={perWeek}
            onChange={(event) => {
              const next = snapHalf(Number(event.target.value));
              if (next >= 0.5 && next <= 40) setPerWeek(next);
            }}
          />
        </label>
      </header>
      <div className="week-board">
        {weeks.map((pieces, index) => (
          <article key={`week-${index}`} className="week-card">
            <p className="kicker">Неделя {index + 1}</p>
            <ul>
              {pieces.map((piece, pieceIndex) => (
                <li key={`${piece.id}-${pieceIndex}`}>
                  <strong>{piece.title}</strong>
                  <span>
                    {piece.continued ? "продолжение, " : ""}
                    {formatHours(piece.hours)} ч
                  </span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}

function Structure({ course }: { course: CourseDocument }) {
  if (course.modules.length === 0) {
    return null;
  }
  return (
    <div className="structure">
      <WeekPlan course={course} />
      <ModuleBoard course={course} />
    </div>
  );
}

function competencyName(course: CourseDocument, id: string) {
  return course.competencies.nodes.find((node) => node.id === id)?.name ?? id;
}

function Seminars({ course }: { course: CourseDocument }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (course.seminars.length === 0) {
    return null;
  }
  return (
    <ul className="file-list">
      {course.seminars.map((seminar) => {
        const courseModule = course.modules.find((item) => item.id === seminar.moduleId);
        const title = courseModule?.title ?? seminar.moduleId;
        const minutes = seminar.tasks.reduce((sum, task) => sum + task.timeMin, 0);
        const open = openId === seminar.moduleId;
        return (
          <li key={seminar.moduleId} className={open ? "open" : ""}>
            <div className="file-row">
              <div>
                <p className="kicker">Семинар</p>
                <strong>{title}</strong>
                <p className="muted">
                  {seminar.tasks.length} {seminar.tasks.length === 1 ? "работа" : "задания"} · {minutes} мин
                </p>
              </div>
              <div className="deck-nav">
                <button type="button" onClick={() => setOpenId(open ? null : seminar.moduleId)}>
                  {open ? "Закрыть" : "Открыть"}
                </button>
                <button type="button" onClick={() => void exportSeminarDocx(course, seminar.moduleId)}>
                  Скачать
                </button>
              </div>
            </div>
            {open ? (
              <article className="plan-sheet file-preview">
                {seminar.tasks.map((task, index) => (
                  <div key={task.title} className="task">
                    <header>
                      <h4>
                        {index + 1}. {task.title}
                      </h4>
                      <span>{task.timeMin} мин</span>
                    </header>
                    <p className="plan-lead">{task.prompt}</p>
                    <p className="muted">
                      Компетенция: {competencyName(course, task.competencyId)}
                      {task.learningOutcome ? ` · результат: ${task.learningOutcome}` : ""}
                    </p>
                    <h5>Ход работы</h5>
                    <ol className="plan-list">
                      {task.steps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                    <h5>Критерии</h5>
                    <ul>
                      {task.criteria.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </article>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function Tests({ course }: { course: CourseDocument }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (course.assessments.length === 0) {
    return null;
  }
  return (
    <ul className="file-list">
      {course.assessments.map((assessment) => {
        const courseModule = course.modules.find((item) => item.id === assessment.moduleId);
        const title = courseModule?.title ?? assessment.moduleId;
        const open = openId === assessment.moduleId;
        return (
          <li key={assessment.moduleId} className={open ? "open" : ""}>
            <div className="file-row">
              <div>
                <p className="kicker">Тест</p>
                <strong>{title}</strong>
                <p className="muted">{assessment.questions.length} вопр.</p>
              </div>
              <div className="deck-nav">
                <button type="button" onClick={() => setOpenId(open ? null : assessment.moduleId)}>
                  {open ? "Закрыть" : "Открыть"}
                </button>
                <button type="button" onClick={() => void exportAssessmentDocx(course, assessment.moduleId)}>
                  Скачать
                </button>
              </div>
            </div>
            {open ? (
              <article className="plan-sheet file-preview">
                {assessment.questions.map((question, index) => (
                  <div key={`${question.stem}-${index}`} className="task">
                    <p className="plan-lead">
                      <span className="qtype">{QUESTION_LABELS[question.type]}</span> {index + 1}. {question.stem}
                    </p>
                    {question.options?.length ? (
                      <ul>
                        {question.options.map((option) => (
                          <li key={option} className={option === question.answer ? "correct" : undefined}>
                            {option === question.answer ? "Ключ. " : ""}
                            {option}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="answer">Ключ: {question.answer}</p>
                    )}
                    <p className="muted">
                      {question.explanation}
                      {question.learningOutcome ? ` · результат: ${question.learningOutcome}` : ""}
                      {" · "}
                      {competencyName(course, question.competencyId)}
                      {" · "}
                      {BLOOM_LABELS[
                        course.competencies.nodes.find((node) => node.id === question.competencyId)?.bloomLevel ??
                          "apply"
                      ]}
                    </p>
                  </div>
                ))}
              </article>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
