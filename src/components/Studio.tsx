"use client";

import { sumTokenUsage } from "@/lib/token-usage";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ChatPanel } from "@/components/ChatPanel";
import { CourseWorkspace, type WorkspaceTab } from "@/components/CourseWorkspace";
import { SiteFrame } from "@/components/SiteFrame";
import {
  CourseConflictError,
  downloadCourseFromBackend,
  hasBackendStorage,
  loadCourseFromBackend,
  saveCourseToBackend,
} from "@/lib/backend-storage";
import { exportDoneLabel, exportWaitLabel } from "@/lib/job-status";
import { useElapsed } from "@/lib/use-elapsed";
import { applyPatch, foldCourseFromMessages } from "@/lib/course-patches";
import {
  frameworkFingerprint,
  frameworkItems,
  isFrameworkApproved,
  isKitComplete,
} from "@/lib/framework-check";
import { SAMPLE_COURSE } from "@/lib/sample-course";
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
import { resolveStudioOpen } from "@/lib/studio-open";
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

function useIsClient() {
  return useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
}

export function Studio({ courseId, sample }: { courseId?: string; sample?: boolean }) {
  const isClient = useIsClient();
  if (!isClient) {
    return <div className="boot">Открываю студию…</div>;
  }
  const open = resolveStudioOpen({ courseId, sample }, window.localStorage);
  return (
    <StudioSession
      initialCourse={open.course}
      initialMessages={open.messages}
      initialSessionId={open.rotateSession ? newSessionId() : loadSessionId()}
      initialChatOpen={!courseId}
      persist={open.persist}
      localNotice={open.notice}
    />
  );
}

function StudioSession({
  initialCourse,
  initialMessages,
  initialSessionId,
  initialChatOpen,
  persist,
  localNotice,
}: {
  initialCourse: CourseDocument;
  initialMessages: UIMessage[];
  initialSessionId: string;
  initialChatOpen: boolean;
  persist: boolean;
  localNotice: string;
}) {
  const [storedCourse, setStoredCourse] = useState(initialCourse);
  const [extraReferences, setExtraReferences] = useState("");
  const [tab, setTab] = useState<WorkspaceTab>("overview");
  const [sessionId, setSessionId] = useState(initialSessionId);
  const [backendReady, setBackendReady] = useState(!hasBackendStorage());
  const [saveState, setSaveState] = useState<
    "local" | "saving" | "synced" | "offline" | "conflict"
  >(hasBackendStorage() ? "saving" : "local");
  const [exportJob, setExportJob] = useState<{
    kind: "json" | "docx" | "pptx" | "zip";
    phase: "work" | "done" | "error";
    place?: "сервере" | "браузере";
  } | null>(
    null,
  );
  const [chatOpen, setChatOpen] = useState(initialChatOpen);
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

  const tokenUsage = useMemo(
    () => sumTokenUsage(messages),
    [messages],
  );

  const course = useMemo(
    () => foldCourseFromMessages(messages, storedCourse),
    [messages, storedCourse],
  );
  const checks = frameworkItems(course);
  const frameworkReady = checks.every((item) => item.ok);
  const frameworkApproved = isFrameworkApproved(course);
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
  const missingChecks = checks.filter((item) => !item.ok).map((item) => item.label);

  const exportFromServer = async (
    kind: "json" | "docx" | "pptx" | "zip",
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
    let latest = foldCourseFromMessages(messages, storedCourse);
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
    setChatOpen(true);
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
    const sample = {
      ...SAMPLE_COURSE,
      id: crypto.randomUUID(),
      updatedAt: new Date().toISOString(),
    };
    const nextSession = newSessionId();
    seenMessages.current = new Set();
    loggedErrors.current = new Set();
    sessionRef.current = nextSession;
    setSessionId(nextSession);
    setStoredCourse(sample);
    setMessages([]);
    setExtraReferences("");
    setTab("overview");
    persistLog(actionEntry(nextSession, "Загружен пример 24 ч"));
  };

  return (
    <SiteFrame
      actions={
        <>
          <a href="/courses">Мои курсы</a>
          <button type="button" title="Готовая программа без модели. В проход проверяющего не входит." onClick={loadSample}>
            Офлайн-пример
          </button>
          <button type="button" onClick={reset}>
            Новый курс
          </button>
        </>
      }
    >
      <div className="topbar">
        <div>
          <p className="kicker">
            {stage === "ask"
              ? "1. Запрос. Слева напишите, для кого программа и сколько в ней часов."
              : stage === "framework"
                ? "2. Каркас. Справа сверьте часы и компетенции, затем утвердите каркас."
                : kitComplete
                  ? "3. Комплект собран. Смотрите программу и выгружайте файлы."
                  : "3. Комплект. Каркас утверждён: можно собирать лекции, задания и тесты."}
          </p>
          <h1>{course.brief.title || "Новая образовательная программа"}</h1>
          <p className="save-state" aria-live="polite">
            {exportJob?.phase === "work"
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
                      : "Сохранено на этом компьютере"}
          </p>
        </div>
        <div className="topbar-side">
        {showDocument ? (
          <button
            type="button"
            className="chat-dock"
            aria-expanded={chatOpen}
            onClick={() => setChatOpen((open) => !open)}
          >
            {chatOpen ? "Скрыть чат" : "Чат"}
          </button>
        ) : null}
        <ol className="stages" aria-label="Шаги">
          <li className={stage === "ask" ? "current" : "done"}>Запрос</li>
          <li className={stage === "framework" ? "current" : stage === "kit" ? "done" : ""}>
            Каркас
          </li>
          <li className={stage === "kit" ? (kitComplete ? "done" : "current") : ""}>Комплект</li>
        </ol>
        </div>
      </div>
      <div
        className={`studio-body${showDocument ? "" : " chat-only"}${
          showDocument && !chatOpen ? " chat-away" : ""
        }`}
      >
        <ChatPanel
          messages={messages}
          tokenUsage={tokenUsage}
          status={status}
          error={error}
          extraReferences={extraReferences}
          frameworkApproved={frameworkApproved}
          kitComplete={kitComplete}
          stage={stage}
          missingChecks={missingChecks}
          onReferencesChange={setExtraReferences}
          onReferenceAdd={addReference}
          onSend={send}
          onStop={() => stop()}
        />
        {showDocument ? (
        <div className="pane pane-doc">
          <header className="pane-head">
            <p className="pane-label">2. Результат</p>
            <h2>Документ программы</h2>
            <p className="kicker">
              {frameworkApproved
                ? kitComplete
                  ? "Комплект собран. Смотрите программу справа и выгружайте файлы."
                  : "Каркас утверждён. Соберите содержание или выгрузите программу."
                : frameworkReady
                  ? "Часы и связи сходятся. Утвердите каркас, чтобы открыть лекции, задания и тесты."
                  : stage === "ask"
                    ? "Документ появится здесь после запроса с аудиторией и часами."
                    : `Пока рано утверждать: ${missingChecks.slice(0, 2).join("; ")}.`}
            </p>
            <div className="pane-actions">
              {frameworkApproved ? (
                <button type="button" onClick={revokeFramework}>
                  Снять утверждение
                </button>
              ) : (
                <button
                  type="button"
                  className="primary"
                  disabled={!frameworkReady}
                  title={
                    frameworkReady
                      ? "Каркас готов к утверждению"
                      : `Сначала исправьте: ${missingChecks.slice(0, 3).join("; ")}`
                  }
                  onClick={approveFramework}
                >
                  Утвердить каркас
                </button>
              )}
              <details className="export-menu">
                <summary>{exportJob?.phase === "work" ? "Собираю файл…" : "Выгрузить"}</summary>
                <div>
                  <button type="button" title="Данные программы" disabled={isCourseEmpty(course) || exportJob?.phase === "work"} onClick={() => void exportFromServer("json", () => exportCourseJson(course))}>
                    Данные
                  </button>
                  <button type="button" title="Программа обычным текстом" disabled={isCourseEmpty(course)} onClick={() => exportCourseMarkdown(course)}>
                    Текст
                  </button>
                  <button type="button" title="Отчёт проверки" disabled={isCourseEmpty(course)} onClick={() => exportCourseAudit(course)}>
                    Отчёт
                  </button>
                  <button type="button" title="Программа Word" disabled={isCourseEmpty(course) || exportJob?.phase === "work"} onClick={() => void exportFromServer("docx", () => exportCourseDocx(course))}>
                    Программа
                  </button>
                  <button type="button" title="Слайды в браузере" disabled={course.lectures.length === 0} onClick={() => exportLectureHtml(course)}>
                    Слайды
                  </button>
                  <button
                    type="button"
                    title="Слайды PowerPoint"
                    disabled={course.lectures.length === 0 || exportJob?.phase === "work"}
                    onClick={() => void exportFromServer("pptx", () => exportCoursePptx(course))}
                  >
                    Презентация
                  </button>
                  <button
                    type="button"
                    className="export-zip-button"
                    title="Скачать JSON, DOCX и PPTX одним архивом"
                    disabled={isCourseEmpty(course) || exportJob?.phase === "work"}
                    onClick={() => void exportFromServer("zip")}
                  >
                    Скачать архивом (ZIP)
                  </button>
                  <div className="export-tests">
                    <span>Тесты</span>
                    <button
                      type="button"
                      title="Moodle XML"
                      disabled={course.assessments.every((assessment) => assessment.questions.length === 0)}
                      onClick={() => exportCourseMoodle(course)}
                    >
                      Moodle
                    </button>
                    <button
                      type="button"
                      title="Формат GIFT"
                      disabled={course.assessments.every((assessment) => assessment.questions.length === 0)}
                      onClick={() => exportCourseGift(course)}
                    >
                      GIFT
                    </button>
                    <button
                      type="button"
                      title="Таблица CSV"
                      disabled={course.assessments.every((assessment) => assessment.questions.length === 0)}
                      onClick={() => exportCourseCsv(course)}
                    >
                      CSV
                    </button>
                  </div>
                </div>
              </details>
            </div>
          </header>
          <CourseWorkspace course={course} tab={tab} onTabChange={setTab} />
        </div>
        ) : null}
      </div>
    </SiteFrame>
  );
}
