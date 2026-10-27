"use client";

import { useEffect, useRef, useState } from "react";
import type { PptxViewer } from "@aiden0z/pptx-renderer";
import type { CourseDocument } from "@/lib/course-schema";

type PreviewStatus = "work" | "ready" | "error";

function deckKey(course: CourseDocument): string {
  return JSON.stringify({
    title: course.brief.title,
    audience: course.brief.audience,
    hours: course.brief.durationHours,
    lectures: course.lectures.map((lecture) => ({
      moduleId: lecture.moduleId,
      slides: lecture.slides.map((slide) => ({
        title: slide.title,
        bullets: slide.bullets,
        mermaid: slide.mermaid ?? "",
        visual: slide.visualPrompt ?? "",
      })),
    })),
  });
}

function asArrayBuffer(value: unknown): ArrayBuffer | null {
  if (value instanceof ArrayBuffer) return value;
  if (value instanceof Uint8Array) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
  }
  return null;
}

export function PptxPreview({
  course,
  moduleId,
}: {
  course: CourseDocument;
  moduleId?: string;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<PptxViewer | null>(null);
  const courseRef = useRef(course);
  const moduleRef = useRef(moduleId);
  courseRef.current = course;
  moduleRef.current = moduleId;

  const [status, setStatus] = useState<PreviewStatus>("work");
  const [note, setNote] = useState("Собираю файл презентации");
  const [index, setIndex] = useState(0);
  const [count, setCount] = useState(0);
  const key = `${deckKey(course)}:${moduleId ?? "all"}`;

  useEffect(() => {
    const stage = stageRef.current;
    const strip = stripRef.current;
    if (!stage || !strip) return;

    let cancelled = false;
    const thumbs: Array<{ dispose(): void }> = [];

    setStatus("work");
    setNote("Собираю файл презентации");
    setIndex(0);
    setCount(0);

    const run = async () => {
      const [{ buildCoursePptxAsync }, { PptxViewer }] = await Promise.all([
        import("@/lib/export-pptx"),
        import("@aiden0z/pptx-renderer/browser"),
      ]);
      const pptx = await buildCoursePptxAsync(courseRef.current, moduleRef.current);
      const buffer = asArrayBuffer(await pptx.write({ outputType: "arraybuffer" }));
      if (!buffer) throw new Error("Файл презентации не собрался");
      if (cancelled) return;

      viewerRef.current?.destroy();
      stage.replaceChildren();
      strip.replaceChildren();

      const viewer = await PptxViewer.open(buffer, stage, {
        renderMode: "slide",
        fitMode: "contain",
        onSlideChange: (next) => {
          if (!cancelled) setIndex(next);
        },
      });
      if (cancelled) {
        viewer.destroy();
        return;
      }

      viewerRef.current = viewer;
      const total = viewer.slideCount;
      setCount(total);
      setIndex(viewer.currentSlideIndex);
      setStatus("ready");

      for (let slideIndex = 0; slideIndex < total; slideIndex += 1) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "pptx-thumb";
        button.setAttribute("aria-label", `Слайд ${slideIndex + 1}`);
        const slot = document.createElement("span");
        button.append(slot);
        const current = slideIndex;
        button.addEventListener("click", () => {
          void viewer.goToSlide(current);
        });
        strip.append(button);
        const handle = viewer.renderThumbnailToContainer(current, slot, { width: 128 });
        if (handle) thumbs.push(handle);
      }
    };

    run().catch((error: unknown) => {
      if (cancelled) return;
      setStatus("error");
      setNote("Предпросмотр не собрался. Выгрузите PPTX кнопкой «Выгрузить» в студии.");
    });

    return () => {
      cancelled = true;
      for (const thumb of thumbs) thumb.dispose();
      viewerRef.current?.destroy();
      viewerRef.current = null;
    };
  }, [key]);

  const go = (next: number) => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    void viewer.goToSlide(Math.min(Math.max(next, 0), Math.max(count - 1, 0)));
  };

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    Array.from(strip.children).forEach((child, childIndex) => {
      child.classList.toggle("active", childIndex === index);
    });
    const active = strip.children[index];
    if (active instanceof HTMLElement) {
      const left = active.offsetLeft - strip.clientWidth / 2 + active.clientWidth / 2;
      strip.scrollTo({ left, behavior: "smooth" });
    }
  }, [index, count]);

  useEffect(() => {
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
      if (event.key === "ArrowRight") go(index + 1);
      if (event.key === "ArrowLeft") go(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, count]);

  return (
    <div className="pptx-preview">
      <div className="pptx-preview-head">
        <p className="kicker">Предпросмотр файла</p>
        <p className="muted">
          {status === "ready" ? `${index + 1} / ${count}` : note}
        </p>
      </div>
      <div className="pptx-stage" ref={stageRef} aria-label="Слайд презентации" />
      {status === "error" ? <p className="voice-error">{note}</p> : null}
      <div className="pptx-strip" ref={stripRef} />
      <div className="deck-nav">
        <button type="button" disabled={status !== "ready" || index === 0} onClick={() => go(index - 1)}>
          Назад
        </button>
        <button
          type="button"
          disabled={status !== "ready" || index >= count - 1}
          onClick={() => go(index + 1)}
        >
          Вперёд
        </button>
      </div>
    </div>
  );
}
