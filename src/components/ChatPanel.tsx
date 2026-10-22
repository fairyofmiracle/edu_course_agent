"use client";

import type { TokenUsage } from "@/lib/token-usage";
import { displayServicePrompt } from "@/lib/agent/service-prompts";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { useEffect, useRef, useState } from "react";
import { RequestComposer } from "@/components/RequestComposer";
import { chatWaitLabel, usageLine, workProgress } from "@/lib/job-status";
import { userFacingError } from "@/lib/user-error";
import { useElapsed } from "@/lib/use-elapsed";
import type { CourseBrief } from "@/lib/course-schema";

const ASK_CHOICES: { test: RegExp; options: { label: string; text: string }[] }[] = [
  {
    test: /общеразвива|повышение квалификации/i,
    options: [
      { label: "Общеразвивающая", text: "Общеразвивающая программа с сертификатом" },
      { label: "Повышение квалификации", text: "Повышение квалификации с удостоверением" },
    ],
  },
  {
    test: /аттестац/i,
    options: [
      { label: "Зачёт", text: "Итоговая аттестация: зачёт" },
      { label: "Экзамен", text: "Итоговая аттестация: экзамен" },
      { label: "Защита проекта", text: "Итоговая аттестация: защита проекта" },
    ],
  },
  {
    test: /форма обучения/i,
    options: [
      { label: "Очно", text: "Форма обучения: очно" },
      { label: "Очно-заочно", text: "Форма обучения: очно-заочно" },
      { label: "Стажировка", text: "Форма обучения: стажировка" },
    ],
  },
];

function choicesFor(item: string) {
  return ASK_CHOICES.find((entry) => entry.test.test(item))?.options ?? [];
}

function isHoursQuestion(item: string) {
  return /академических часах|точный объём/i.test(item);
}

function hoursAnswer(value: string) {
  const match = value.match(/(\d{1,4})/);
  if (!match) return "";
  return `Объём: ${match[1]} академических часа`;
}

function isIntakeAsk(text: string) {
  return text.includes("Не хватает данных");
}

function questionCard(text: string) {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const items = lines.filter((line) => /^\d+\.\s+/.test(line)).map((line) => line.replace(/^\d+\.\s+/, ""));
  const canPick = items.some((item) => choicesFor(item).length > 0 || isHoursQuestion(item));
  if (!canPick) return null;
  const lead = lines.find((line) => !/^\d+\.\s+/.test(line)) ?? "";
  return { lead, items };
}

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
  tokenUsage: TokenUsage;
  status: string;
  error?: Error;
  extraReferences: string;
  frameworkApproved: boolean;
  kitComplete: boolean;
  stage: "ask" | "framework" | "kit";
  missingChecks: string[];
  onReferencesChange: (value: string) => void;
  onReferenceAdd: (reference: CourseBrief["references"][number]) => void;
  onSend: (text: string, brief?: Partial<CourseBrief>) => void;
  onStop: () => void;
  onClose?: () => void;
};

export function ChatPanel({
  messages,
  tokenUsage,
  status,
  error,
  extraReferences,
  frameworkApproved,
  kitComplete,
  stage,
  missingChecks,
  onReferencesChange,
  onReferenceAdd,
  onSend,
  onStop,
  onClose,
}: ChatPanelProps) {
  const pending = status === "submitted" || status === "streaming";
  const elapsedMs = useElapsed(pending);
  const waitLabel = chatWaitLabel(elapsedMs);
  const progress = pending ? workProgress(stage, elapsedMs) : null;
  const spent = [...messages]
    .reverse()
    .flatMap((message) => message.parts)
    .find((part) => part.type === "data-usage");
  const spentData =
    spent && spent.type === "data-usage" && spent.data && typeof spent.data === "object" ? spent.data : null;
  const spentLine = usageLine(
    spentData as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null,
  );
  const stillAsking = messages.at(-1)?.parts.some((part) => part.type === "text" && isIntakeAsk(part.text)) ?? false;
  const [doneFlash, setDoneFlash] = useState(false);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [ownAttestation, setOwnAttestation] = useState("");
  const [ownHours, setOwnHours] = useState("");
  const wasPending = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (wasPending.current && !pending) {
      setDoneFlash(true);
      const timer = window.setTimeout(() => setDoneFlash(false), 2500);
      wasPending.current = pending;
      return () => window.clearTimeout(timer);
    }
    wasPending.current = pending;
  }, [pending]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, pending, waitLabel]);

  return (
    <aside className="pane pane-write">
      {onClose ? (
        <button type="button" className="chat-edge" aria-label="Скрыть чат" title="Скрыть чат" onClick={onClose}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      ) : null}
      <header className="pane-head chat-head">
        <div>
          <h2>Чат</h2>
          {progress ? <p className="work-caption">{progress.label}</p> : null}
        </div>
        <div className="chat-head-side">
          <span className="chat-help">
            <button type="button" className="chat-help-mark" aria-describedby="chat-help-tip">
              ?
            </button>
            <p id="chat-help-tip" className="chat-help-tip" role="tooltip">
              Укажите ваш запрос
            </p>
          </span>
        </div>
      </header>

      <div className="token-usage" aria-label="Статистика токенов">
        <strong>Расход токенов за курс</strong>

        <div>
          Входящие: {tokenUsage.prompt_tokens.toLocaleString("ru-RU")}
        </div>

        <div>
          Исходящие: {tokenUsage.completion_tokens.toLocaleString("ru-RU")}
        </div>

        <div>
          Всего: {tokenUsage.total_tokens.toLocaleString("ru-RU")}
        </div>

        <div>
          Вызовов модели: {tokenUsage.calls}
        </div>
      </div>

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
                  return (
                    <p key={`${message.id}-t-${index}`}>
                      {message.role === "user"
                        ? displayServicePrompt(part.text)
                        : part.text}
                    </p>
                  );
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
        {pending ? (
          <article className="turn assistant" aria-busy="true">
            <div className="bubble assistant typing">
              <p>{waitLabel}</p>
            </div>
          </article>
        ) : null}
        {doneFlash && !pending && !stillAsking ? <p className="chat-note">Программа обновлена.</p> : null}
        {spentLine ? <p className="chat-note">{spentLine}</p> : null}
        {error ? <p className="chat-error">{userFacingError(error)}</p> : null}
        <div ref={bottomRef} />
      </div>
      {messages.length > 0 ? (
        <p className="chat-hint">
          {stage === "ask"
            ? "Часы впишите в вопрос. Тип, аттестацию и форму можно выбрать кнопками. Слушателей напишите текстом."
            : stage === "framework"
              ? missingChecks.length
                ? `В программе ещё проверить: ${missingChecks.slice(0, 2).join("; ")}.`
                : "Каркас готов. Откройте программу и утвердите его."
              : kitComplete
                ? "Комплект собран. Его можно смотреть в программе и выгружать."
                : "Каркас утверждён. Можно попросить собрать комплект."}
        </p>
      ) : null}

      <RequestComposer
        extraReferences={extraReferences}
        frameworkApproved={frameworkApproved}
        kitComplete={kitComplete}
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
