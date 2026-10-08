"use client";

import { DefaultChatTransport, type UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ChatPanel } from "@/components/ChatPanel";
import { CourseWorkspace, type WorkspaceTab } from "@/components/CourseWorkspace";
import { foldCourseFromMessages } from "@/lib/course-patches";
import { createEmptyCourse, isCourseEmpty, type CourseDocument } from "@/lib/course-schema";
import {
  exportCourseJson,
  exportCourseMarkdown,
  exportLectureHtml,
} from "@/lib/export";
import { SAMPLE_COURSE } from "@/lib/sample-course";
import {
  loadStoredCourse,
  loadStoredMessages,
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
    />
  );
}

function StudioSession({
  initialCourse,
  initialMessages,
}: {
  initialCourse: CourseDocument;
  initialMessages: UIMessage[];
}) {
  const [storedCourse, setStoredCourse] = useState(initialCourse);
  const [extraReferences, setExtraReferences] = useState("");
  const [tab, setTab] = useState<WorkspaceTab>("overview");
  const courseRef = useRef(storedCourse);
  const refsRef = useRef("");
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

  useEffect(() => {
    courseRef.current = course;
    saveCourse(course);
  }, [course]);

  useEffect(() => {
    refsRef.current = extraReferences;
  }, [extraReferences]);

  useEffect(() => {
    saveMessages(messages);
  }, [messages]);

  const send = (text: string) => {
    void sendMessage(
      { text },
      {
        body: {
          course: courseRef.current,
          extraReferences: refsRef.current,
        },
      },
    );
  };

  const reset = () => {
    const empty = createEmptyCourse();
    setStoredCourse(empty);
    setMessages([]);
    setExtraReferences("");
    setTab("overview");
  };

  const loadSample = () => {
    const sample = {
      ...SAMPLE_COURSE,
      id: crypto.randomUUID(),
      updatedAt: new Date().toISOString(),
    };
    setStoredCourse(sample);
    setMessages([]);
    setTab("overview");
  };

  return (
    <div className="studio">
      <header className="topbar">
        <div>
          <p className="kicker">Студия курса</p>
          <h1>{course.brief.title || "Новая образовательная программа"}</h1>
        </div>
        <div className="top-actions">
          <button type="button" onClick={loadSample}>
            Пример 24 ч
          </button>
          <button type="button" onClick={reset}>
            Новый курс
          </button>
          <button
            type="button"
            disabled={isCourseEmpty(course)}
            onClick={() => exportCourseMarkdown(course)}
          >
            Разметка
          </button>
          <button
            type="button"
            disabled={isCourseEmpty(course)}
            onClick={() => exportCourseJson(course)}
          >
            Данные
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
      <div className="studio-body">
        <ChatPanel
          messages={messages}
          status={status}
          error={error}
          extraReferences={extraReferences}
          onReferencesChange={setExtraReferences}
          onSend={send}
          onStop={() => stop()}
        />
        <CourseWorkspace course={course} tab={tab} onTabChange={setTab} />
      </div>
    </div>
  );
}
