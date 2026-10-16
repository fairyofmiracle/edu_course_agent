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
  stage: "ask" | "framework" | "kit";
  missingChecks: string[];
  onReferencesChange: (value: string) => void;
  onReferenceAdd: (reference: CourseBrief["references"][number]) => void;
  onSend: (text: string, brief?: Partial<CourseBrief>) => void;
  onStop: () => void;
};

export function ChatPanel({
  messages,
  status,
  error,
  extraReferences,
  frameworkApproved,
  stage,
  missingChecks,
  onReferencesChange,
  onReferenceAdd,
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
        <p className="pane-label">1. Начните здесь</p>
        <h2>Запрос</h2>
        <p className="kicker">
          Опишите программу своими словами или заполните точный шаблон.
        </p>
      </header>

      <div className="messages" aria-live="polite">
        {messages.length === 0 ? (
          <div className="onboarding">
            <p className="pane-label">Как это работает</p>
            <h3>Начните со свободного запроса</h3>
            <p>
              Например: «Нужен курс по Python для школьников на 16 часов».
              Если данных не хватит, студия задаст несколько вопросов одним сообщением.
            </p>
            <ol>
              <li>Опишите задачу и приложите материалы.</li>
              <li>Проверьте каркас и часы справа.</li>
              <li>Утвердите каркас, чтобы собрать тесты, задания и слайды.</li>
            </ol>
          </div>
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
        <div className="next-step">
          <strong>Следующий шаг</strong>
          <span>
            {stage === "ask"
              ? "Опишите курс внизу. Точные часы можно уточнить позже."
              : stage === "framework"
                ? missingChecks.length
                  ? `Проверьте справа: ${missingChecks.slice(0, 2).join("; ")}.`
                  : "Каркас готов: проверьте часы справа и нажмите «Утвердить каркас»."
                : "Каркас утверждён. Нажмите «Собрать комплект» внизу."}
          </span>
        </div>
        {pending ? <p className="pending">Готовит ответ и обновляет документ справа…</p> : null}
        {error ? <p className="chat-error">{error.message}</p> : null}
        <div ref={bottomRef} />
      </div>

      <RequestComposer
        extraReferences={extraReferences}
        frameworkApproved={frameworkApproved}
        stage={stage}
        pending={pending}
        onReferencesChange={onReferencesChange}
        onReferenceAdd={onReferenceAdd}
        onSend={onSend}
        onStop={onStop}
      />
    </aside>
  );
}
