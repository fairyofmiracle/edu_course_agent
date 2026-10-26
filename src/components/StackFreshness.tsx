"use client";

import { useEffect, useState } from "react";
import type { CourseDocument } from "@/lib/course-schema";
import { checkStack, stackTexts, type StackFreshness, type StackHit } from "@/lib/stack-freshness";

const STATUS_LABEL = {
  supported: "Поддержка продолжается",
  eol: "Срок поддержки закончился",
  unknown: "Срок не подтверждён",
  unavailable: "Каталог не ответил",
} as const;

function tone(hit: StackHit) {
  if (hit.status === "supported") return "pass";
  if (hit.status === "eol" || hit.status === "unavailable") return "warning";
  return "fail";
}

export function StackFreshnessPanel({ course }: { course: CourseDocument }) {
  const texts = stackTexts(course);
  const key = texts.join("\n");
  const [report, setReport] = useState<StackFreshness>({ state: "empty" });

  useEffect(() => {
    const nextTexts = key ? key.split("\n") : [];
    let active = true;
    void checkStack(nextTexts).then((next) => {
      if (active) setReport(next);
    });
    return () => {
      active = false;
    };
  }, [key]);

  if (texts.length === 0 || report.state === "empty") return null;

  return (
    <article>
      <h3>Сроки поддержки инструментов</h3>
      {report.state === "disabled" ? (
        <p className="muted">Проверка сроков выключена: не задан адрес Python API.</p>
      ) : null}
      {report.state === "down" ? <p className="muted">{report.message}</p> : null}
      {report.state === "ready" ? (
        <ul className="audit-list">
          {report.hits.map((hit) => (
            <li key={hit.id} className={tone(hit)}>
              <strong>{STATUS_LABEL[hit.status]}:</strong> {hit.label}
              <span>
                {hit.detail} {hit.place}
              </span>
              <span>{hit.source}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}
