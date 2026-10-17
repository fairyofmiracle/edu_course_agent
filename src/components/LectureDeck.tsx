"use client";

import { useEffect, useMemo, useState } from "react";
import { MermaidBlock } from "@/components/MermaidBlock";
import type { CourseDocument, Lecture } from "@/lib/course-schema";

type LectureDeckProps = {
  course: CourseDocument;
};

export function LectureDeck({ course }: LectureDeckProps) {
  const lectures = course.lectures;
  const [moduleId, setModuleId] = useState(lectures[0]?.moduleId ?? "");
  const [slideIndex, setSlideIndex] = useState(0);

  const lecture: Lecture | undefined = useMemo(
    () => lectures.find((item) => item.moduleId === moduleId) ?? lectures[0],
    [lectures, moduleId],
  );
  const maxIndex = Math.max(0, (lecture?.slides.length ?? 1) - 1);
  const safeIndex = Math.min(slideIndex, maxIndex);

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
        </div>
      </article>
    </div>
  );
}
