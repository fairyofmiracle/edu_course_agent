"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { fileWaitLabel } from "@/lib/job-status";
import { useElapsed } from "@/lib/use-elapsed";
import {
  FORMAT_LABELS,
  LEVEL_LABELS,
  PROGRAM_KIND_LABELS,
  type CourseBrief,
  type CourseFormat,
  type CourseLevel,
} from "@/lib/course-schema";

import { FRAMEWORK_PROMPT, KIT_PROMPT } from "@/lib/agent/service-prompts";

type Mode = "free" | "template";
type ProgramKind = "general" | "qualification";

type TemplateFields = {
  programKind: ProgramKind;
  title: string;
  audience: string;
  level: CourseLevel;
  durationHours: string;
  format: CourseFormat;
  attestationForm: string;
  attestationHours: string;
  goals: string;
  extra: string;
};

const emptyTemplate = (): TemplateFields => ({
  programKind: "general",
  title: "",
  audience: "",
  level: "beginner",
  durationHours: "",
  format: "blended",
  attestationForm: "",
  attestationHours: "",
  goals: "",
  extra: "",
});

function templatePrompt(fields: TemplateFields) {
  const hours = Number(fields.durationHours) || 0;
  const attestHours = Number(fields.attestationHours) || 0;
  const kind =
    fields.programKind === "qualification"
      ? "повышение квалификации, документ — удостоверение"
      : "общеразвивающая программа, документ — сертификат";
  return [
    "Собери каркас по заполненному шаблону. Поля ниже уже даны — не задавай по ним вопросов. Если чего-то нет, поставь разумное значение и напиши допущение одним предложением.",
    `Шаблон АЦР: ${kind} (programKind: ${fields.programKind}).`,
    fields.title.trim() ? `Название: ${fields.title.trim()}.` : "",
    fields.audience.trim() ? `Аудитория: ${fields.audience.trim()}.` : "",
    `Уровень: ${LEVEL_LABELS[fields.level]}.`,
    hours > 0 ? `Объём: ровно ${hours} часов.` : "",
    `Форма: ${FORMAT_LABELS[fields.format]}.`,
    fields.attestationForm.trim() || attestHours
      ? `Аттестация: ${fields.attestationForm.trim() || "по шаблону"}, ${attestHours || 0} ч.`
      : "",
    fields.goals.trim() ? `Цель и результаты: ${fields.goals.trim()}` : "",
    fields.extra.trim() ? `Ещё: ${fields.extra.trim()}` : "",
    "Вызови update_brief со всеми этими полями, затем set_competency_map и set_structure. Часы модулей плюс аттестация равны объёму. Содержание (тесты, семинары, лекции) не пиши.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function fieldsToBrief(fields: TemplateFields): Partial<CourseBrief> {
  const hours = Number(fields.durationHours) || 0;
  const attestHours = Number(fields.attestationHours) || 0;
  return {
    programKind: fields.programKind,
    title: fields.title.trim(),
    audience: fields.audience.trim(),
    level: fields.level,
    durationHours: hours,
    format: fields.format,
    attestationForm: fields.attestationForm.trim(),
    attestationHours: attestHours,
    goals: fields.goals
      .split(/\n|;/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 12),
    constraints: fields.extra.trim() ? [fields.extra.trim()] : [],
  };
}

type RequestComposerProps = {
  extraReferences: string;
  frameworkApproved: boolean;
  kitComplete: boolean;
  stage: "ask" | "framework" | "kit";
  pending: boolean;
  onReferencesChange: (value: string) => void;
  onReferenceAdd: (reference: CourseBrief["references"][number]) => void;
  onSend: (text: string, brief?: Partial<CourseBrief>) => void;
  onStop: () => void;
};

export function RequestComposer({
  extraReferences,
  frameworkApproved,
  kitComplete,
  stage,
  pending,
  onReferencesChange,
  onReferenceAdd,
  onSend,
  onStop,
}: RequestComposerProps) {
  const [mode, setMode] = useState<Mode>("free");
  const [input, setInput] = useState("");
  const [fields, setFields] = useState<TemplateFields>(emptyTemplate);
  const [busyFile, setBusyFile] = useState(false);
  const [fileNote, setFileNote] = useState("");
  const [showRefs, setShowRefs] = useState(false);
  const [formError, setFormError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const fileElapsed = useElapsed(busyFile);

  const setField = <K extends keyof TemplateFields>(key: K, value: TemplateFields[K]) => {
    setFields((current) => ({ ...current, [key]: value }));
  };

  useEffect(() => {
    if (!fileNote.startsWith("Готово")) return;
    const timer = window.setTimeout(() => setFileNote(""), 3000);
    return () => window.clearTimeout(timer);
  }, [fileNote]);

  const readFailure = (error: unknown, fallback: string) => {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      return "Чтение заняло слишком много времени. Возьмите файл меньше или повторите.";
    }
    return error instanceof Error && error.message ? error.message : fallback;
  };

  const attachFile = async (file: File) => {
    const allowed = [".txt", ".md", ".pdf", ".docx"];
    const lower = file.name.toLowerCase();
    if (!allowed.some((ext) => lower.endsWith(ext))) {
      setFileNote("Нужен файл .txt, .md, .pdf или .docx.");
      return;
    }
    if (file.size === 0) {
      setFileNote("Файл пустой.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setFileNote("Файл больше 8 МБ.");
      return;
    }
    setBusyFile(true);
    setFileNote("");
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/extract", {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(25_000),
      });
      const payload = (await response.json()) as { text?: string; title?: string; error?: string };
      if (!response.ok) throw new Error(payload.error || "Не удалось прочитать файл");
      const chunk = `[${payload.title}]\n${payload.text ?? ""}`;
      onReferencesChange(extraReferences ? `${extraReferences}\n\n${chunk}` : chunk);
      onReferenceAdd({
        title: payload.title || file.name,
        source: file.name,
        note: "Файл загружен методистом",
      });
      setShowRefs(true);
      setFileNote(`Готово: ${payload.title || file.name}`);
    } catch (err) {
      setFileNote(readFailure(err, "Файл не разобрался."));
    } finally {
      setBusyFile(false);
    }
  };

  const attachUrl = async () => {
    const url = window.prompt("URL референса");
    if (!url) return;
    setBusyFile(true);
    setFileNote("");
    try {
      const response = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(20_000),
      });
      const payload = (await response.json()) as { text?: string; title?: string; error?: string };
      if (!response.ok) throw new Error(payload.error || "Не удалось скачать страницу");
      const chunk = `[${payload.title} | ${url}]\n${payload.text ?? ""}`;
      onReferencesChange(extraReferences ? `${extraReferences}\n\n${chunk}` : chunk);
      onReferenceAdd({
        title: payload.title || url,
        source: url,
        note: "Ссылка добавлена методистом",
      });
      setShowRefs(true);
      setFileNote(`Готово: ${payload.title || url}`);
    } catch (err) {
      setFileNote(readFailure(err, "Ссылка не открылась."));
    } finally {
      setBusyFile(false);
    }
  };

  const sendFree = () => {
    const text = input.trim();
    if (!text || pending) return;
    onSend(text);
    setInput("");
  };

  const templateHours = Number(fields.durationHours);
  const templateReady =
    fields.title.trim().length > 0 &&
    fields.audience.trim().length > 0 &&
    fields.goals.trim().length > 0 &&
    Number.isFinite(templateHours) &&
    templateHours >= 16;

  const sendTemplate = () => {
    if (pending) return;
    if (!templateReady) {
      setFormError(
        "Заполните название, аудиторию, цель и объём от 16 часов. Без этого запрос не уходит.",
      );
      return;
    }
    setFormError("");
    onSend(templatePrompt(fields), fieldsToBrief(fields));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (mode === "template") sendTemplate();
    else sendFree();
  };

  return (
    <form className="composer" onSubmit={submit}>
      <div className="mode-switch" role="tablist" aria-label="Тип запроса">
        <button
          type="button"
          role="tab"
          className={mode === "free" ? "active" : undefined}
          aria-selected={mode === "free"}
          onClick={() => setMode("free")}
        >
          Свободный
        </button>
        <button
          type="button"
          role="tab"
          className={mode === "template" ? "active" : undefined}
          aria-selected={mode === "template"}
          onClick={() => setMode("template")}
        >
          По шаблону
        </button>
      </div>

      {mode === "free" ? (
        <textarea
          id="course-request"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Например: нужен курс по кибербезопасности для студентов колледжа…"
          rows={3}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              sendFree();
            }
          }}
        />
      ) : (
        <div className="template-grid">
          <label>
            Шаблон АЦР
            <select
              value={fields.programKind}
              onChange={(event) => setField("programKind", event.target.value as ProgramKind)}
            >
              <option value="general">{PROGRAM_KIND_LABELS.general}</option>
              <option value="qualification">{PROGRAM_KIND_LABELS.qualification}</option>
            </select>
          </label>
          <label>
            Объём, часы
            <input
              type="number"
              required
              min={16}
              value={fields.durationHours}
              onChange={(event) => setField("durationHours", event.target.value)}
              placeholder="72"
            />
          </label>
          <label className="wide">
            Название
            <input
              required
              value={fields.title}
              onChange={(event) => setField("title", event.target.value)}
              placeholder="Основы кибербезопасности"
            />
          </label>
          <label className="wide">
            Аудитория
            <input
              required
              value={fields.audience}
              onChange={(event) => setField("audience", event.target.value)}
              placeholder="Студенты 2 курса колледжа"
            />
          </label>
          <label>
            Уровень
            <select
              value={fields.level}
              onChange={(event) => setField("level", event.target.value as CourseLevel)}
            >
              {Object.entries(LEVEL_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Форма
            <select
              value={fields.format}
              onChange={(event) => setField("format", event.target.value as CourseFormat)}
            >
              {Object.entries(FORMAT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Аттестация
            <input
              value={fields.attestationForm}
              onChange={(event) => setField("attestationForm", event.target.value)}
              placeholder="Сертификат / защита проекта"
            />
          </label>
          <label>
            Часы аттестации
            <input
              type="number"
              min={0}
              max={80}
              value={fields.attestationHours}
              onChange={(event) => setField("attestationHours", event.target.value)}
              placeholder="2"
            />
          </label>
          <label className="wide">
            Цель
            <textarea
              required
              rows={2}
              value={fields.goals}
              onChange={(event) => setField("goals", event.target.value)}
              placeholder="База кибербезопасности, сети, Cisco Packet Tracer"
            />
          </label>
          <label className="wide">
            Ещё, если нужно
            <input
              value={fields.extra}
              onChange={(event) => setField("extra", event.target.value)}
              placeholder="Не больше 4 часов в день, без программирования"
            />
          </label>
        </div>
      )}

      {formError && mode === "template" ? <p className="chat-error">{formError}</p> : null}
      {mode === "free" ? (
        <p className="input-hint">
          Enter отправляет запрос. Если аудитория и часы уже известны, откройте «По шаблону».
        </p>
      ) : null}

      <div className="composer-row">
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busyFile}>
          {busyFile ? "Читаю…" : "Файл"}
        </button>
        <button type="button" onClick={() => void attachUrl()} disabled={busyFile}>
          Ссылка
        </button>
        <button type="button" onClick={() => setShowRefs((value) => !value)}>
          {showRefs ? "Скрыть материал" : extraReferences ? "Материал приложен" : "Материал"}
        </button>
        <input
          ref={fileRef}
          type="file"
          hidden
          accept=".txt,.md,.pdf,.docx,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void attachFile(file);
            event.target.value = "";
          }}
        />
      </div>
      {busyFile || fileNote ? (
        <p
          className={`job-status ${fileNote && !busyFile && !fileNote.startsWith("Готово") ? "chat-error" : ""}`}
          aria-live="polite"
        >
          {busyFile ? fileWaitLabel(fileElapsed) : fileNote}
        </p>
      ) : null}
      {showRefs ? (
        <textarea
          className="refs-box"
          value={extraReferences}
          onChange={(event) => onReferencesChange(event.target.value)}
          placeholder="Текст бланка, профстандарта или старой программы"
          rows={3}
        />
      ) : null}
      <div className="composer-row send-row">
        {pending ? (
          <button type="button" onClick={onStop}>
            Стоп
          </button>
        ) : (
          <button
            type="submit"
            className="primary"
            disabled={mode === "free" ? !input.trim() : !templateReady}
          >
            {mode === "template" ? "Собрать по шаблону" : "Отправить"}
          </button>
        )}
        {stage === "framework" || (stage === "kit" && !kitComplete) ? (
          <button
            type="button"
            className={stage === "kit" ? "primary" : undefined}
            disabled={pending}
            title={
              stage === "kit"
                ? "Добавить тесты, задания и лекции к утверждённому каркасу"
                : "Заполнить недостающие части каркаса"
            }
            onClick={() => onSend(frameworkApproved ? KIT_PROMPT : FRAMEWORK_PROMPT)}
          >
            {stage === "kit" ? "Собрать комплект" : "Дособрать каркас"}
          </button>
        ) : null}
      </div>
    </form>
  );
}
