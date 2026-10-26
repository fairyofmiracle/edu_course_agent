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
import { appendTranscript } from "@/lib/transcript";
import { userFacingError } from "@/lib/user-error";

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
  const [showLink, setShowLink] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [formError, setFormError] = useState("");
  const [recording, setRecording] = useState(false);
  const [voiceNote, setVoiceNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const voiceTimer = useRef<number | null>(null);
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
    return userFacingError(error) || fallback;
  };

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  useEffect(() => () => {
    if (voiceTimer.current !== null) window.clearTimeout(voiceTimer.current);
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    else streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const putTranscript = (spoken: string) => {
    setMode("free");
    setInput((current) => appendTranscript(current, spoken));
    setVoiceNote("Готово. Текст в поле, его можно поправить и отправить.");
  };

  const toggleVoice = async () => {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setVoiceNote("Этот браузер не записывает звук.");
      return;
    }
    setVoiceNote("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((item) =>
        MediaRecorder.isTypeSupported(item),
      );
      const media = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      const chunks: Blob[] = [];
      media.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      media.onstop = () => {
        if (voiceTimer.current !== null) window.clearTimeout(voiceTimer.current);
        voiceTimer.current = null;
        setRecording(false);
        stopTracks();
        const blob = new Blob(chunks, { type: media.mimeType || mime || "audio/webm" });
        void sendRecording(blob);
      };
      recorderRef.current = media;
      media.start();
      setRecording(true);
      setVoiceNote("Слушаю. Нажмите ещё раз, чтобы остановить. Не дольше 25 секунд.");
      voiceTimer.current = window.setTimeout(() => {
        if (media.state === "recording") media.stop();
      }, 25_000);
    } catch (error) {
      stopTracks();
      const name = error instanceof DOMException ? error.name : "";
      setVoiceNote(
        name === "NotAllowedError" || name === "SecurityError"
          ? "Нет доступа к микрофону."
          : "Не удалось начать запись.",
      );
    }
  };

  const sendRecording = async (blob: Blob) => {
    if (!blob.size) {
      setVoiceNote("Запись пустая.");
      return;
    }
    setVoiceNote("Разбираю запись…");
    try {
      const form = new FormData();
      form.set("file", blob, "speech.webm");
      const response = await fetch("/api/transcribe", {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(70_000),
      });
      const payload = (await response.json()) as { text?: string; error?: string };
      if (!response.ok) throw new Error(payload.error || "Запись не разобралась.");
      if (!payload.text?.trim()) throw new Error("В записи не слышно речи.");
      putTranscript(payload.text);
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      if (name === "TimeoutError" || name === "AbortError") {
        setVoiceNote("Запись не успела разобраться. Повторите короче.");
        return;
      }
      setVoiceNote(userFacingError(error) || "Запись не разобралась.");
    }
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
    const url = linkUrl.trim();
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
      setShowLink(false);
      setLinkUrl("");
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
      {mode === "template" ? (
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
      ) : null}

      {formError && mode === "template" ? <p className="chat-error">{formError}</p> : null}

      <div className="chat-dock">
        {mode === "free" ? (
          <textarea
            id="course-request"
            className="chat-field"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Сообщение"
            rows={2}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                sendFree();
              }
            }}
          />
        ) : null}
        <div className="chat-dock-bar">
          <button
            type="button"
            className="dock-icon"
            title={busyFile ? "Читаю файл" : "Файл"}
            aria-label={busyFile ? "Читаю файл" : "Файл"}
            onClick={() => fileRef.current?.click()}
            disabled={busyFile || recording}
          >
            <FileIcon />
          </button>
          <button
            type="button"
            className="dock-icon"
            title={recording ? "Стоп запись" : "Голос"}
            aria-label={recording ? "Стоп запись" : "Голос"}
            aria-pressed={recording}
            onClick={() => void toggleVoice()}
            disabled={busyFile || pending}
          >
            <MicIcon />
          </button>
          <button
            type="button"
            className="dock-icon"
            title="Ссылка"
            aria-label="Ссылка"
            aria-pressed={showLink}
            onClick={() => setShowLink((value) => !value)}
            disabled={busyFile}
          >
            <LinkIcon />
          </button>
          <button
            type="button"
            className="dock-icon"
            title={extraReferences ? "Материал приложен" : "Материал"}
            aria-label={extraReferences ? "Материал приложен" : "Материал"}
            aria-pressed={showRefs}
            onClick={() => setShowRefs((value) => !value)}
          >
            <NoteIcon />
          </button>
          <button
            type="button"
            className="dock-icon"
            title={mode === "template" ? "Свободный запрос" : "По шаблону"}
            aria-label={mode === "template" ? "Свободный запрос" : "По шаблону"}
            aria-pressed={mode === "template"}
            onClick={() => setMode((value) => (value === "free" ? "template" : "free"))}
          >
            <TemplateIcon />
          </button>
          <span className="dock-spacer" />
          {pending ? (
            <button type="button" className="dock-send" aria-label="Стоп" title="Стоп" onClick={onStop}>
              <StopIcon />
            </button>
          ) : (
            <button
              type="submit"
              className="dock-send"
              aria-label={mode === "template" ? "Собрать по шаблону" : "Отправить"}
              title={mode === "template" ? "Собрать по шаблону" : "Отправить"}
              disabled={recording || (mode === "free" ? !input.trim() : !templateReady)}
            >
              <SendIcon />
            </button>
          )}
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
      </div>

      {stage === "framework" || (stage === "kit" && !kitComplete) ? (
        <button
          type="button"
          className="dock-quiet"
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

      {voiceNote ? (
        <p className={`job-status ${voiceNote.startsWith("Готово") || voiceNote.startsWith("Слушаю") || voiceNote.startsWith("Разбираю") ? "" : "chat-error"}`} aria-live="polite">
          {voiceNote}
        </p>
      ) : null}
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
      {showLink ? (
        <div className="composer-row link-row">
          <input
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.target.value)}
            placeholder="https://"
            inputMode="url"
            aria-label="Ссылка"
          />
          <button type="button" disabled={busyFile || !linkUrl.trim()} onClick={() => void attachUrl()}>
            {busyFile ? "Читаю…" : "Добавить"}
          </button>
        </div>
      ) : null}
    </form>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="3.5" width="6" height="10" rx="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M6.5 11.5a5.5 5.5 0 0 0 11 0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M12 17v3M9 20h6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 4.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9.5A1.5 1.5 0 0 1 5.5 19V6A1.5 1.5 0 0 1 7 4.5z" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M14 4.5V9h4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10 13.5l4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M8.5 15.5l-1.2 1.2a3.2 3.2 0 0 1-4.5-4.5l2.4-2.4a3.2 3.2 0 0 1 4.5 0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M15.5 8.5l1.2-1.2a3.2 3.2 0 0 1 4.5 4.5l-2.4 2.4a3.2 3.2 0 0 1-4.5 0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function NoteIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 5.5h10a1.5 1.5 0 0 1 1.5 1.5v8.2L14.2 19.5H7A1.5 1.5 0 0 1 5.5 18V7A1.5 1.5 0 0 1 7 5.5z" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M14 19.2V15h4.2M8.5 9.5h6M8.5 12.5h4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function TemplateIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6.5h12M6 12h12M6 17.5h7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 17V7M8 10.5L12 6.5l4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="8" y="8" width="8" height="8" rx="1.5" fill="currentColor" />
    </svg>
  );
}
