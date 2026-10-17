import type { CourseDocument } from "@/lib/course-schema";

export type OutdatedHit = {
  id: string;
  label: string;
  note: string;
  place: string;
};

const MARKERS: Array<{ id: string; pattern: RegExp; label: string; note: string }> = [
  {
    id: "flash",
    pattern: /adobe\s*flash|flash\s*player|shockwave/i,
    label: "Adobe Flash",
    note: "Проигрыватель снят с поддержки. В новой программе нужен другой формат практики.",
  },
  {
    id: "silverlight",
    pattern: /silverlight/i,
    label: "Microsoft Silverlight",
    note: "Платформа снята с поддержки.",
  },
  {
    id: "internet-explorer",
    pattern: /internet\s*explorer|\bie11\b|\bie\s*11\b/i,
    label: "Internet Explorer",
    note: "Браузер снят с поддержки. Ориентир для вёрстки и практики лучше брать из текущих браузеров.",
  },
  {
    id: "windows-xp",
    pattern: /windows\s*xp/i,
    label: "Windows XP",
    note: "Система снята с поддержки и не годится как учебная среда.",
  },
  {
    id: "python2",
    pattern: /python\s*2(?:\.7)?(?!\d)/i,
    label: "Python 2",
    note: "Ветка закрыта. Для нового набора нужен Python 3.",
  },
  {
    id: "angularjs",
    pattern: /angular\s*js/i,
    label: "AngularJS",
    note: "AngularJS снят с поддержки. Это не современный Angular.",
  },
  {
    id: "centos6",
    pattern: /centos\s*[67](?!\d)/i,
    label: "CentOS 6 или 7",
    note: "Эти выпуски сняты с поддержки. Для практики нужна текущая ветка.",
  },
  {
    id: "tensorflow1",
    pattern: /tensorflow\s*1(?!\d)/i,
    label: "TensorFlow 1",
    note: "Первая ветка снята с поддержки.",
  },
];

function places(course: CourseDocument) {
  return course.modules.flatMap((module) => {
    const rows = [
      ["название модуля", module.title],
      ...module.topics.map((topic) => ["тема", topic] as const),
      ...module.plan.map((row) => ["тема плана", row.title] as const),
      ...module.learningOutcomes.map((outcome) => ["результат", outcome] as const),
    ] as Array<readonly [string, string]>;
    return rows.map(([kind, text]) => ({
      place: `Модуль «${module.title}», ${kind}: ${text}`,
      text,
    }));
  });
}

export function findOutdated(course: CourseDocument): OutdatedHit[] {
  const hits: OutdatedHit[] = [];
  const seen = new Set<string>();
  for (const place of places(course)) {
    for (const marker of MARKERS) {
      if (!marker.pattern.test(place.text)) continue;
      const key = `${marker.id}:${place.place}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({
        id: marker.id,
        label: marker.label,
        note: marker.note,
        place: place.place,
      });
    }
  }
  return hits;
}
