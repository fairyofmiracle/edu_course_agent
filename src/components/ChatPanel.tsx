"use client";

import { displayServicePrompt } from "@/lib/agent/service-prompts";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { useEffect, useRef, useState } from "react";
import { RequestComposer } from "@/components/RequestComposer";
import { chatWaitLabel, queueWaitLabel, usageLine, workProgress } from "@/lib/job-status";
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
  const queuePart = messages
    .flatMap((message) => message.parts)
    .findLast((part) => part.type === "data-queue");
  const queueData =
    queuePart && queuePart.type === "data-queue" && queuePart.data && typeof queuePart.data === "object"
      ? (queuePart.data as { status?: string; position?: number })
      : null;
  const waitLabel =
    (pending && queueData?.status ? queueWaitLabel(queueData.status, queueData.position ?? 0) : "") ||
    chatWaitLabel(elapsedMs);
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
          <p className="pane-label">Запрос</p>
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

      <div className="messages" aria-live="polite">
        {messages.length === 0 ? null : (
          messages.map((message) => {
            const texts = message.parts.filter(
              (part): part is { type: "text"; text: string } => part.type === "text" && Boolean(part.text),
            );
            const tools = message.parts.filter(isToolUIPart);
            const asking = texts.some((part) => isIntakeAsk(part.text));
            const wrote = asking
              ? []
              : tools
                  .filter((part) => part.state !== "output-error")
                  .map((part) => TOOL_LABELS[getToolName(part)] ?? getToolName(part));
            const failed = tools.filter((part) => part.state === "output-error");
            if (texts.length === 0 && tools.length === 0 && failed.length === 0) return null;
            return (
              <article key={message.id} className={`turn ${message.role}`}>
                {texts.length > 0 ? (
                  <div className={`bubble ${message.role}`}>
                    {texts.map((part, index) => {
                      const card = message.role === "assistant" ? questionCard(part.text) : null;
                      const canAnswer = message.role === "assistant" && message.id === messages.at(-1)?.id && !pending;
                      if (!card) {
                        return (
                          <p key={`${message.id}-t-${index}`}>
                            {message.role === "user" ? displayServicePrompt(part.text) : part.text}
                          </p>
                        );
                      }
                      return (
                        <div key={`${message.id}-t-${index}`} className="ask-card">
                          {card.lead ? <p>{card.lead}</p> : null}
                          <ol>
                            {card.items.map((item) => {
                              const choices = canAnswer ? choicesFor(item) : [];
                              const aboutAttestation = /аттестац/i.test(item);
                              const aboutHours = isHoursQuestion(item);
                              return (
                                <li key={item}>
                                  <span>{item}</span>
                                  {choices.length ? (
                                    <span className="ask-choices">
                                      {choices.map((choice) => (
                                        <button
                                          key={choice.text}
                                          type="button"
                                          className={picks[item] === choice.text ? "picked" : undefined}
                                          disabled={pending}
                                          onClick={() => {
                                            if (aboutAttestation) setOwnAttestation("");
                                            setPicks((current) => {
                                              if (current[item] === choice.text) {
                                                const next = { ...current };
                                                delete next[item];
                                                return next;
                                              }
                                              return { ...current, [item]: choice.text };
                                            });
                                          }}
                                        >
                                          {choice.label}
                                        </button>
                                      ))}
                                    </span>
                                  ) : null}
                                  {canAnswer && aboutHours ? (
                                    <input
                                      className="ask-own"
                                      value={ownHours}
                                      inputMode="numeric"
                                      placeholder="Часы, например 72"
                                      disabled={pending}
                                      onChange={(event) => setOwnHours(event.target.value)}
                                    />
                                  ) : null}
                                  {canAnswer && aboutAttestation ? (
                                    <input
                                      className="ask-own"
                                      value={ownAttestation}
                                      placeholder="Свой вариант"
                                      disabled={pending}
                                      onChange={(event) => {
                                        const value = event.target.value;
                                        setOwnAttestation(value);
                                        if (value.trim()) {
                                          setPicks((current) => {
                                            const next = { ...current };
                                            for (const key of Object.keys(next)) {
                                              if (/аттестац/i.test(key)) delete next[key];
                                            }
                                            return next;
                                          });
                                        }
                                      }}
                                    />
                                  ) : null}
                                </li>
                              );
                            })}
                          </ol>
                          {canAnswer && card.items.some((item) => choicesFor(item).length > 0 || isHoursQuestion(item)) ? (
                            <button
                              type="button"
                              className="ask-send"
                              disabled={
                                pending ||
                                (!ownAttestation.trim() && !hoursAnswer(ownHours) && Object.keys(picks).length === 0)
                              }
                              onClick={() => {
                                const lines = Object.entries(picks)
                                  .filter(([item]) => !(/аттестац/i.test(item) && ownAttestation.trim()))
                                  .map(([, text]) => text);
                                const hours = hoursAnswer(ownHours);
                                if (hours) lines.push(hours);
                                if (ownAttestation.trim()) {
                                  lines.push(`Итоговая аттестация: ${ownAttestation.trim()}`);
                                }
                                if (!lines.length) return;
                                onSend(lines.join("\n"));
                                setPicks({});
                                setOwnAttestation("");
                                setOwnHours("");
                              }}
                            >
                              Ответить
                            </button>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                {wrote.length > 0 ? <p className="tool-line">В программу: {wrote.join(", ")}</p> : null}
                {failed.map((part, index) => (
                  <p key={`${message.id}-fail-${index}`} className="tool-line failed">
                    Не записалось: {TOOL_LABELS[getToolName(part)] ?? getToolName(part)}
                    {part.errorText ? ` — ${part.errorText}` : ""}
                  </p>
                ))}
              </article>
            );
          })
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
