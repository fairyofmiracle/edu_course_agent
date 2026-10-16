"use client";

import { DefaultChatTransport, type UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ChatPanel } from "@/components/ChatPanel";
import { CourseWorkspace, type WorkspaceTab } from "@/components/CourseWorkspace";
import {
  hasBackendStorage,
  loadCourseFromBackend,
  saveCourseToBackend,
} from "@/lib/backend-storage";
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

  useEffect(() => {
    courseRef.current = course;
    saveCourse(course);
  }, [course]);

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
    <div className="studio">
      <header className="topbar">
        <div>
          <p className="kicker">
            Опишите задачу слева — каркас программы и проверки появятся справа.
          </p>
          <h1>{course.brief.title || "Новая образовательная программа"}</h1>
          <p className="save-state" aria-live="polite">
            {saveState === "synced"
              ? "Сохранено в Python backend"
              : saveState === "saving"
                ? "Сохраняю изменения…"
                : saveState === "offline"
                  ? "Сохранено локально — backend недоступен"
                  : "Сохранено в этом браузере"}
          </p>
        </div>
        <ol className="stages" aria-label="Шаги">
          <li className={stage === "ask" ? "current" : "done"}>Запрос</li>
          <li className={stage === "framework" ? "current" : stage === "kit" ? "done" : ""}>
            Каркас
          </li>
          <li className={stage === "kit" ? "current" : ""}>Комплект</li>
        </ol>
        <div className="top-actions">
          <button type="button" onClick={loadSample}>
            Пример 24 ч
          </button>
          <button type="button" onClick={reset}>
            Новый курс
          </button>
        </div>
      </header>
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
              Проверьте каркас и часы, затем подтвердите переход к полному комплекту.
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
                <summary>Выгрузить</summary>
                <div>
                  <button type="button" disabled={isCourseEmpty(course)} onClick={() => exportCourseJson(course)}>
                    JSON
                  </button>
                  <button type="button" disabled={isCourseEmpty(course)} onClick={() => exportCourseMarkdown(course)}>
                    Текст
                  </button>
                  <button type="button" disabled={isCourseEmpty(course)} onClick={() => exportCourseAudit(course)}>
                    Отчёт
                  </button>
                  <button type="button" disabled={isCourseEmpty(course)} onClick={() => void exportCourseDocx(course)}>
                    DOCX
                  </button>
                  <button type="button" disabled={course.lectures.length === 0} onClick={() => exportLectureHtml(course)}>
                    HTML
                  </button>
                  <button type="button" disabled={course.lectures.length === 0} onClick={() => void exportCoursePptx(course)}>
                    PPTX
                  </button>
                </div>
              </details>
            </div>
          </header>
          <CourseWorkspace course={course} tab={tab} onTabChange={setTab} />
        </div>
      </div>
    </div>
  );
}
