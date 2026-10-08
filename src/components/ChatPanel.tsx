"use client";

import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { useRef, useState, type FormEvent } from "react";

const TOOL_LABELS: Record<string, string> = {
  update_brief: "Бриф",
  set_competency_map: "Компетенции",
  set_structure: "Структура",
  set_lecture: "Лекция",
  set_seminar: "Семинар",
  set_assessment: "Тест",
  revise_section: "Правка",
};

const QUICK_ACTIONS = [
  {
    id: "full",
    label: "Собери весь комплект",
    text: "Собери полный комплект курса по текущему брифу: update_brief при необходимости, затем set_competency_map, set_structure и для каждого модуля set_assessment, set_seminar и set_lecture.",
  },
  {
    id: "structure",
    label: "Собери структуру",
    text: "По текущему брифу собери карту компетенций и модульную структуру. Вызови set_competency_map и set_structure.",
  },
  {
    id: "module",
    label: "Дополни первый модуль",
    text: "Возьми первый модуль без полного комплекта и сгенерируй для него set_assessment, set_seminar и set_lecture.",
  },
  {
    id: "tests",
    label: "Перегенерировать тесты",
    text: "Пересобери тесты для всех модулей: вызови set_assessment для каждого moduleId. Вопросы должны быть новыми, с ключами и привязкой к компетенциям.",
  },
];

type ChatPanelProps = {
  messages: UIMessage[];
  status: string;
  error?: Error;
  extraReferences: string;
  onReferencesChange: (value: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
};

export function ChatPanel({
  messages,
  status,
  error,
  extraReferences,
  onReferencesChange,
  onSend,
  onStop,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [busyFile, setBusyFile] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const pending = status === "submitted" || status === "streaming";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = input.trim();
    if (!text || pending) return;
    onSend(text);
    setInput("");
  };

  const attachFile = async (file: File) => {
    setBusyFile(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/extract", { method: "POST", body: form });
      const payload = (await response.json()) as { text?: string; title?: string; error?: string };
      if (!response.ok) throw new Error(payload.error || "Не удалось прочитать файл");
      const chunk = `[${payload.title}]\n${payload.text ?? ""}`;
      onReferencesChange(
        extraReferences ? `${extraReferences}\n\n${chunk}` : chunk,
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : "Ошибка файла");
    } finally {
      setBusyFile(false);
    }
  };

  const attachUrl = async () => {
    const url = window.prompt("URL референса");
    if (!url) return;
    setBusyFile(true);
    try {
      const response = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const payload = (await response.json()) as { text?: string; title?: string; error?: string };
      if (!response.ok) throw new Error(payload.error || "Не удалось скачать страницу");
      const chunk = `[${payload.title} | ${url}]\n${payload.text ?? ""}`;
      onReferencesChange(extraReferences ? `${extraReferences}\n\n${chunk}` : chunk);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Ошибка URL");
    } finally {
      setBusyFile(false);
    }
  };

  return (
    <aside className="chat">
      <header className="chat-head">
        <p className="kicker light">Агент-методист</p>
        <h1>Сборка программы</h1>
      </header>

      <div className="messages" aria-live="polite">
        {messages.length === 0 ? (
          <p className="chat-empty">
            Например: «Курс по ИИ для аналитиков, 24 часа, смешанный формат, без тяжёлой математики».
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
      </div>

      <div className="quick">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action.id}
            type="button"
            disabled={pending}
            onClick={() => onSend(action.text)}
          >
            {action.label}
          </button>
        ))}
      </div>

      <label className="refs">
        Референсы
        <textarea
          value={extraReferences}
          onChange={(event) => onReferencesChange(event.target.value)}
          placeholder="Вставьте требования, фрагменты программ, заметки..."
          rows={3}
        />
      </label>
      <div className="ref-actions">
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busyFile}>
          {busyFile ? "Читаю…" : "Файл txt/md/pdf"}
        </button>
        <button type="button" onClick={() => void attachUrl()} disabled={busyFile}>
          URL
        </button>
        <input
          ref={fileRef}
          type="file"
          hidden
          accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void attachFile(file);
            event.target.value = "";
          }}
        />
      </div>

      <form className="composer" onSubmit={submit}>
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Опишите курс или правку модуля…"
          rows={3}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              const text = input.trim();
              if (text && !pending) {
                onSend(text);
                setInput("");
              }
            }
          }}
        />
        {pending ? (
          <button type="button" onClick={onStop}>
            Стоп
          </button>
        ) : (
          <button type="submit" disabled={!input.trim()}>
            Отправить
          </button>
        )}
      </form>
    </aside>
  );
}
