import type { CourseDocument } from "@/lib/course-schema";

import {
  presentationDocumentSchema,
  type PresentationDocument,
  type SlideElement,
} from "@/lib/presentation/slide-schema";

export function courseToPresentation(
  course: CourseDocument,
  moduleId?: string,
): PresentationDocument {
  const lectures = moduleId
    ? course.lectures.filter(
        (lecture) => lecture.moduleId === moduleId,
      )
    : course.lectures;

  const slides: PresentationDocument["slides"] = [];

  for (const lecture of lectures) {
    const courseModule = course.modules.find(
      (entry) => entry.id === lecture.moduleId,
    );

    for (const [index, source] of lecture.slides.entries()) {
      const elements: SlideElement[] = [
        {
          type: "text",
          text: courseModule?.title ?? lecture.moduleId,
          x: 0.65,
          y: 0.35,
          w: 10.9,
          h: 0.3,
          fontSize: 10,
          bold: true,
          color: "2456D8",
        },
        {
          type: "text",
          text: `${index + 1} / ${lecture.slides.length}`,
          x: 11.7,
          y: 0.35,
          w: 0.9,
          h: 0.3,
          fontSize: 10,
          bold: false,
          color: "6B7280",
        },
        {
          type: "text",
          text: source.title,
          x: 0.65,
          y: 0.95,
          w: 11.7,
          h: 0.8,
          fontSize: 28,
          bold: true,
          color: "18233B",
        },
        {
          type: "shape",
          shape: "rect",
          x: 0.65,
          y: 1.9,
          w: 4.8,
          h: 0.04,
          fill: "2456D8",
        },
      ];

      const hasDiagram = Boolean(source.mermaid);

      elements.push({
        type: "text",
        text: source.bullets.map(
          (bullet) => `• ${bullet}`,
        ).join("\n"),
        x: 0.85,
        y: 2.25,
        w: 11,
        h: hasDiagram || source.visualPrompt ? 2.3 : 3.8,
        fontSize: 20,
        bold: false,
        color: "384253",
      });

      if (source.mermaid) {
        elements.push({
          type: "diagram",
          mermaid: source.mermaid,
          x: 1,
          y: 4.7,
          w: 10.8,
          h: 1.8,
        });
      } else if (source.visualPrompt) {
        elements.push({
          type: "shape",
          shape: "roundRect",
          x: 0.85,
          y: 5.15,
          w: 11,
          h: 1.15,
          fill: "EEF2F8",
        });

        elements.push({
          type: "text",
          text: `Визуал: ${source.visualPrompt}`,
          x: 1.05,
          y: 5.35,
          w: 10.6,
          h: 0.75,
          fontSize: 14,
          bold: false,
          color: "4F5B6B",
        });
      }

      slides.push({
        title: source.title,
        elements,
        speakerNotes: source.speakerNotes,
      });
    }
  }

  return presentationDocumentSchema.parse({
    title: course.brief.title || "Материалы лекций",
    slides,
  });
}
