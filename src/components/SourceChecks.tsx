"use client";

import { useEffect, useState } from "react";
import type { CourseDocument } from "@/lib/course-schema";
import { checkSources, type SourceCheck, type SourceProbeResult } from "@/lib/source-check";
import {
  noticeFor,
  noticeText,
  readStamps,
  writeStamp,
  type SourceStamp,
} from "@/lib/source-watch";

const STATE_LABEL = {
  reachable: "Сайт ответил",
  unavailable: "Сайт недоступен",
  not_found: "Страница не найдена",
  blocked: "Сайт закрыл страницу",
  not_checked: "Ссылку не открывали",
} as const;

function httpUrls(course: CourseDocument) {
  return course.brief.references
    .map((reference) => reference.source?.trim() || "")
    .filter((source) => /^https?:\/\//i.test(source));
}

function formatSeen(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("ru-RU", { dateStyle: "long", timeStyle: "short" });
}

export function SourceChecks({ course }: { course: CourseDocument }) {
  const urls = httpUrls(course);
  const key = urls.join("\n");
  const [check, setCheck] = useState<SourceCheck>({ state: "empty" });
  const [stamps, setStamps] = useState<Record<string, SourceStamp>>({});

  useEffect(() => {
    setStamps(readStamps(window.localStorage));
  }, []);

  useEffect(() => {
    const nextUrls = key ? key.split("\n") : [];
    let active = true;
    void checkSources(nextUrls).then((next) => {
      if (active) setCheck(next);
    });
    return () => {
      active = false;
    };
  }, [key]);

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
    if (remembered) setStamps(readStamps(storage));
  }, [check]);

  function acknowledge(result: SourceProbeResult) {
    const fingerprint = result.fingerprint?.trim() || "";
    if (!fingerprint) return;
    const stamp = { url: result.url, fingerprint, seenAt: new Date().toISOString() };
    writeStamp(window.localStorage, stamp);
    setStamps((current) => ({ ...current, [result.url]: stamp }));
  }

  return (
    <article>
      <h3>Ссылки на приказы</h3>
      {check.state === "empty" ? (
        <p className="muted">В источниках нет http-ссылки. Файл методиста остаётся в программе, сайт по нему не открывается.</p>
      ) : null}
      {check.state === "disabled" ? (
        <p className="muted">Проверка сайта выключена: не задан адрес Python API. Документы по ссылкам не подтверждены.</p>
      ) : null}
      {check.state === "down" ? <p className="muted">{check.message}</p> : null}
      {check.state === "ready" ? (
        <ul className="audit-list">
          {check.results.map((result) => {
            const notice = noticeFor(stamps[result.url], result.fingerprint?.trim() || "");
            const text = noticeText(notice, formatSeen);
            return (
              <li
                key={result.url}
                className={notice.kind === "changed" || result.state === "reachable" ? "warning" : "fail"}
              >
                <strong>{STATE_LABEL[result.state]}:</strong> {result.url}
                <span>{result.message}</span>
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
