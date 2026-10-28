"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { SiteFrame } from "@/components/SiteFrame";
import { NavIcon } from "@/components/NavIcon";
import {
  deleteCourseFromBackend,
  hasBackendStorage,
  listCoursesFromBackend,
  loadCourseFromBackend,
  saveCourseToBackend,
} from "@/lib/backend-storage";
import {
  adaptCourseCopy,
  groupByDirection,
  listLibrary,
  loadLibraryCourse,
  matchesHoursFilter,
  rememberCourse,
  type CopyAdaptation,
  type CourseSummary,
  type HoursFilter,
} from "@/lib/course-library";
import { courseDocumentSchema, displayCourseTitle, DEFAULT_COURSE_TITLE } from "@/lib/course-schema";
import { dropStoredCourse, newSessionId, saveCourse } from "@/lib/storage";
import type { UIMessage } from "ai";

type LibraryItem = CourseSummary & { where: "server" | "browser" };
const HOURS_FILTERS: { id: HoursFilter; label: string }[] = [
  { id: "all", label: "Все часы" },
  { id: "lt36", label: "До 36 ч" },
  { id: "36to72", label: "36–72 ч" },
  { id: "gte72", label: "От 72 ч" },
];

function programWord(count: number) {
  const n = Math.abs(count) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return "программ";
  if (n1 === 1) return "программа";
  if (n1 >= 2 && n1 <= 4) return "программы";
  return "программ";
}

function asUiMessages(value: unknown): UIMessage[] {
  if (!Array.isArray(value)) return [];
  const messages: UIMessage[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as { id?: unknown; role?: unknown; parts?: unknown; content?: unknown };
    if (record.role !== "user" && record.role !== "assistant") continue;
    if (Array.isArray(record.parts)) {
      messages.push(record as UIMessage);
      continue;
    }
    const text = typeof record.content === "string" ? record.content : "";
    messages.push({
      id: typeof record.id === "string" ? record.id : crypto.randomUUID(),
      role: record.role,
      parts: text ? [{ type: "text", text }] : [],
    });
  }
  return messages;
}

function CopyIcon() {
  return <span className="nav-glyph" style={{ ["--glyph" as string]: "url(/icons/copy.png)" }} aria-hidden="true" />;
}

function TrashIcon() {
  return <span className="nav-glyph" style={{ ["--glyph" as string]: "url(/icons/trash.png)" }} aria-hidden="true" />;
}

export function CourseCatalog() {
  const router = useRouter();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [note, setNote] = useState("");
  const [query, setQuery] = useState("");
  const [hoursFilter, setHoursFilter] = useState<HoursFilter>("all");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [pendingDelete, setPendingDelete] = useState("");
  const [draft, setDraft] = useState({
    id: "",
    audience: "",
    duration: "",
    attestation: "",
    error: "",
  });

  useEffect(() => {
    const local = listLibrary(window.localStorage);
    let active = true;
    if (!hasBackendStorage()) {
      const timer = window.setTimeout(() => {
        if (!active) return;
        setItems(local.map((item) => ({ ...item, where: "browser" })));
        setNote("Курсы записаны в этом браузере.");
      }, 0);
      return () => {
        active = false;
        window.clearTimeout(timer);
      };
    }
    void listCoursesFromBackend()
      .then((body) => {
        if (!active || !body) return;
        const serverIds = new Set(body.courses.map((item) => item.id));
        setItems([
          ...body.courses.map((item) => ({ ...item, where: "server" as const })),
          ...local
            .filter((item) => !serverIds.has(item.id))
            .map((item) => ({ ...item, where: "browser" as const })),
        ]);
        setNote("Сохранённые программы.");
      })
      .catch(() => {
        if (!active) return;
        setItems(local.map((item) => ({ ...item, where: "browser" })));
        setNote("Сервер списка не ответил. Показаны курсы этого браузера.");
      });
    return () => {
      active = false;
    };
  }, [revision]);

  const needle = query.trim().toLowerCase();
  const visible = items.filter((item) => {
    if (!matchesHoursFilter(item.durationHours, hoursFilter)) return false;
    if (!needle) return true;
    return `${item.title} ${item.audience}`.toLowerCase().includes(needle);
  });

  async function openCourse(courseId: string) {
    let next = loadLibraryCourse(window.localStorage, courseId);
    if (hasBackendStorage()) {
      try {
        const stored = await loadCourseFromBackend(courseId);
        if (stored) next = { course: stored.course, messages: stored.messages };
      } catch {
        setNote("Сервер не ответил. Открываю копию из этого браузера.");
      }
    }
    if (!next) {
      setNote("Курс не найден.");
      return;
    }
    const parsed = courseDocumentSchema.safeParse(next.course);
    if (!parsed.success) {
      setNote("Курс не открылся: запись не совпала со схемой программы.");
      return;
    }
    saveCourse(parsed.data, asUiMessages(next.messages));
    newSessionId();
    router.push(`/?course=${encodeURIComponent(courseId)}&open=${Date.now()}`);
  }

  async function copyCourse(courseId: string, adaptation: CopyAdaptation) {
    let source = loadLibraryCourse(window.localStorage, courseId)?.course;
    if (hasBackendStorage()) {
      try {
        const stored = await loadCourseFromBackend(courseId);
        if (stored) source = stored.course;
      } catch {
        setNote("Сервер не ответил. Копия собирается из курса в этом браузере.");
      }
    }
    if (!source) return "Курс не найден.";
    const adapted = adaptCourseCopy(source, adaptation);
    if (!adapted.ok) return adapted.error;
    rememberCourse(source, loadLibraryCourse(window.localStorage, courseId)?.messages ?? [], window.localStorage);
    rememberCourse(adapted.course, [], window.localStorage);
    if (hasBackendStorage()) {
      try {
        await saveCourseToBackend(adapted.course, [], "copy");
      } catch {
        setNote("Копия записана в этом браузере. Сервер её не принял.");
      }
    }
    setRevision((value) => value + 1);
    setNote("Копия создана. Исходный курс на месте.");
    return;
  }

  async function removeCourse(courseId: string) {
    if (hasBackendStorage()) {
      try {
        await deleteCourseFromBackend(courseId);
      } catch {
        setNote("Сервер курс не удалил. Он остался в списке.");
        return;
      }
    }
    const wasOpen = dropStoredCourse(courseId);
    setPendingDelete("");
    setRevision((value) => value + 1);
    setNote(
      wasOpen
        ? "Курс удалён. В студии откроется пустая программа."
        : "Курс удалён.",
    );
  }

  const emptyReason =
    needle || hoursFilter !== "all"
      ? "В списке нет курсов по этому запросу."
      : "Пока нет сохранённых курсов. Программа запишется, когда вы начнёте её в студии.";

  return (
    <SiteFrame
      title="Мои курсы"
      subtitle={`${items.length} ${programWord(items.length)}`}
      actions={() => (
        <>
          <Link href="/courses" aria-current="page">
            <NavIcon name="courses" />
            Мои курсы
          </Link>
          <Link href="/?new=1">
            <NavIcon name="plus" />
            Новый курс
          </Link>
        </>
      )}
    >
      <section className="catalog-page">
        <div className="catalog-count-row" aria-live="polite">
          <p className="catalog-count">
            <strong>{items.length}</strong> {programWord(items.length)}
            {needle || hoursFilter !== "all" ? (
              <span className="catalog-count-filtered">
                {" "}
                · в списке {visible.length}
              </span>
            ) : null}
          </p>
          {note ? <p className="kicker catalog-note">{note}</p> : null}
        </div>
        <div className="catalog-filters">
          <input
            className="catalog-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Найти по названию или аудитории"
          />
          <div className="catalog-hours-filter" role="group" aria-label="Фильтр по часам">
            {HOURS_FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={hoursFilter === item.id ? "is-active" : undefined}
                aria-pressed={hoursFilter === item.id}
                onClick={() => setHoursFilter(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        {visible.length === 0 ? (
          <p className="kicker">{emptyReason}</p>
        ) : (
          <div className="catalog-groups">
            {groupByDirection(visible).map((group) => (
              <section key={group.label} className="catalog-group">
                <h2>{group.label}</h2>
                <ul className="catalog-list">
                  {group.courses.map((item) => {
                    const panelOpen = draft.id === item.id || pendingDelete === item.id;
                    return (
                      <li key={item.id} className={panelOpen ? "is-open" : undefined}>
                        <div className="catalog-card">
                          <div className="catalog-card-main">
                            <button
                              type="button"
                              className="catalog-open"
                              disabled={busy}
                              onClick={() => {
                                setBusy(true);
                                void openCourse(item.id).finally(() => setBusy(false));
                              }}
                            >
                              <strong className="catalog-theme">
                                {displayCourseTitle(item.title)}
                              </strong>
                              <span className="catalog-hours">
                                {item.durationHours ? `${item.durationHours} ч` : "Часы не заданы"}
                              </span>
                              <span className="catalog-audience">
                                {item.audience.trim() || "Аудитория не указана"}
                              </span>
                            </button>
                            <span className="library-actions catalog-tools">
                              <button
                                type="button"
                                className="catalog-tool-btn"
                                aria-label="Копия"
                                title="Копия"
                                disabled={busy}
                                onClick={() => {
                                  setPendingDelete("");
                                  setDraft({
                                    id: item.id,
                                    audience: item.audience,
                                    duration: item.durationHours
                                      ? String(item.durationHours).replace(".", ",")
                                      : "",
                                    attestation: String(item.attestationHours ?? 0).replace(".", ","),
                                    error: "",
                                  });
                                }}
                              >
                                <CopyIcon />
                                <span className="catalog-tool-label">Копия</span>
                              </button>
                              <button
                                type="button"
                                className="catalog-tool-btn"
                                aria-label="Удалить"
                                title="Удалить"
                                disabled={busy}
                                onClick={() => {
                                  setDraft({
                                    id: "",
                                    audience: "",
                                    duration: "",
                                    attestation: "",
                                    error: "",
                                  });
                                  setPendingDelete(item.id);
                                }}
                              >
                                <TrashIcon />
                                <span className="catalog-tool-label">Удалить</span>
                              </button>
                            </span>
                          </div>
                          {panelOpen ? (
                          <div className="catalog-card-panel" role="region">
                            {draft.id === item.id ? (
                              <form
                                className="copy-form"
                                onSubmit={(event) => {
                                  event.preventDefault();
                                  const durationHours = Number(draft.duration.trim().replace(",", "."));
                                  const attestationHours = Number(draft.attestation.trim().replace(",", "."));
                                  setBusy(true);
                                  void copyCourse(item.id, {
                                    audience: draft.audience,
                                    durationHours,
                                    attestationHours,
                                  })
                                    .then((error) => {
                                      if (error) setDraft((current) => ({ ...current, error }));
                                      else
                                        setDraft({
                                          id: "",
                                          audience: "",
                                          duration: "",
                                          attestation: "",
                                          error: "",
                                        });
                                    })
                                    .finally(() => setBusy(false));
                                }}
                              >
                                <p className="card-back-title">Копия</p>
                                <label>
                                  Новая аудитория
                                  <input
                                    value={draft.audience}
                                    onChange={(event) =>
                                      setDraft((current) => ({
                                        ...current,
                                        audience: event.target.value,
                                        error: "",
                                      }))
                                    }
                                  />
                                </label>
                                <label>
                                  Новый объём, ч
                                  <input
                                    inputMode="decimal"
                                    value={draft.duration}
                                    onChange={(event) =>
                                      setDraft((current) => ({
                                        ...current,
                                        duration: event.target.value,
                                        error: "",
                                      }))
                                    }
                                  />
                                </label>
                                <label>
                                  Аттестация, ч
                                  <input
                                    inputMode="decimal"
                                    value={draft.attestation}
                                    onChange={(event) =>
                                      setDraft((current) => ({
                                        ...current,
                                        attestation: event.target.value,
                                        error: "",
                                      }))
                                    }
                                  />
                                </label>
                                {draft.error ? <p>{draft.error}</p> : null}
                                <span className="library-actions">
                                  <button type="submit" className="primary" disabled={busy}>
                                    Создать
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() =>
                                      setDraft({
                                        id: "",
                                        audience: "",
                                        duration: "",
                                        attestation: "",
                                        error: "",
                                      })
                                    }
                                  >
                                    Отмена
                                  </button>
                                </span>
                              </form>
                            ) : (
                              <div className="copy-form">
                                <p className="card-back-title">Удалить</p>
                                <p>Курс пропадёт из списка. Вернуть его нельзя.</p>
                                <span className="library-actions">
                                  <button
                                    type="button"
                                    className="primary"
                                    disabled={busy}
                                    onClick={() => {
                                      setBusy(true);
                                      void removeCourse(item.id).finally(() => setBusy(false));
                                    }}
                                  >
                                    Удалить
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => setPendingDelete("")}
                                  >
                                    Отмена
                                  </button>
                                </span>
                              </div>
                            )}
                          </div>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </section>
    </SiteFrame>
  );
}
