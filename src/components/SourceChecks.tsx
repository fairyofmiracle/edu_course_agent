"use client";

import { useEffect, useState } from "react";
import type { CourseDocument } from "@/lib/course-schema";
import {
  checkSources,
  parseSourceProbeKey,
  sourceProbeRequest,
  type SourceCheck,
  type SourceProbeResult,
} from "@/lib/source-check";
import {
  noticeFor,
  noticeText,
  readStamps,
  writeStamp,
  type SourceStamp,
} from "@/lib/source-watch";
import { isOfficialPublication } from "@/lib/legal-basis";

const STATE_LABEL = {
  reachable: "Сайт ответил",
  unavailable: "Сайт недоступен",
  not_found: "Страница не найдена",
  blocked: "Сайт закрыл страницу",
  not_checked: "Ссылку не открывали",
} as const;

const REQUISITE_LABEL = {
  found: "Номер документа есть на странице. Применимость подтверждает методист.",
  missing: "Номер документа на странице не найден. Источник не подтверждён.",
  unchecked: "В названии источника нет номера для сверки.",
} as const;

function formatSeen(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("ru-RU", { dateStyle: "long", timeStyle: "short" });
}

export function SourceChecks({ course }: { course: CourseDocument }) {
  const cacheKey = sourceProbeRequest(course).cacheKey;
  const [check, setCheck] = useState<SourceCheck | { state: "pending" }>(
    () => (cacheKey ? { state: "pending" } : { state: "empty" }),
  );
  const [stamps, setStamps] = useState<Record<string, SourceStamp>>(() =>
    typeof window === "undefined" ? {} : readStamps(window.localStorage),
  );

  useEffect(() => {
    const { urls, expect } = parseSourceProbeKey(cacheKey);
    let active = true;
    if (!cacheKey) {
      setCheck({ state: "empty" });
      return () => {
        active = false;
      };
    }
    setCheck({ state: "pending" });
    void checkSources(urls, { expect }).then((next) => {
      if (active) setCheck(next);
    });
    return () => {
      active = false;
    };
  }, [cacheKey]);

  useEffect(() => {
    if (check.state !== "ready") return;
    const storage = window.localStorage;
    const current = readStamps(storage);
    let remembered = false;
    for (const result of check.results) {
      const fingerprint = result.fingerprint?.trim() || "";
      if (!fingerprint || current[result.url]) continue;
      writeStamp(storage, {
        url: result.url,
        fingerprint,
        seenAt: new Date().toISOString(),
      });
      remembered = true;
    }
    if (!remembered) return;
    const timer = window.setTimeout(() => {
      setStamps(readStamps(storage));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [check]);

  function acknowledge(result: SourceProbeResult) {
    const fingerprint = result.fingerprint?.trim() || "";
    if (!fingerprint) return;
    const stamp = { url: result.url, fingerprint, seenAt: new Date().toISOString() };
    writeStamp(window.localStorage, stamp);
    setStamps((current) => ({ ...current, [result.url]: stamp }));
  }

  const statusBadge =
    check.state === "disabled" ? (
      <span className="check-badge off">выключено</span>
    ) : check.state === "pending" ? (
      <span className="check-badge checking">на проверке</span>
    ) : check.state === "empty" ? (
      <span className="check-badge empty">пусто</span>
    ) : check.state === "ready" ? (
      <span className="check-badge ready">готово</span>
    ) : check.state === "down" ? (
      <span className="check-badge empty">нет связи</span>
    ) : null;

  return (
    <article className={`source-check${check.state === "disabled" ? " disabled" : ""}`}>
      <h3>
        Ссылки на приказы
        {statusBadge}
      </h3>
      {check.state === "empty" ? (
        <p className="muted-disabled">В источниках нет http-ссылки. Файл методиста остаётся в программе, сайт по нему не открывается.</p>
      ) : null}
      {check.state === "pending" ? (
        <p className="muted-disabled">Проверяю доступность ссылок…</p>
      ) : null}
      {check.state === "disabled" ? (
        <p className="muted-disabled">Проверка сайта выключена: не задан адрес Python API. Это не ошибка — документы по ссылкам просто не подтверждаются автоматически.</p>
      ) : null}
      {check.state === "down" ? <p className="muted">{check.message}</p> : null}
      {check.state === "ready" ? (
        <ul className="audit-list">
          {check.results.map((result) => {
            const notice = noticeFor(stamps[result.url], result.fingerprint?.trim() || "");
            const text = noticeText(notice, formatSeen);
            const requisites = result.requisites ?? "unchecked";
            const official = isOfficialPublication(result.url);
            const confirmed =
              result.state === "reachable" && (official || requisites === "found");
            return (
              <li
                key={result.url}
                className={
                  notice.kind === "changed" || !confirmed
                    ? result.state === "reachable" && requisites !== "missing"
                      ? "warning"
                      : "fail"
                    : "pass"
                }
              >
                <strong>
                  {official && result.state === "reachable"
                    ? "Официальное опубликование"
                    : STATE_LABEL[result.state]}
                </strong>
                <a href={result.url} target="_blank" rel="noreferrer">
                  {result.url}
                </a>
                <span>
                  {official && result.state === "reachable"
                    ? "Это ссылка из нашего списка. Текст приказа со страницы не забираем."
                    : `${result.message} ${REQUISITE_LABEL[requisites]}`}
                </span>
                {text ? <span>{text}</span> : null}
                {notice.kind === "changed" ? (
                  <button type="button" onClick={() => acknowledge(result)}>
                    Сверила, запомнить новую отметку
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </article>
  );
}
