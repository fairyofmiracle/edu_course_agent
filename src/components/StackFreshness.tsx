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
  const [report, setReport] = useState<StackFreshness | { state: "pending" }>(
    () => (key ? { state: "pending" } : { state: "empty" }),
  );

  useEffect(() => {
    const nextTexts = key ? key.split("\n") : [];
    let active = true;
    if (!key) {
      setReport({ state: "empty" });
      return () => {
        active = false;
      };
    }
    setReport({ state: "pending" });
    void checkStack(nextTexts).then((next) => {
      if (active) setReport(next);
    });
    return () => {
      active = false;
    };
  }, [key]);

  if (texts.length === 0 || report.state === "empty") return null;

  const statusBadge =
    report.state === "disabled" ? (
      <span className="check-badge off">выключено</span>
    ) : report.state === "pending" ? (
      <span className="check-badge checking">на проверке</span>
    ) : report.state === "ready" ? (
      <span className="check-badge ready">готово</span>
    ) : report.state === "down" ? (
      <span className="check-badge empty">нет связи</span>
    ) : null;

  return (
    <article className={`stack-check${report.state === "disabled" ? " disabled" : ""}`}>
      <h3>
        Сроки поддержки инструментов
        {statusBadge}
      </h3>
      {report.state === "pending" ? (
        <p className="muted-disabled">Проверяю сроки поддержки…</p>
      ) : null}
      {report.state === "disabled" ? (
        <p className="muted-disabled">Проверка сроков выключена: не задан адрес Python API. Это не ошибка — блок просто не активен без бэкенда.</p>
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
