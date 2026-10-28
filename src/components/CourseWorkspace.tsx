"use client";

import { useCallback, useEffect, useState } from "react";
import { CompetencyMap } from "@/components/CompetencyMap";
import { SourceChecks } from "@/components/SourceChecks";
import { StackFreshnessPanel } from "@/components/StackFreshness";
import { findOutdated } from "@/lib/outdated";
import { LectureDeck } from "@/components/LectureDeck";
import { MermaidBlock } from "@/components/MermaidBlock";
import { auditCourse, type AuditSection, type AuditStatus } from "@/lib/course-audit";
import { isOfficialPublication } from "@/lib/legal-basis";
import { isHttpSource } from "@/lib/verbatim";
import { exportAssessmentDocx, exportSeminarDocx } from "@/lib/export-docx";
import { briefGaps, moduleKindsGap, programBalanceNote } from "@/lib/course-validation";
import { moduleFlowChart } from "@/lib/presentation/course-to-presentation";
import { calendarPace } from "@/lib/week-plan";
import { hasBuiltMaterials, isFrameworkApproved } from "@/lib/framework-check";
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

const WORKSPACE_TABS: { id: WorkspaceTab; label: string; hint: string }[] = [
  { id: "overview", label: "Обзор", hint: "Шаблон, аудитория и таблица часов." },
  { id: "structure", label: "План", hint: "Модули и разбивка часов по неделям. Календарные даты сюда не ставятся." },
  { id: "competencies", label: "Компетенции", hint: "Чему научатся: знания, умения и навыки по каждой компетенции." },
  { id: "lectures", label: "Лекции", hint: "Файлы лекций: открыть просмотр или скачать PPTX." },
  { id: "seminars", label: "Семинары", hint: "Файлы заданий: открыть просмотр или скачать." },
  { id: "tests", label: "Тесты", hint: "Файлы проверки: открыть просмотр или скачать." },
  { id: "checks", label: "Проверка", hint: "Часы, связи, комплект, источники и оценивание каждого результата." },
];

type CourseWorkspaceProps = {
  course: CourseDocument;
  tab: WorkspaceTab;
  frameworkReady?: boolean;
  onApproveFramework?: () => void;
  onGoApprove?: () => void;
  onGatherFramework?: () => void;
  onGatherKit?: () => void;
  onOpenChat?: () => void;
  onRebuildModule?: (moduleId: string, title: string) => void;
  onRefreshOutdated?: (labels: string[]) => void;
  onGoPlan?: () => void;
};

function TabEmpty({
  phrase,
  hint,
  ctaLabel,
  onCta,
}: {
  phrase: string;
  hint?: string;
  ctaLabel?: string;
  onCta?: () => void;
}) {
  return (
    <div className="tab-empty">
      <p className="tab-empty-phrase">{phrase}</p>
      {hint ? <p className="muted">{hint}</p> : null}
      {ctaLabel && onCta ? (
        <button type="button" className="primary tab-empty-cta" onClick={onCta}>
          {ctaLabel}
        </button>
      ) : null}
    </div>
  );
}

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
    <nav className="nav-sections" aria-label="Разделы курса" role="tablist">
      {tabs.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={tab === item.id}
          className={["journal-tab", tab === item.id ? "active" : ""].filter(Boolean).join(" ")}
          title={item.hint}
          onClick={() => onTabChange(item.id)}
        >
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

export function CourseWorkspace({
  course,
  tab,
  frameworkReady = false,
  onApproveFramework,
  onGoApprove,
  onGatherFramework,
  onGatherKit,
  onRebuildModule,
  onRefreshOutdated,
  onOpenChat,
  onGoPlan,
}: CourseWorkspaceProps) {
  const contentOpen = isFrameworkApproved(course) || hasBuiltMaterials(course);
  const locked = CONTENT_TABS.includes(tab) && !contentOpen;
  const gatherFramework = onGatherFramework ?? onOpenChat;
  const gatherKit = onGatherKit ?? onOpenChat;

  return (
    <section className="workspace">
      <div className="workspace-body">
        {locked ? (
          <LockedContentState
            frameworkReady={frameworkReady}
            onApprove={onApproveFramework}
            onGoApprove={onGoApprove}
          />
        ) : (
          <>
            {tab === "overview" ? <Overview course={course} /> : null}
            {tab === "structure" ? (
              course.modules.length === 0 ? (
                <TabEmpty
                  phrase="Модулей ещё нет"
                  hint="Сначала соберите каркас в чате"
                  ctaLabel={gatherFramework ? "Собрать каркас" : undefined}
                  onCta={gatherFramework}
                />
              ) : (
                <Structure course={course} onRebuildModule={onRebuildModule} />
              )
            ) : null}
            {tab === "competencies" ? (
              course.competencies.nodes.length === 0 ? (
                <TabEmpty
                  phrase="Компетенций ещё нет"
                  hint="Сначала соберите каркас в чате"
                  ctaLabel={gatherFramework ? "Собрать каркас" : undefined}
                  onCta={gatherFramework}
                />
              ) : (
                <CompetencyMap course={course} onFixLink={onOpenChat} onGoPlan={onGoPlan} />
              )
            ) : null}
            {tab === "lectures" ? (
              course.lectures.length === 0 ? (
                <TabEmpty
                  phrase="Лекций ещё нет"
                  hint="Соберите комплект после утверждения каркаса"
                  ctaLabel={gatherKit ? "Собрать комплект" : undefined}
                  onCta={gatherKit}
                />
              ) : (
                <LectureDeck course={course} />
              )
            ) : null}
            {tab === "seminars" ? (
              course.seminars.length === 0 ? (
                <TabEmpty
                  phrase="Семинаров ещё нет"
                  hint="Соберите комплект после утверждения каркаса"
                  ctaLabel={gatherKit ? "Собрать комплект" : undefined}
                  onCta={gatherKit}
                />
              ) : (
                <Seminars course={course} />
              )
            ) : null}
            {tab === "tests" ? (
              course.assessments.length === 0 ? (
                <TabEmpty
                  phrase="Тестов ещё нет"
                  hint="Соберите комплект после утверждения каркаса"
                  ctaLabel={gatherKit ? "Собрать комплект" : undefined}
                  onCta={gatherKit}
                />
              ) : (
                <Tests course={course} />
              )
            ) : null}
            {tab === "checks" ? <AuditPanel course={course} onRefreshOutdated={onRefreshOutdated} /> : null}
          </>
        )}
      </div>
    </section>
  );
}

function LockedContentState({
  frameworkReady,
  onApprove,
  onGoApprove,
}: {
  frameworkReady: boolean;
  onApprove?: () => void;
  onGoApprove?: () => void;
}) {
  const canApprove = Boolean(frameworkReady && onApprove);
  const go = canApprove ? onApprove : onGoApprove;
  const label = canApprove ? "Утвердить каркас" : "К утверждению";
  return (
    <div className="tab-empty">
      <p className="tab-empty-phrase">Сначала утвердите каркас</p>
      {go ? (
        <button type="button" className="primary tab-empty-cta" onClick={go}>
          {label}
        </button>
      ) : null}
    </div>
  );
}

function sourceStatus(source?: string) {
  const value = source?.trim() ?? "";
  if (!value) return "Источник не указан";
  if (!isHttpSource(value)) return "Файл методиста";
  if (isOfficialPublication(value)) return "Официальное опубликование";
  return "Ссылка не подтверждена";
}

function ReferenceList({
  references,
  title,
}: {
  references: CourseDocument["brief"]["references"];
  title: string;
}) {
  const count = references.length;
  return (
    <details className="materials-block">
      <summary className="materials-summary">
        <span>{title}</span>
        <span className="materials-count">{count ? String(count) : "нет"}</span>
      </summary>
      {count === 0 ? (
        <p className="muted">—</p>
      ) : (
        <ul className="ref-list">
          {references.map((item, index) => {
            const source = item.source?.trim() ?? "";
            return (
              <li key={`${item.title}-${source}-${index}`}>
                <strong>{item.title}</strong>
                <span>{sourceStatus(item.source)}</span>
                {isHttpSource(source) ? (
                  <a href={source} target="_blank" rel="noreferrer">
                    {source}
                  </a>
                ) : source ? (
                  <span>{source}</span>
                ) : null}
                {item.note ? <span>{item.note}</span> : null}
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
}

const AUDIT_TOPICS: { section: AuditSection; title: string }[] = [
  { section: "framework", title: "Каркас и часы" },
  { section: "content", title: "Материалы и тесты" },
  { section: "sources", title: "Документы и ссылки" },
  { section: "freshness", title: "Актуальность" },
  { section: "meaning", title: "Смысл" },
];

const SECTION_FIX_HINT: Partial<Record<AuditSection, string>> = {
  framework: "Обзор",
  content: "Тесты / Лекции / Семинары",
  sources: "Обзор",
  freshness: "Обзор",
  meaning: "Лекции / Семинары",
};

function topicStatus(items: { status: AuditStatus }[]): AuditStatus | "empty" {
  if (items.length === 0) return "empty";
  if (items.some((item) => item.status === "fail")) return "fail";
  if (items.some((item) => item.status === "warning")) return "warning";
  if (items.every((item) => item.status === "disabled")) return "disabled";
  if (
    items.some((item) => item.status === "disabled") &&
    items.every((item) => item.status === "pass" || item.status === "disabled")
  ) {
    return "pass";
  }
  return "pass";
}

function statusBadge(status: AuditStatus | "empty") {
  if (status === "pass") return { className: "ready", label: "готово" };
  if (status === "warning") return { className: "partial", label: "внимание" };
  if (status === "fail") return { className: "empty", label: "ошибки" };
  if (status === "disabled") return { className: "partial", label: "выкл." };
  return { className: "empty", label: "пусто" };
}

function topicCountLabel(items: { status: AuditStatus }[]) {
  const failCount = items.filter((item) => item.status === "fail").length;
  const warnCount = items.filter((item) => item.status === "warning").length;
  if (failCount > 0) return `${failCount} ош.`;
  if (warnCount > 0) return `${warnCount} вним.`;
  if (items.some((item) => item.status === "pass")) return "ок";
  if (items.length === 0) return "нет";
  return `${items.length}`;
}

function pluralBlockers(n: number) {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 > 10 && mod100 < 20) return "блокеров";
  if (mod10 === 1) return "блокер";
  if (mod10 >= 2 && mod10 <= 4) return "блокера";
  return "блокеров";
}

/** One-line verdict under the console tiles — not an export CTA. */
function consoleVerdict(
  summary: Record<AuditStatus, number>,
  course: CourseDocument,
): string {
  const hasFramework = (course.modules?.length ?? 0) > 0 && isFrameworkApproved(course);
  if (!hasFramework) return "Сначала каркас";
  if (summary.fail > 0) return `${summary.fail} ${pluralBlockers(summary.fail)}`;
  if (summary.warning > 0) return "Можно идти к выгрузке — есть внимание";
  return "Можно идти к выгрузке";
}

function AuditPanel({
  course,
  onRefreshOutdated,
}: {
  course: CourseDocument;
  onRefreshOutdated?: (labels: string[]) => void;
}) {
  const report = auditCourse(course);
  const outdatedHits = findOutdated(course);
  const outdatedLabels = [...new Set(outdatedHits.map((hit) => hit.label))];

  const bySection = (section: AuditSection) =>
    report.items.filter((entry) => entry.section === section);

  const defaultOpen =
    AUDIT_TOPICS.find((topic) => topicStatus(bySection(topic.section)) === "fail")?.section ??
    AUDIT_TOPICS.find((topic) => topicStatus(bySection(topic.section)) === "warning")?.section ??
    AUDIT_TOPICS[0].section;

  const [openOverride, setOpenOverride] = useState<AuditSection | null>(null);
  const [tileFilter, setTileFilter] = useState<AuditStatus | null>(null);
  const openSection = openOverride ?? defaultOpen;

  const counts: { status: AuditStatus; title: string }[] = [
    { status: "fail", title: "ошибки" },
    { status: "warning", title: "внимание" },
    { status: "pass", title: "пройдено" },
  ];

  const moduleTitle = (moduleId?: string) =>
    moduleId ? course.modules.find((module) => module.id === moduleId)?.title : undefined;

  function openFromTile(status: AuditStatus) {
    if (status === "pass") {
      setTileFilter(null);
      return;
    }
    setTileFilter((prev) => (prev === status ? null : status));
    const match = AUDIT_TOPICS.find((topic) => {
      const items = bySection(topic.section).filter((entry) =>
        topic.section === "meaning" ? entry.id !== "meaning.llm" : true,
      );
      return items.some((entry) => entry.status === status);
    });
    if (match) setOpenOverride(match.section);
  }

  return (
    <div className="audit audit-stages">
      <div className="audit-console" role="status">
        <div className="audit-counts">
          {counts.map((group) => (
            <button
              key={group.status}
              type="button"
              className={`audit-count ${group.status}${tileFilter === group.status ? " is-active" : ""}`}
              onClick={() => openFromTile(group.status)}
              aria-pressed={tileFilter === group.status}
              title={
                group.status === "pass"
                  ? "Сбросить фильтр"
                  : `Открыть этап с «${group.title}»`
              }
            >
              <strong>{report.summary[group.status]}</strong>
              <span>{group.title}</span>
            </button>
          ))}
        </div>
        <p className="audit-console-summary">{consoleVerdict(report.summary, course)}</p>
      </div>

      <div className="audit-stage-list" role="list">
        {AUDIT_TOPICS.map((topic, index) => {
          const rawItems = bySection(topic.section);
          // meaning.llm is rendered inside MeaningReview — hide the disabled stub card
          const items =
            topic.section === "meaning"
              ? rawItems.filter((entry) => entry.id !== "meaning.llm")
              : rawItems;
          const status = topicStatus(items.length ? items : rawItems);
          const badge = statusBadge(status);
          const isOpen = openSection === topic.section;
          const problems = items.filter((entry) => {
            if (entry.status !== "fail" && entry.status !== "warning") return false;
            if (tileFilter && entry.status !== tileFilter) return false;
            return true;
          });
          const passCount = items.filter((entry) => entry.status === "pass").length;
          const stageDone = status === "pass" || status === "disabled";

          return (
            <section
              key={topic.section}
              className={`audit-stage${isOpen ? " is-open" : ""}${stageDone ? " is-done" : ""}`}
              data-section={topic.section}
              role="listitem"
            >
              <button
                type="button"
                className="audit-stage-head"
                aria-expanded={isOpen}
                onClick={() => setOpenOverride(topic.section)}
              >
                <span className="audit-stage-index" aria-hidden="true">
                  {index + 1}
                </span>
                <span className="audit-topic-title">
                  <span className={`check-badge ${badge.className}`}>{badge.label}</span>
                  <span className="audit-stage-name">{topic.title}</span>
                </span>
                <span className="materials-count">{topicCountLabel(items)}</span>
              </button>

              {isOpen ? (
                <div className="audit-stage-body">
                  {problems.length === 0 &&
                  topic.section !== "sources" &&
                  topic.section !== "freshness" &&
                  topic.section !== "meaning" ? (
                    <p className="muted">Замечаний нет.</p>
                  ) : null}

                  {problems.length > 0 ? (
                    <div className="audit-topic-body">
                      {problems.map((entry) => {
                        const modTitle = moduleTitle(entry.moduleId);
                        const fixHint = SECTION_FIX_HINT[topic.section];
                        return (
                          <article key={entry.id} className={`audit-card ${entry.status}`}>
                            <h3>{entry.label}</h3>
                            {entry.details ? <span>{entry.details}</span> : null}
                            {entry.moduleId || fixHint ? (
                              <span className="audit-fix">
                                Где править
                                {modTitle ? `: «${modTitle}»` : ""}
                                {fixHint ? ` · ${fixHint}` : ""}
                              </span>
                            ) : null}
                          </article>
                        );
                      })}
                    </div>
                  ) : null}

                  {passCount > 0 ? (
                    <p className="audit-passed-line muted">Пройдено: {passCount}</p>
                  ) : null}

                  {topic.section === "sources" ? (
                    <div className="audit-stage-extra">
                      <ReferenceList references={course.brief.references} title="Источники" />
                      <SourceChecks course={course} />
                    </div>
                  ) : null}

                  {topic.section === "freshness" ? (
                    <div className="audit-stage-extra">
                      {outdatedHits.length > 0 ? (
                        <article className="outdated-panel">
                          <h3>Устаревшие технологии</h3>
                          <ul className="audit-list">
                            {outdatedHits.map((hit) => (
                              <li key={`${hit.id}:${hit.place}`} className="warning">
                                <strong>{hit.label}:</strong> {hit.note}
                                <span>{hit.place}</span>
                              </li>
                            ))}
                          </ul>
                          {onRefreshOutdated ? (
                            <div className="pane-actions" style={{ marginTop: 8 }}>
                              <button
                                type="button"
                                title="Заменить устаревшие технологии в каркасе через чат"
                                onClick={() => onRefreshOutdated(outdatedLabels)}
                              >
                                Обновить
                              </button>
                            </div>
                          ) : null}
                        </article>
                      ) : (
                        <p className="muted">Устаревших меток не найдено.</p>
                      )}
                      <StackFreshnessPanel course={course} />
                    </div>
                  ) : null}

                  {topic.section === "meaning" ? (
                    <MeaningReview
                      course={course}
                      hits={items.filter(
                        (entry) => entry.status === "fail" || entry.status === "warning",
                      )}
                      passCount={passCount}
                    />
                  ) : null}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function MeaningReview({
  course,
  hits,
  passCount,
}: {
  course: CourseDocument;
  hits: { id: string; status: AuditStatus; label: string; details?: string; moduleId?: string }[];
  passCount: number;
}) {
  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "disabled"; details: string }
    | { status: "pass" | "warning" | "fail"; notes: string[]; details?: string }
    | { status: "error"; details: string }
  >({ status: "idle" });

  const run = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const response = await fetch("/api/backend/api/audit/meaning-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ course }),
      });
      if (!response.ok) {
        setState({ status: "error", details: `HTTP ${response.status}` });
        return;
      }
      const data = (await response.json()) as {
        status: "disabled" | "pass" | "warning" | "fail";
        notes?: string[];
        details?: string;
      };
      if (data.status === "disabled") {
        setState({
          status: "disabled",
          details: data.details || "LLM недоступен — ревью пропущено.",
        });
        return;
      }
      setState({
        status: data.status,
        notes: data.notes || [],
        details: data.details,
      });
    } catch (error) {
      setState({
        status: "error",
        details: error instanceof Error ? error.message : "Сбой недоступен",
      });
    }
  }, [course]);

  return (
    <article className="audit-meaning-block">
      <div className="audit-meaning-head">
        <div>
          <h3>Ревью смысла</h3>
          <p className="muted">
            Чеклист ловит пустое, шаблон и дубли. LLM — кратко: связность с ЦА, пробелы,
            противоречия. Без ключа шлюза кнопка вернёт «выкл.» и не блокирует выгрузку.
          </p>
        </div>
        <button type="button" onClick={() => void run()} disabled={state.status === "loading"}>
          {state.status === "loading" ? "Ревью…" : "Запросить LLM-ревью"}
        </button>
      </div>

      {hits.length === 0 && passCount > 0 ? (
        <p className="muted">Чеклист: пустых и шаблонных блоков не найдено.</p>
      ) : null}

      {hits.length > 0 ? (
        <ul className="audit-list audit-meaning-hits">
          {hits.map((entry) => (
            <li key={entry.id} className={entry.status}>
              <strong>{entry.label}</strong>
              {entry.details ? <span>{entry.details}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {state.status === "disabled" ? <p className="muted">{state.details}</p> : null}
      {state.status === "error" ? <p className="voice-error">{state.details}</p> : null}
      {state.status === "pass" || state.status === "warning" || state.status === "fail" ? (
        <ul className="audit-list">
          {(state.notes.length ? state.notes : [state.details || "Замечаний нет."]).map((note) => (
            <li key={note} className={state.status}>
              {note}
            </li>
          ))}
        </ul>
      ) : null}
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

function Overview({
  course,
}: {
  course: CourseDocument;
}) {
  const { brief } = course;
  const gaps = briefGaps(course);
  const isBlank = !brief.title.trim() && course.modules.length === 0;
  return (
    <div className="overview">
      {isBlank ? (
        <>
        <section className="about-card passport-stub">
          <p className="passport-kicker">Паспорт-заготовка</p>
          <h2>О программе</h2>
          <dl className="meta-grid passport-grid">
            <div>
              <dt>Название</dt>
              <dd className="passport-placeholder">Например, Основы кибербезопасности</dd>
            </div>
            <div>
              <dt>Аудитория</dt>
              <dd className="passport-placeholder">Кто будет учиться</dd>
            </div>
            <div>
              <dt>Объём часов</dt>
              <dd className="passport-placeholder">Например, 24 ч (шаг 0,5)</dd>
            </div>
            <div>
              <dt>Формат</dt>
              <dd className="passport-placeholder">Очно, смешанный или практикум</dd>
            </div>
          </dl>
        </section>

        </>
      ) : (
      <>
      {!brief.title && course.modules.length === 0 && gaps.length > 0 ? (
        <p className="program-soon">Пока нет: {gaps.join(", ")}.</p>
      ) : null}
      <section className="about-card">
        <h2>О программе</h2>
        <dl className="meta-grid">
          <div>
            <dt>Целевая аудитория</dt>
            <dd>{brief.audience.trim() || "—"}</dd>
          </div>
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
      </>
      )}
      {course.modules.length > 0 ? (
        <>
        <div className="table-scroll"><table className="hours-table">
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
        </table></div>
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

      <ReferenceList references={brief.references} title="Материалы" />
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

function ModuleWeekRuler({
  weeks,
  moduleId,
}: {
  weeks: Array<Array<{ id: string }>>;
  moduleId: string;
}) {
  if (weeks.length === 0) return null;
  return (
    <div className="module-week-ruler" aria-label="Недели модуля в курсе" role="list">
      {weeks.map((pieces, index) => {
        const on = pieces.some((piece) => piece.id === moduleId);
        return (
          <span
            key={`ruler-${moduleId}-${index}`}
            role="listitem"
            className={["week-dot", on ? "on" : ""].filter(Boolean).join(" ")}
            title={`Неделя ${index + 1}${on ? " — этот модуль" : ""}`}
            aria-label={`Неделя ${index + 1}${on ? ", модуль здесь" : ""}`}
          />
        );
      })}
    </div>
  );
}

function ModuleCard({
  course,
  module,
  index,
  open,
  onToggle,
  weeks,
  onRebuildModule,
}: {
  course: CourseDocument;
  module: CourseDocument["modules"][number];
  index: number;
  open: boolean;
  onToggle: () => void;
  weeks: Array<Array<{ id: string; title: string; hours: number; continued: boolean }>>;
  onRebuildModule?: (moduleId: string, title: string) => void;
}) {
  const marks = kitOf(course, module.id);
  const gap = moduleKindsGap(module);
  const topics = module.plan.length
    ? module.plan
    : module.topics.map((title) => ({
        title,
        lectureHours: 0,
        practiceHours: 0,
        labHours: 0,
        selfStudyHours: 0,
      }));
  const weekIndexes = weeks
    .map((pieces, weekIndex) => (pieces.some((piece) => piece.id === module.id) ? weekIndex + 1 : null))
    .filter((value): value is number => value != null);

  return (
    <article
      className={["module-first-card", open ? "open" : "", gap ? "hours-bad" : ""].filter(Boolean).join(" ")}
    >
      <button type="button" className="module-first-head" aria-expanded={open} onClick={onToggle}>
        <span className="mono module-first-num">{String(index + 1).padStart(2, "0")}</span>
        <span className="module-first-main">
          <strong>{module.title}</strong>
          <span className="module-first-meta muted">
            {formatHours(module.hours)} ч
            {weekIndexes.length ? ` · нед. ${weekIndexes.join(", ")}` : ""}
            {module.competencyIds.length
              ? ` · ${module.competencyIds.map((id) => competencyName(course, id)).join(", ")}`
              : ""}
          </span>
          <ModuleWeekRuler weeks={weeks} moduleId={module.id} />
        </span>
        <span className="kit-marks" aria-label="Комплект модуля">
          <i className={marks.lecture ? "on" : ""}>Л</i>
          <i className={marks.seminar ? "on" : ""}>З</i>
          <i className={marks.test ? "on" : ""}>Т</i>
        </span>
      </button>
      {open ? (
        <div className="module-first-body">
          {onRebuildModule && isFrameworkApproved(course) ? (
            <div className="pane-actions">
              <button
                type="button"
                title="Пересобрать лекции, семинары и тесты только для этого модуля"
                onClick={() => onRebuildModule(module.id, module.title)}
              >
                Пересобрать материалы модуля
              </button>
            </div>
          ) : null}
          <h4>Темы</h4>
          <ol className="plan-list">
            {topics.map((topic) => (
              <li key={topic.title}>
                <strong>{topic.title}</strong>
                {module.plan.length ? <span>{topicHoursLine(topic)}</span> : null}
              </li>
            ))}
          </ol>
          <h4>Результаты</h4>
          <ul>
            {module.learningOutcomes.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <details className="module-schema">
            <summary>Схема</summary>
            <MermaidBlock chart={moduleFlowChart(module)} />
          </details>
        </div>
      ) : null}
    </article>
  );
}

function Structure({ course, onRebuildModule }: { course: CourseDocument; onRebuildModule?: (moduleId: string, title: string) => void }) {
  if (course.modules.length === 0) {
    return null;
  }
  const total = snapHalf(course.modules.reduce((sum, item) => sum + item.hours, 0));
  const pace = calendarPace(course.brief.constraints, total);
  const [perWeek, setPerWeek] = useState(pace?.perWeek ?? 4);
  const [openId, setOpenId] = useState(course.modules[0]?.id ?? "");

  useEffect(() => {
    setPerWeek(pace?.perWeek ?? 4);
  }, [course.id, pace?.line, pace?.perWeek]);

  useEffect(() => {
    if (!course.modules.some((item) => item.id === openId)) {
      setOpenId(course.modules[0]?.id ?? "");
    }
  }, [course.modules, openId]);

  const weeks = weeksOf(course.modules, perWeek);
  const sameAsGraph = pace?.weeks != null && weeks.length === pace.weeks;

  const bumpHours = (delta: number) => {
    const next = snapHalf(perWeek + delta);
    if (next >= 0.5 && next <= 40) setPerWeek(next);
  };

  return (
    <div className="structure structure-light structure-modules-first">
      <header className="plan-tempo-head">
        <p className="plan-tempo-line">
          {pace?.line ? `${pace.line} · ` : ""}
          {formatHours(total)} ч
          {sameAsGraph
            ? ` · ${weeks.length} ${weekWord(weeks.length)} · ${formatHours(perWeek)} ч/нед.`
            : ` · сетка ${weeks.length} ${weekWord(weeks.length)} по ${formatHours(perWeek)} ч`}
        </p>
        <div className="week-hours-stepper" aria-label="Часов в неделю">
          <button type="button" className="stepper-btn" aria-label="Меньше часов в неделю" onClick={() => bumpHours(-0.5)}>
            −
          </button>
          <span className="week-hours-value">{formatHours(perWeek)} ч/нед.</span>
          <button type="button" className="stepper-btn" aria-label="Больше часов в неделю" onClick={() => bumpHours(0.5)}>
            +
          </button>
        </div>
      </header>
      <div className="module-first-list" role="list">
        {course.modules.map((module, index) => (
          <div key={module.id} role="listitem">
            <ModuleCard
              course={course}
              module={module}
              index={index}
              open={module.id === openId}
              onToggle={() => setOpenId((prev) => (prev === module.id ? "" : module.id))}
              weeks={weeks}
              onRebuildModule={onRebuildModule}
            />
          </div>
        ))}
      </div>
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
  const [showKeysFor, setShowKeysFor] = useState<Record<string, boolean>>({});
  if (course.assessments.length === 0) {
    return null;
  }
  return (
    <ul className="file-list">
      {course.assessments.map((assessment) => {
        const courseModule = course.modules.find((item) => item.id === assessment.moduleId);
        const title = courseModule?.title ?? assessment.moduleId;
        const open = openId === assessment.moduleId;
        const showKeys = Boolean(showKeysFor[assessment.moduleId]);
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
                <div className="pane-actions keys-toggle">
                  <button
                    type="button"
                    aria-pressed={showKeys}
                    title={showKeys ? "Скрыть правильные ответы" : "Показать правильные ответы методисту"}
                    onClick={() =>
                      setShowKeysFor((prev) => ({
                        ...prev,
                        [assessment.moduleId]: !showKeys,
                      }))
                    }
                  >
                    {showKeys ? "Скрыть ключи" : "Показать ключи"}
                  </button>
                </div>
                {assessment.questions.map((question, index) => (
                  <div key={`${question.stem}-${index}`} className="task">
                    <p className="plan-lead">
                      <span className="qtype">{QUESTION_LABELS[question.type]}</span> {index + 1}. {question.stem}
                    </p>
                    {question.options?.length ? (
                      <ul>
                        {question.options.map((option) => {
                          const isKey = option === question.answer;
                          return (
                            <li
                              key={option}
                              className={showKeys && isKey ? "correct" : undefined}
                            >
                              {showKeys && isKey ? "Ключ. " : ""}
                              {option}
                            </li>
                          );
                        })}
                      </ul>
                    ) : showKeys ? (
                      <p className="answer">Ключ: {question.answer}</p>
                    ) : (
                      <p className="muted">Открытый ответ · ключ скрыт</p>
                    )}
                    {showKeys ? (
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
                    ) : (
                      <p className="muted">
                        {competencyName(course, question.competencyId)}
                        {question.learningOutcome ? ` · результат: ${question.learningOutcome}` : ""}
                      </p>
                    )}
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
