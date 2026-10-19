"use client";

import { DefaultChatTransport, type UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ChatPanel } from "@/components/ChatPanel";
import { CourseWorkspace, type WorkspaceTab } from "@/components/CourseWorkspace";
import { SiteFrame } from "@/components/SiteFrame";
import {
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
} from "@/lib/framework-check";
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
import { SAMPLE_COURSE } from "@/lib/sample-course";
import {
  actionEntry,
  entryFromMessage,
  errorEntry,
  messageText,
  persistLog,
} from "@/lib/session-log";
import {
  loadSessionId,
  loadStoredCourse,
  loadStoredMessages,
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

export function Studio() {
  const isClient = useIsClient();
  if (!isClient) {
    return <div className="boot">Открываю студию…</div>;
  }
  const showSample = new URLSearchParams(window.location.search).get("sample") === "1";
  return (
    <StudioSession
      initialCourse={showSample ? SAMPLE_COURSE : loadStoredCourse()}
      initialMessages={showSample ? [] : loadStoredMessages()}
      initialSessionId={showSample ? newSessionId() : loadSessionId()}
    />
  );
}

function StudioSession({
  initialCourse,
  initialMessages,
  initialSessionId,
}: {
  initialCourse: CourseDocument;
  initialMessages: UIMessage[];
  initialSessionId: string;
}) {
  const [storedCourse, setStoredCourse] = useState(initialCourse);
  const [extraReferences, setExtraReferences] = useState("");
  const [tab, setTab] = useState<WorkspaceTab>("overview");
  const [sessionId, setSessionId] = useState(initialSessionId);
  const [backendReady, setBackendReady] = useState(!hasBackendStorage());
  const [saveState, setSaveState] = useState<"local" | "saving" | "synced" | "offline">(
    hasBackendStorage() ? "saving" : "local",
  );
  const [exportJob, setExportJob] = useState<{ kind: "json" | "docx" | "pptx"; phase: "work" | "done" | "error" } | null>(
    null,
  );
  const exportElapsed = useElapsed(exportJob?.phase === "work");
  const courseRef = useRef(storedCourse);
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
  const frameworkApproved = isFrameworkApproved(course);
  const stage = frameworkApproved ? "kit" : course.modules.length ? "framework" : "ask";
  const missingChecks = checks.filter((item) => !item.ok).map((item) => item.label);

  const exportFromServer = async (kind: "json" | "docx" | "pptx", fallback: () => void) => {
    setExportJob({ kind, phase: "work" });
    try {
      if (await downloadCourseFromBackend(course, kind)) {
        setExportJob({ kind, phase: "done" });
        window.setTimeout(() => setExportJob((current) => (current?.phase === "done" ? null : current)), 3200);
        return;
      }
      fallback();
      setExportJob({ kind, phase: "done" });
    } catch {
      try {
        fallback();
        setExportJob({ kind, phase: "done" });
      } catch {
        setExportJob({ kind, phase: "error" });
      }
    }
    window.setTimeout(() => setExportJob((current) => (current && current.phase !== "work" ? null : current)), 3200);
  };

  useEffect(() => {
    courseRef.current = course;
    saveCourse(course, messages);
  }, [course, messages]);

  useEffect(() => {
    refsRef.current = extraReferences;
  }, [extraReferences]);

  useEffect(() => {
    sessionRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    saveMessages(messages);
  }, [messages]);

  useEffect(() => {
    if (!hasBackendStorage()) return;
    let active = true;
    void loadCourseFromBackend(initialCourse.id)
      .then((stored) => {
        if (!active || !stored) return;
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
  }, [initialCourse.id, setMessages]);

  useEffect(() => {
    if (!backendReady || !hasBackendStorage()) return;
    const timer = window.setTimeout(() => {
      setSaveState("saving");
      void saveCourseToBackend(course, messages)
        .then(() => setSaveState("synced"))
        .catch(() => setSaveState("offline"));
    }, 700);
    return () => window.clearTimeout(timer);
  }, [backendReady, course, messages]);

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
    persistLog(errorEntry(sessionRef.current, error.message));
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
          <button type="button" onClick={loadSample}>
            Пример 24 ч
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
                : "3. Комплект. Каркас утверждён: можно собирать лекции, задания и тесты."}
          </p>
          <h1>{course.brief.title || "Новая образовательная программа"}</h1>
          <p className="save-state" aria-live="polite">
            {exportJob?.phase === "work"
              ? exportWaitLabel(exportJob.kind, exportElapsed)
              : exportJob?.phase === "done"
                ? exportDoneLabel(exportJob.kind)
                : exportJob?.phase === "error"
                  ? "Выгрузка не собралась"
                  : saveState === "synced"
                    ? "Сохранено"
                    : saveState === "saving"
                      ? "Сохраняю…"
                      : "Сохранено на этом компьютере"}
          </p>
        </div>
        <ol className="stages" aria-label="Шаги">
          <li className={stage === "ask" ? "current" : "done"}>Запрос</li>
          <li className={stage === "framework" ? "current" : stage === "kit" ? "done" : ""}>
            Каркас
          </li>
          <li className={stage === "kit" ? "current" : ""}>Комплект</li>
        </ol>
      </div>
      <div className="studio-body">
        <ChatPanel
          messages={messages}
          status={status}
          error={error}
          extraReferences={extraReferences}
          frameworkApproved={frameworkApproved}
          stage={stage}
          missingChecks={missingChecks}
          onReferencesChange={setExtraReferences}
          onReferenceAdd={addReference}
          onSend={send}
          onStop={() => stop()}
        />
        <div className="pane pane-doc">
          <header className="pane-head">
            <p className="pane-label">2. Результат</p>
            <h2>Документ программы</h2>
            <p className="kicker">
              {frameworkApproved
                ? "Каркас утверждён. Соберите содержание или выгрузите программу."
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
                  <button type="button" title="Программа Word" disabled={isCourseEmpty(course) || exportJob?.phase === "work"} onClick={() => void exportFromServer("docx", () => void exportCourseDocx(course))}>
                    Программа
                  </button>
                  <button type="button" title="Слайды в браузере" disabled={course.lectures.length === 0} onClick={() => exportLectureHtml(course)}>
                    Слайды
                  </button>
                  <button type="button" title="Слайды PowerPoint" disabled={course.lectures.length === 0 || exportJob?.phase === "work"} onClick={() => void exportFromServer("pptx", () => void exportCoursePptx(course))}>
                    Презентация
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
      </div>
    </SiteFrame>
  );
}
