"use client";

import { DefaultChatTransport, type UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ChatPanel } from "@/components/ChatPanel";
import { CourseTabs, CourseWorkspace, type WorkspaceTab } from "@/components/CourseWorkspace";
import { NavIcon } from "@/components/NavIcon";
import { SiteFrame } from "@/components/SiteFrame";
import {
  CourseConflictError,
  downloadCourseFromBackend,
  type ServerExportKind,
  hasBackendStorage,
  loadCourseFromBackend,
  saveCourseToBackend,
} from "@/lib/backend-storage";
import { exportDoneLabel, exportWaitLabel, workProgress } from "@/lib/job-status";
import { useElapsed } from "@/lib/use-elapsed";
import { applyPatch, foldCourseFromMessages } from "@/lib/course-patches";
import {
  frameworkFingerprint,
  frameworkItems,
  hasBuiltMaterials,
  isFrameworkApproved,
  isKitComplete,
} from "@/lib/framework-check";
import { FRAMEWORK_PROMPT, KIT_PROMPT, moduleKitPrompt, adaptHoursPrompt, adaptAudiencePrompt, refreshOutdatedPrompt } from "@/lib/agent/service-prompts";
import { briefGaps } from "@/lib/course-validation";
import { userFacingError } from "@/lib/user-error";
import {
  createEmptyCourse,
  isCourseEmpty,
  type CourseBrief,
  type CourseDocument,
} from "@/lib/course-schema";
import {
  exportCourseAudit,
  exportCourseJson,
  exportCourseMarkdown,
  exportLectureHtml,
} from "@/lib/export";
import { exportCourseDocx } from "@/lib/export-docx";
import { exportCourseMoodle } from "@/lib/export-moodle";
import { exportCourseCsv, exportCourseGift } from "@/lib/export-tests";
import { exportCoursePptx } from "@/lib/export-pptx";
import { openOfflineSample, resolveStudioOpen } from "@/lib/studio-open";
import {
  actionEntry,
  entryFromMessage,
  errorEntry,
  messageText,
  persistLog,
} from "@/lib/session-log";
import {
  loadSessionId,
  newSessionId,
  saveCourse,
  saveMessages,
} from "@/lib/storage";

function bootCaption(
  open: ReturnType<typeof resolveStudioOpen>,
  query: { courseId?: string; sample?: boolean; fresh?: boolean },
) {
  if (query.fresh) return "Открываем новый курс";
  if (query.sample && !query.courseId?.trim()) return "Открываем пример";
  const title = open.course.brief.title.trim();
  if (!title) return "Открываем студию";
  return `Открываем курс «${title}»`;
}

function useIsClient() {
  return useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
}

export function Studio({
  courseId,
  sample,
  fresh,
}: {
  courseId?: string;
  sample?: boolean;
  fresh?: boolean;
}) {
  const isClient = useIsClient();
  const BOOT_SEEN_KEY = "edu-course-boot-seen";
  const [bootSkipped, setBootSkipped] = useState(false);
  const [showBoot, setShowBoot] = useState(true);
  const [bootFading, setBootFading] = useState(false);

  // Cold-start only: revisit in the same tab skips splash.
  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(BOOT_SEEN_KEY) === "1") {
        setBootSkipped(true);
        setShowBoot(false);
      }
    } catch {
      // sessionStorage may be blocked — show boot once this mount
    }
  }, []);

  // Keep splash until studio is mounted and the first paint settles, then fade out.
  useEffect(() => {
    if (!isClient || bootSkipped || !showBoot || bootFading) return;
    let cancelled = false;
    let fadeTimer = 0;

    const waitPaint = () =>
      new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => resolve());
        });
      });

    (async () => {
      try {
        if (document.fonts?.ready) {
          await document.fonts.ready;
        }
      } catch {
        // ignore font readiness errors
      }
      await waitPaint();
      // Yield so layout/styles of StudioSession can apply under the overlay.
      await new Promise<void>((resolve) => {
        fadeTimer = window.setTimeout(resolve, 0);
      });
      if (cancelled) return;
      try {
        window.sessionStorage.setItem(BOOT_SEEN_KEY, "1");
      } catch {
        // ignore
      }
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce) {
        setShowBoot(false);
      } else {
        setBootFading(true);
        // Fallback if transitionend never fires (e.g. display quirks).
        fadeTimer = window.setTimeout(() => {
          if (!cancelled) setShowBoot(false);
        }, 500);
      }
    })();

    return () => {
      cancelled = true;
      if (fadeTimer) window.clearTimeout(fadeTimer);
    };
  }, [isClient, bootSkipped, showBoot, bootFading]);

  if (!isClient) {
    return (
      <div className="boot" aria-label="Методий">
        <div className="boot-stack">
          <p className="boot-write">
            <span className="boot-word">Методий</span>
            <span className="boot-nib" aria-hidden="true" />
          </p>
        </div>
      </div>
    );
  }

  const open = resolveStudioOpen({ courseId, sample, fresh }, window.localStorage);
  const openingCaption = bootCaption(open, { courseId, sample, fresh });

  return (
    <>
      <StudioSession
        initialCourse={open.course}
        initialMessages={open.messages}
        initialSessionId={open.rotateSession ? newSessionId() : loadSessionId()}
        persist={open.persist}
        localNotice={open.notice}
      />
      {showBoot && !bootSkipped ? (
        <div
          className={`boot boot-overlay${bootFading ? " boot-overlay--leave" : ""}`}
          aria-label="Методий"
          aria-busy={!bootFading}
          onTransitionEnd={(event) => {
            if (event.propertyName !== "opacity") return;
            if (!bootFading) return;
            setShowBoot(false);
          }}
        >
          <div className="boot-stack">
            <p className="boot-write">
              <span className="boot-word">Методий</span>
              <span className="boot-nib" aria-hidden="true" />
            </p>
            <p className="boot-line">{openingCaption}</p>
          </div>
        </div>
      ) : null}
    </>
  );
}

function courseSubtitle(course: CourseDocument) {
  const title = course.brief.title.trim();
  const goal = course.brief.goals.find((item) => item.trim() && item.trim() !== title)?.trim();
  if (goal) return goal;
  const parts = [
    course.brief.audience.trim(),
    course.brief.durationHours > 0 ? `${course.brief.durationHours} ак. ч` : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

function StudioSession({
  initialCourse,
  initialMessages,
  initialSessionId,
  persist,
  localNotice,
}: {
  initialCourse: CourseDocument;
  initialMessages: UIMessage[];
  initialSessionId: string;
  persist: boolean;
  localNotice: string;
}) {
  const [storedCourse, setStoredCourse] = useState(initialCourse);
  const [extraReferences, setExtraReferences] = useState("");
  const [tab, setTab] = useState<WorkspaceTab>("overview");
  const [chatOpen, setChatOpen] = useState(true);
  useEffect(() => {
    const hasDocument = Boolean(
      initialCourse.brief.title.trim() || initialCourse.modules.length || initialMessages.length,
    );
    if (hasDocument && window.matchMedia("(max-width: 980px)").matches) setChatOpen(false);
  }, [initialCourse, initialMessages.length]);
  const [sessionId, setSessionId] = useState(initialSessionId);
  const [backendReady, setBackendReady] = useState(!hasBackendStorage());
  const [saveState, setSaveState] = useState<
    "local" | "saving" | "synced" | "offline" | "conflict"
  >(hasBackendStorage() ? "saving" : "local");
  const [exportJob, setExportJob] = useState<{
    kind: ServerExportKind;
    phase: "work" | "done" | "error";
    place?: "сервере" | "браузере";
  } | null>(
    null,
  );
  const [storageNote, setStorageNote] = useState("");
  const exportElapsed = useElapsed(exportJob?.phase === "work");
  const courseRef = useRef(storedCourse);
  const messagesRef = useRef(initialMessages);
  const versionRef = useRef<number | undefined>(undefined);
  const refsRef = useRef("");
  const sessionRef = useRef(initialSessionId);
  const seenMessages = useRef(new Set(initialMessages.map((item) => item.id)));
  const loggedErrors = useRef(new Set<string>());
  const [transport] = useState(
    () => new DefaultChatTransport({ api: "/api/chat" }),
  );

  const { messages, sendMessage, status, error, stop, setMessages } = useChat({
    transport,
    messages: initialMessages,
  });

  const course = useMemo(
    () => foldCourseFromMessages(messages, storedCourse),
    [messages, storedCourse],
  );
  const checks = frameworkItems(course);
  const frameworkReady = checks.every((item) => item.ok);
  const briefReady = briefGaps(course).length === 0;
  const frameworkApproved = isFrameworkApproved(course);
  const contentOpen = frameworkApproved || hasBuiltMaterials(course);
  const kitComplete = isKitComplete(course);
  const sourceLine = (() => {
    const text = [...messages]
      .reverse()
      .filter((item) => item.role === "assistant")
      .map((item) => messageText(item))
      .find((value) =>
        /Ключа шлюза нет|Шлюз не ответил|Учебный комплект подготовлен частично|Собрала комплект|Комплект написала модель/.test(value),
      );
    if (!text) return "";
    if (text.includes("Ключа шлюза нет")) return "Ключа шлюза нет. Комплект по каркасу.";
    if (text.includes("Шлюз не ответил")) return "Шлюз не ответил. Недостающее дописано по каркасу.";
    if (text.includes("Учебный комплект подготовлен частично")) return "Часть комплекта написала модель.";
    return "Комплект написала модель.";
  })();
  const stage = frameworkApproved ? "kit" : course.modules.length ? "framework" : "ask";
  const showDocument = Boolean(
    course.brief.title.trim() || course.modules.length || messages.length > 0,
  );
  const chatPending = status === "submitted" || status === "streaming";
  const chatElapsed = useElapsed(chatPending);
  const activity = chatPending ? workProgress(stage, chatElapsed) : null;
  useEffect(() => {
    if (!contentOpen && (tab === "lectures" || tab === "seminars" || tab === "tests")) {
      setTab("overview");
    }
  }, [contentOpen, tab]);

  const exportFromServer = async (
    kind: ServerExportKind,
    fallback?: () => void | Promise<void>,
  ) => {
    setExportJob({ kind, phase: "work", place: "сервере" });

    const finish = (
      phase: "done" | "error",
      place?: "сервере" | "браузере",
    ) => {
      setExportJob({ kind, phase, place });

      window.setTimeout(() => {
        setExportJob((current) =>
          current && current.phase !== "work" ? null : current
        );
      }, 3200);
    };

    try {
      const downloaded = await downloadCourseFromBackend(course, kind);

      if (downloaded) {
        finish("done", "сервере");
        return;
      }
    } catch (error) {
      // Если резервной генерации нет, показываем ошибку.
      if (!fallback) {
        console.error("Ошибка экспорта:", error);
        finish("error");
        return;
      }
    }

    if (!fallback) {
      console.error("Серверный экспорт недоступен:", kind);
      finish("error");
      return;
    }

    try {
      setExportJob({ kind, phase: "work", place: "браузере" });
      await fallback();
      finish("done", "браузере");
    } catch (error) {
      console.error("Ошибка экспорта в браузере:", error);
      finish("error");
    }
  };

  useEffect(() => {
    courseRef.current = course;
  }, [course]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (!persist) return;
    const result = saveCourse(course, messages);
    setStorageNote(result.ok ? "" : result.message);
  }, [persist, course, messages]);

  useEffect(() => {
    refsRef.current = extraReferences;
  }, [extraReferences]);

  useEffect(() => {
    sessionRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    if (!persist) return;
    const result = saveMessages(messages);
    if (!result.ok) setStorageNote(result.message);
  }, [persist, messages]);

  useEffect(() => {
    if (!hasBackendStorage() || !persist) {
      setBackendReady(true);
      setSaveState("local");
      return;
    }
    let active = true;
    const stamp = JSON.stringify({
      course: courseRef.current,
      messages: messagesRef.current,
    });
    void loadCourseFromBackend(initialCourse.id)
      .then((stored) => {
        if (!active || !stored) return;
        versionRef.current = stored.version;
        const edited =
          JSON.stringify({
            course: courseRef.current,
            messages: messagesRef.current,
          }) !== stamp;
        if (edited) return;
        setStoredCourse(stored.course);
        setMessages(stored.messages);
        setSaveState("synced");
      })
      .catch(() => {
        if (active) setSaveState("offline");
      })
      .finally(() => {
        if (active) setBackendReady(true);
      });
    return () => {
      active = false;
    };
  }, [initialCourse.id, persist, setMessages]);

  useEffect(() => {
    if (!backendReady || !hasBackendStorage() || !persist) return;
    const timer = window.setTimeout(() => {
      setSaveState("saving");
      void saveCourseToBackend(course, messages, "autosave", versionRef.current)
        .then((version) => {
          if (typeof version === "number") versionRef.current = version;
          setSaveState("synced");
        })
        .catch((error: unknown) => {
          setSaveState(error instanceof CourseConflictError ? "conflict" : "offline");
        });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [backendReady, persist, course, messages]);

  useEffect(() => {
    const ready = status === "ready";
    for (const message of messages) {
      if (seenMessages.current.has(message.id)) continue;
      if (message.role === "assistant" && !ready) continue;
      const entry = entryFromMessage({
        sessionId: sessionRef.current,
        message,
        checks,
      });
      seenMessages.current.add(message.id);
      if (entry) persistLog(entry);
    }
  }, [messages, status, checks]);

  useEffect(() => {
    if (!error) return;
    const lastUser = [...messages].reverse().find((item) => item.role === "user");
    const key = `${lastUser?.id ?? ""}:${error.message}`;
    if (loggedErrors.current.has(key)) return;
    loggedErrors.current.add(key);
    persistLog(errorEntry(sessionRef.current, userFacingError(error)));
  }, [error, messages]);

  const send = (text: string, brief?: Partial<CourseBrief>) => {
    let latest = foldCourseFromMessages(messages, courseRef.current);
    if (brief && Object.keys(brief).length > 0) {
      latest = applyPatch(latest, { type: "update_brief", brief });
      setStoredCourse(latest);
    }
    courseRef.current = latest;
    const last = messages[messages.length - 1];
    if (last?.role === "user" && messageText(last) === text.trim()) {
      setMessages(messages.slice(0, -1));
    }
    void sendMessage(
      { text },
      {
        body: {
          course: latest,
          brief,
          extraReferences: refsRef.current,
        },
      },
    );
  };

  const reset = () => {
    const empty = createEmptyCourse();
    const nextSession = newSessionId();
    seenMessages.current = new Set();
    loggedErrors.current = new Set();
    sessionRef.current = nextSession;
    setSessionId(nextSession);
    setStoredCourse(empty);
    setMessages([]);
    setExtraReferences("");
    setTab("overview");
    persistLog(actionEntry(nextSession, "Новый курс"));
  };

  const approveFramework = () => {
    if (!frameworkReady) return;
    const next = {
      ...course,
      frameworkApproved: true,
      frameworkFingerprint: frameworkFingerprint(course),
      updatedAt: new Date().toISOString(),
    };
    courseRef.current = next;
    setStoredCourse(next);
    persistLog(actionEntry(sessionRef.current, "Каркас утверждён"));
  };

  const revokeFramework = () => {
    const next = {
      ...course,
      frameworkApproved: false,
      frameworkFingerprint: "",
      updatedAt: new Date().toISOString(),
    };
    courseRef.current = next;
    setStoredCourse(next);
    persistLog(actionEntry(sessionRef.current, "Утверждение каркаса снято"));
  };

  const addReference = (reference: CourseBrief["references"][number]) => {
    const latest = courseRef.current;
    const duplicate = latest.brief.references.some(
      (item) => item.title === reference.title && item.source === reference.source,
    );
    if (duplicate) return;
    const next = applyPatch(latest, {
      type: "update_brief",
      brief: { references: [...latest.brief.references, reference].slice(-20) },
    });
    courseRef.current = next;
    setStoredCourse(next);
  };

  const loadSample = () => {
    const opened = openOfflineSample(courseRef.current.id, window.localStorage);
    if (!opened) {
      setTab("overview");
      return;
    }
    const nextSession = newSessionId();
    seenMessages.current = new Set();
    loggedErrors.current = new Set();
    sessionRef.current = nextSession;
    setSessionId(nextSession);
    setStoredCourse(opened.course);
    setMessages(opened.messages);
    setExtraReferences("");
    setTab("overview");
    persistLog(actionEntry(nextSession, "Загружен пример 24 ч"));
  };

  return (
    <SiteFrame
      title={
        course.brief.title.trim() ||
        (course.modules.length === 0 ? "Новая образовательная программа" : "Без названия")
      }
      subtitle={courseSubtitle(course)}
      chatOpen={chatOpen}
      onOpenChat={() => setChatOpen(true)}
      activity={activity}
      tools={
        <>
          <details className="export-menu">
            <summary>
              {exportJob?.phase === "work" ? "Собираю…" : "Выгрузка"}
            </summary>
            <div>
              <button
                type="button"
                disabled={isCourseEmpty(course) || exportJob?.phase === "work"}
                onClick={() => void exportFromServer("zip")}
              >
                {exportJob?.phase === "work" && exportJob.kind === "zip" ? "Собираю архив…" : "Архив"}
              </button>
              <button type="button" disabled={isCourseEmpty(course) || exportJob?.phase === "work"} onClick={() => void exportFromServer("docx", () => exportCourseDocx(course))}>
                Программа
              </button>
              <button type="button" disabled={course.lectures.length === 0 || exportJob?.phase === "work"} onClick={() => void exportFromServer("pptx", () => exportCoursePptx(course))}>
                Презентация
              </button>
              <button type="button" disabled={course.lectures.length === 0 || exportJob?.phase === "work"} onClick={() => void exportFromServer("html", () => exportLectureHtml(course))}>
                Слайды
              </button>
              <button type="button" disabled={isCourseEmpty(course) || exportJob?.phase === "work"} onClick={() => void exportFromServer("json", () => exportCourseJson(course))}>
                Данные
              </button>
              <button type="button" disabled={isCourseEmpty(course)} onClick={() => exportCourseMarkdown(course)}>
                Текст
              </button>
              <button type="button" disabled={isCourseEmpty(course)} onClick={() => exportCourseAudit(course)}>
                Отчёт
              </button>
              <button type="button" disabled={course.assessments.every((assessment) => assessment.questions.length === 0) || exportJob?.phase === "work"} onClick={() => void exportFromServer("moodle", () => exportCourseMoodle(course))}>
                Moodle
              </button>
              <button type="button" disabled={course.assessments.every((assessment) => assessment.questions.length === 0) || exportJob?.phase === "work"} onClick={() => void exportFromServer("gift", () => exportCourseGift(course))}>
                GIFT
              </button>
              <button type="button" disabled={course.assessments.every((assessment) => assessment.questions.length === 0) || exportJob?.phase === "work"} onClick={() => void exportFromServer("csv", () => exportCourseCsv(course))}>
                CSV
              </button>
            </div>
          </details>
          {course.frameworkApproved ? (
            <button type="button" className="framework-action" onClick={revokeFramework}>
              Снять утверждение
            </button>
          ) : frameworkReady ? (
            <button type="button" id="framework-approve" className="primary framework-action" title="Каркас готов к утверждению" onClick={approveFramework}>
              Утвердить каркас
            </button>
          ) : briefReady ? (
            <button
              type="button"
              className="primary framework-action"
              title="Бриф уже полный: собрать модули и компетенции"
              disabled={chatPending}
              onClick={() => send(FRAMEWORK_PROMPT)}
            >
              Собрать каркас
            </button>
          ) : null}
        </>
      }
      note={
        exportJob?.phase === "work"
          ? exportWaitLabel(exportJob.kind, exportElapsed, exportJob.place)
          : exportJob?.phase === "done"
            ? exportDoneLabel(exportJob.kind)
            : exportJob?.phase === "error"
              ? "Выгрузка не собралась"
              : storageNote
                ? storageNote
                : localNotice
                  ? localNotice
                  : sourceLine
                    ? sourceLine
                    : saveState === "conflict"
                      ? "Курс уже сохранила другая вкладка. Обновите страницу, чтобы не затереть её правку."
                      : saveState === "synced"
                        ? "Сохранено"
                        : saveState === "saving"
                          ? "Сохраняю…"
                          : "Сохранено на этом компьютере"
      }
      actions={() => (
        <>
          <a href="/courses">
            <NavIcon name="courses" />
            Мои курсы
          </a>
          <button type="button" onClick={reset}>
            <NavIcon name="plus" />
            Новый курс
          </button>
          <CourseTabs tab={tab} approved={contentOpen} onTabChange={setTab} />
        </>
      )}
      onSample={loadSample}
    >
      <div
        className={`studio-body${showDocument ? "" : " chat-only"}${
          showDocument && !chatOpen ? " chat-away" : ""
        }`}
      >
        <ChatPanel
          messages={messages}
          status={status}
          error={error}
          extraReferences={extraReferences}
          frameworkApproved={course.frameworkApproved}
          kitComplete={kitComplete}
          stage={stage}
          onReferencesChange={setExtraReferences}
          onReferenceAdd={addReference}
          onSend={send}
          onStop={() => stop()}
          onClose={() => setChatOpen(false)}
        />
        <button
          type="button"
          className="chat-edge chat-edge-open"
          aria-label={chatOpen ? "Скрыть ассистента" : "Открыть ассистента"}
          title={chatOpen ? "Скрыть ассистента" : "Открыть ассистента"}
          onClick={() => setChatOpen((open) => !open)}
        >
          <svg className="chat-edge-chevron" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <img className="chat-edge-mark" src="/icons/chat.png" alt="" />
        </button>
        {showDocument ? (
        <div className="pane pane-doc">
          <header className="pane-head">
            <h2>Документ программы</h2>
          </header>
          <CourseWorkspace
            course={course}
            tab={tab}
            frameworkReady={frameworkReady}
            onApproveFramework={approveFramework}
            onGoApprove={() => {
              setTab("overview");
              setChatOpen(true);
              window.setTimeout(() => {
                document.getElementById("framework-approve")?.scrollIntoView({
                  behavior: "smooth",
                  block: "nearest",
                });
              }, 50);
            }}
            onGatherFramework={() => {
              setChatOpen(true);
              if (briefReady && !chatPending) send(FRAMEWORK_PROMPT);
            }}
            onGatherKit={() => {
              setChatOpen(true);
              if (frameworkApproved && !kitComplete && !chatPending) send(KIT_PROMPT);
            }}
            onRebuildModule={(moduleId, title) => {
              setChatOpen(true);
              if (!frameworkApproved || chatPending) return;
              send(moduleKitPrompt(moduleId, title));
            }}
            onAdaptHours={(hours) => {
              setChatOpen(true);
              if (chatPending) return;
              send(adaptHoursPrompt(hours));
            }}
            onAdaptAudience={(audience) => {
              setChatOpen(true);
              if (chatPending) return;
              send(adaptAudiencePrompt(audience));
            }}
            onRefreshOutdated={(labels) => {
              setChatOpen(true);
              if (chatPending) return;
              send(refreshOutdatedPrompt(labels));
            }}
            onOpenChat={() => setChatOpen(true)}
          />
        </div>
        ) : null}
      </div>
    </SiteFrame>
  );
}
