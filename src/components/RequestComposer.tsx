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

import { KIT_PROMPT } from "@/lib/agent/service-prompts";
import { appendTranscript } from "@/lib/transcript";
import { userFacingError } from "@/lib/user-error";

type Mode = "free" | "template";
type ProgramKind = "general" | "qualification";
type Material = { label: string; body: string };

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
  mode: Mode;
  onModeChange: (mode: Mode) => void;
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
  mode,
  onModeChange,
  onReferencesChange,
  onReferenceAdd,
  onSend,
  onStop,
}: RequestComposerProps) {
  const setMode = (next: Mode | ((value: Mode) => Mode)) => {
    const resolved = typeof next === "function" ? next(mode) : next;
    onModeChange(resolved);
  };
  const [input, setInput] = useState("");
  const [fields, setFields] = useState<TemplateFields>(emptyTemplate);
  const [busyFile, setBusyFile] = useState(false);
  const [fileNote, setFileNote] = useState("");
  const [showRefs, setShowRefs] = useState(false);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [materialNote, setMaterialNote] = useState("");
  const [showLink, setShowLink] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [formError, setFormError] = useState("");
  const [recording, setRecording] = useState(false);
  const [voiceNote, setVoiceNote] = useState("");
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const growField = (element: HTMLTextAreaElement | null) => {
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  };

  useEffect(() => {
    growField(fieldRef.current);
  }, [input]);
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

  const publishMaterials = (next: Material[], note: string) => {
    const chunks = [...next.map((item) => item.body), note.trim()].filter(Boolean);
    onReferencesChange(chunks.join("\n\n"));
  };

  useEffect(() => {
    if (extraReferences) return;
    setMaterials((current) => (current.length === 0 ? current : []));
    setMaterialNote((current) => (current ? "" : current));
  }, [extraReferences]);

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
      const label = file.name;
      const body = `[${payload.title || file.name}]\n${payload.text ?? ""}`;
      const next = [...materials, { label, body }];
      setMaterials(next);
      publishMaterials(next, materialNote);
      onReferenceAdd({
        title: payload.title || file.name,
        source: file.name,
        note: "Файл загружен методистом",
      });
      setShowRefs(true);
      setFileNote(`Готово: ${label}`);
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
      const label = payload.title?.trim() || url;
      const body = `[${label} | ${url}]\n${payload.text ?? ""}`;
      const next = [...materials, { label, body }];
      setMaterials(next);
      publishMaterials(next, materialNote);
      onReferenceAdd({
        title: label,
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
    <form className={`composer${mode === "template" ? " composer-template" : ""}`} onSubmit={submit} noValidate>
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
          <div className="chat-compose">
            {recording ? (
              <span className="voice-wave" aria-hidden="true">
                {Array.from({ length: 28 }, (_, index) => (
                  <i key={index} style={{ animationDelay: `${(index % 7) * 0.08}s` }} />
                ))}
              </span>
            ) : null}
            <textarea
              id="course-request"
              ref={fieldRef}
              className="chat-field"
              hidden={recording}
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                growField(event.currentTarget);
              }}
              placeholder="Сообщение"
              rows={1}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  sendFree();
                }
              }}
            />
            <div className="chat-compose-actions">
              {pending ? (
                <button type="button" className="dock-send" aria-label="Стоп" title="Стоп" onClick={onStop}>
                  <StopIcon />
                </button>
              ) : (
                <button
                  type="submit"
                  className="dock-send dock-send-label"
                  aria-label="Отправить"
                  title="Отправить"
                  disabled={recording || !input.trim()}
                >
                  <SendIcon />
                  <span>Отправить</span>
                </button>
              )}
            </div>
          </div>
        ) : null}
        <div className="chat-dock-bar">
          <button
            type="button"
            className="dock-icon dock-labeled"
            title={busyFile ? "Читаю файл" : "Файл"}
            aria-label={busyFile ? "Читаю файл" : "Файл"}
            onClick={() => fileRef.current?.click()}
            disabled={busyFile || recording}
          >
            <FileIcon />
            <span className="dock-caption">Файл</span>
          </button>
          <button
            type="button"
            className="dock-icon dock-labeled"
            title="Ссылка"
            aria-label="Ссылка"
            aria-pressed={showLink}
            onClick={() => setShowLink((value) => !value)}
            disabled={busyFile}
          >
            <LinkIcon />
            <span className="dock-caption">Ссылка</span>
          </button>
          <button
            type="button"
            className="dock-icon dock-labeled"
            title={extraReferences ? "Материал приложен" : "Материал"}
            aria-label={extraReferences ? "Материал приложен" : "Материал"}
            aria-pressed={showRefs}
            onClick={() => setShowRefs((value) => !value)}
          >
            <NoteIcon />
            <span className="dock-caption">Материал</span>
          </button>
          <span className="dock-spacer" />
          {mode === "template" ? (
            pending ? (
              <button type="button" className="dock-send" aria-label="Стоп" title="Стоп" onClick={onStop}>
                <StopIcon />
              </button>
            ) : (
              <button
                type="button"
                className="dock-send dock-send-label"
                aria-label="Отправить"
                title="Отправить"
                disabled={!templateReady || pending}
                onClick={() => sendTemplate()}
              >
                <SendIcon />
                <span>Отправить</span>
              </button>
            )
          ) : null}
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

      {frameworkApproved && !kitComplete ? (
        <button
          type="button"
          className="dock-accent"
          disabled={pending}
          title="Добавить тесты, задания и лекции к утверждённому каркасу"
          onClick={() => onSend(KIT_PROMPT)}
        >
          Собрать комплект
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
        <div className="material-list">
          {materials.length === 0 ? (
            <p className="muted">Файлов пока нет.</p>
          ) : (
            <ul>
              {materials.map((item, index) => (
                <li key={`${item.label}-${index}`}>
                  <span>{item.label}</span>
                  <button
                    type="button"
                    onClick={() => {
                      const next = materials.filter((_, itemIndex) => itemIndex !== index);
                      setMaterials(next);
                      publishMaterials(next, materialNote);
                    }}
                  >
                    Убрать
                  </button>
                </li>
              ))}
            </ul>
          )}
          <textarea
            className="refs-box"
            value={materialNote}
            onChange={(event) => {
              const note = event.target.value;
              setMaterialNote(note);
              publishMaterials(materials, note);
            }}
            placeholder="Короткая пометка, если нужна"
            rows={2}
          />
        </div>
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


function FileIcon() {
  return <span className="nav-glyph" style={{ ["--glyph" as string]: "url(/icons/file.png)" }} aria-hidden="true" />;
}

function LinkIcon() {
  return <span className="nav-glyph" style={{ ["--glyph" as string]: "url(/icons/link.png)" }} aria-hidden="true" />;
}

function NoteIcon() {
  return <span className="nav-glyph" style={{ ["--glyph" as string]: "url(/icons/overview.png)" }} aria-hidden="true" />;
}


function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 17V7M8 10.5 12 6.5l4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
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
