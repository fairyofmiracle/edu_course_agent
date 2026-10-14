"use client";

import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { useEffect, useRef } from "react";
import { RequestComposer } from "@/components/RequestComposer";
import type { CourseBrief } from "@/lib/course-schema";

const TOOL_LABELS: Record<string, string> = {
  update_brief: "Бриф",
  set_competency_map: "Компетенции",
  set_structure: "Структура",
  set_lecture: "Лекция",
  set_seminar: "Семинар",
  set_assessment: "Тест",
  revise_section: "Правка",
};

type ChatPanelProps = {
  messages: UIMessage[];
  status: string;
  error?: Error;
  extraReferences: string;
  frameworkApproved: boolean;
  onReferencesChange: (value: string) => void;
  onSend: (text: string, brief?: Partial<CourseBrief>) => void;
  onStop: () => void;
};

export function ChatPanel({
  messages,
  status,
  error,
  extraReferences,
  frameworkApproved,
  onReferencesChange,
  onSend,
  onStop,
}: ChatPanelProps) {
  const pending = status === "submitted" || status === "streaming";
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, pending]);

  return (
    <aside className="pane pane-write">
      <header className="pane-head">
        <p className="pane-label">1. Сюда пишете</p>
        <h2>Запрос</h2>
        <p className="kicker">Ответ агента в этом окне. Пишете внизу: свободный текст или шаблон АЦР.</p>
      </header>

      <div className="messages" aria-live="polite">
        {messages.length === 0 ? (
          <p className="chat-empty">
            Свободный запрос — как в чате. По шаблону — поля цель, аудитория, часы, без круга уточнений.
          </p>
        ) : (
          messages.map((message) => (
            <article key={message.id} className={`bubble ${message.role}`}>
              {message.parts.map((part, index) => {
                if (part.type === "text" && part.text) {
                  return <p key={`${message.id}-t-${index}`}>{part.text}</p>;
                }
                if (isToolUIPart(part)) {
                  const name = getToolName(part);
                  const failed = part.state === "output-error";
                  return (
                    <span key={`${message.id}-tool-${index}`} className={`tool-chip ${part.state}`}>
                      {TOOL_LABELS[name] ?? name}
                      {part.state === "output-available" ? " ✓" : ""}
                      {failed ? ` — ${part.errorText || "ошибка"}` : ""}
                    </span>
                  );
                }
                return null;
              })}
            </article>
          ))
        )}
        {pending ? <p className="pending">Пишет и обновляет документ…</p> : null}
        {error ? <p className="chat-error">{error.message}</p> : null}
        <div ref={bottomRef} />
      </div>

      <RequestComposer
        extraReferences={extraReferences}
        frameworkApproved={frameworkApproved}
        pending={pending}
        onReferencesChange={onReferencesChange}
        onSend={onSend}
        onStop={onStop}
      />
    </aside>
  );
}
