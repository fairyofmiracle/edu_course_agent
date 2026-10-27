"use client";

import { useState } from "react";
import { PptxPreview } from "@/components/PptxPreview";
import { exportCoursePptx } from "@/lib/export-pptx";
import type { CourseDocument } from "@/lib/course-schema";

type LectureDeckProps = {
  course: CourseDocument;
};

export function LectureDeck({ course }: LectureDeckProps) {
  const lectures = course.lectures;
  const [openId, setOpenId] = useState<string | null>(null);

  if (lectures.length === 0) {
    return null;
  }

  return (
    <div className="file-shelf">
      <ul className="file-list">
        {lectures.map((lecture) => {
          const courseModule = course.modules.find((item) => item.id === lecture.moduleId);
          const title = courseModule?.title ?? lecture.moduleId;
          const open = openId === lecture.moduleId;
          return (
            <li key={lecture.moduleId} className={open ? "open" : ""}>
              <div className="file-row">
                <div>
                  <p className="kicker">Презентация</p>
                  <strong>{title}</strong>
                  <p className="muted">
                    {lecture.slides.length} слайдов · {lecture.durationMin} мин
                    {courseModule ? ` · ${courseModule.lectureHours} ч` : ""}
                  </p>
                </div>
                <div className="deck-nav">
                  <button type="button" onClick={() => setOpenId(open ? null : lecture.moduleId)}>
                    {open ? "Закрыть" : "Открыть"}
                  </button>
                  <button type="button" onClick={() => void exportCoursePptx(course, lecture.moduleId)}>
                    Скачать
                  </button>
                </div>
              </div>
              {open ? <PptxPreview course={course} moduleId={lecture.moduleId} /> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
