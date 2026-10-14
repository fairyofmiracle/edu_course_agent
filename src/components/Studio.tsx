"use client";

import { DefaultChatTransport, type UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ChatPanel } from "@/components/ChatPanel";
import { CourseWorkspace, type WorkspaceTab } from "@/components/CourseWorkspace";
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
  exportCourseJson,
  exportCourseMarkdown,
  exportLectureHtml,
} from "@/lib/export";
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
  return (
    <StudioSession
      initialCourse={loadStoredCourse()}
      initialMessages={loadStoredMessages()}
      initialSessionId={loadSessionId()}
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
            Пишете слева. Документ справа. Лог сессии — файл logs/ за сегодня, не колонка в вебе.
          </p>
          <h1>{course.brief.title || "Новая образовательная программа"}</h1>
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
          onReferencesChange={setExtraReferences}
          onSend={send}
          onStop={() => stop()}
        />
        <div className="pane pane-doc">
          <header className="pane-head">
            <p className="pane-label">2. Сюда не пишете</p>
            <h2>Документ</h2>
            <p className="kicker">Смотрите каркас и часы. Утверждение и выгрузка только здесь.</p>
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
                  onClick={approveFramework}
                >
                  Утвердить каркас
                </button>
              )}
              <button
                type="button"
                disabled={isCourseEmpty(course)}
                onClick={() => exportCourseJson(course)}
              >
                JSON
              </button>
              <button
                type="button"
                disabled={isCourseEmpty(course)}
                onClick={() => exportCourseMarkdown(course)}
              >
                Текст
              </button>
              <button
                type="button"
                disabled={course.lectures.length === 0}
                onClick={() => exportLectureHtml(course)}
              >
                Слайды
              </button>
            </div>
          </header>
          <CourseWorkspace course={course} tab={tab} onTabChange={setTab} />
        </div>
      </div>
    </div>
  );
}
