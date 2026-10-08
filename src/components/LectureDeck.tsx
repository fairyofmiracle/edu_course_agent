"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MermaidBlock } from "@/components/MermaidBlock";
import type { CourseDocument, Lecture } from "@/lib/course-schema";

type LectureDeckProps = {
  course: CourseDocument;
};

export function LectureDeck({ course }: LectureDeckProps) {
  const lectures = course.lectures;
  const [moduleId, setModuleId] = useState(lectures[0]?.moduleId ?? "");
  const [slideIndex, setSlideIndex] = useState(0);
  const [voiceState, setVoiceState] = useState<"idle" | "loading" | "playing">("idle");
  const [voiceError, setVoiceError] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const voiceAbortRef = useRef<AbortController | null>(null);
  const skipVoiceReset = useRef(true);

  const lecture: Lecture | undefined = useMemo(
    () => lectures.find((item) => item.moduleId === moduleId) ?? lectures[0],
    [lectures, moduleId],
  );
  const maxIndex = Math.max(0, (lecture?.slides.length ?? 1) - 1);
  const safeIndex = Math.min(slideIndex, maxIndex);

  useEffect(() => {
    if (skipVoiceReset.current) {
      skipVoiceReset.current = false;
      return;
    }
    voiceAbortRef.current?.abort();
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      if (audio.src.startsWith("blob:")) URL.revokeObjectURL(audio.src);
      audio.src = "";
    }
    setVoiceState("idle");
    setVoiceError("");
  }, [lecture?.moduleId, safeIndex]);

  useEffect(() => {
    if (!lecture) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "ArrowRight") {
        setSlideIndex((value) => Math.min(maxIndex, value + 1));
      }
      if (event.key === "ArrowLeft") {
        setSlideIndex((value) => Math.max(0, value - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lecture, maxIndex]);

  if (!lecture) {
    return (
      <p className="empty-hint">
        Планы лекций появятся, когда агент соберёт слайды по модулям.
      </p>
    );
  }

  const courseModule = course.modules.find((item) => item.id === lecture.moduleId);
  const slide = lecture.slides[safeIndex] ?? lecture.slides[0];

  const speak = async () => {
    if (voiceState === "loading") {
      voiceAbortRef.current?.abort();
      setVoiceState("idle");
      return;
    }
    if (voiceState === "playing") {
      audioRef.current?.pause();
      setVoiceState("idle");
      return;
    }

    const text = [slide.title, ...slide.bullets, slide.speakerNotes].filter(Boolean).join("\n");
    const controller = new AbortController();
    voiceAbortRef.current = controller;
    setVoiceState("loading");
    setVoiceError("");
    try {
      const response = await fetch("/api/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || "Не удалось озвучить слайд");
      }
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const audio = audioRef.current ?? new Audio();
      audioRef.current = audio;
      if (audio.src.startsWith("blob:")) URL.revokeObjectURL(audio.src);
      audio.src = url;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        setVoiceState("idle");
      };
      await audio.play();
      if (!controller.signal.aborted) setVoiceState("playing");
    } catch (error) {
      if (controller.signal.aborted) return;
      setVoiceState("idle");
      setVoiceError(error instanceof Error ? error.message : "Не удалось озвучить слайд");
    }
  };

  return (
    <div className="deck">
      <div className="deck-toolbar">
        <label>
          Модуль
          <select
            value={lecture.moduleId}
            onChange={(event) => {
              setModuleId(event.target.value);
              setSlideIndex(0);
            }}
          >
            {lectures.map((item) => {
              const title =
                course.modules.find((moduleItem) => moduleItem.id === item.moduleId)
                  ?.title ?? item.moduleId;
              return (
                <option key={item.moduleId} value={item.moduleId}>
                  {title}
                </option>
              );
            })}
          </select>
        </label>
        <p className="muted">
          {courseModule?.title ?? lecture.moduleId} · {lecture.durationMin} мин · слайд{" "}
          {safeIndex + 1} из {lecture.slides.length}
        </p>
      </div>

      <ol className="outline">
        {lecture.outline.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ol>

      <article className="slide-card">
        <p className="kicker">Слайд {safeIndex + 1}</p>
        <h3>{slide.title}</h3>
        <ul>
          {slide.bullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
        {slide.visualPrompt ? (
          <p className="visual-prompt">Визуал: {slide.visualPrompt}</p>
        ) : null}
        {slide.mermaid ? <MermaidBlock chart={slide.mermaid} /> : null}
        {slide.speakerNotes ? (
          <p className="speaker">{slide.speakerNotes}</p>
        ) : null}
        <div className="deck-nav">
          <button
            type="button"
            disabled={safeIndex === 0}
            onClick={() => setSlideIndex((value) => Math.max(0, value - 1))}
          >
            Назад
          </button>
          <button
            type="button"
            disabled={safeIndex >= maxIndex}
            onClick={() => setSlideIndex((value) => Math.min(maxIndex, value + 1))}
          >
            Дальше
          </button>
          <button
            type="button"
            className={voiceState === "playing" ? "speaking" : undefined}
            onClick={() => void speak()}
          >
            {voiceState === "loading" ? "Готовлю голос…" : voiceState === "playing" ? "Стоп" : "Озвучить"}
          </button>
        </div>
        {voiceError ? <p className="voice-error">{voiceError}</p> : null}
      </article>
    </div>
  );
}
