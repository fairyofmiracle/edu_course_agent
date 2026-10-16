"use client";

import { useEffect, useState } from "react";
import { hasBackendStorage, listCoursesFromBackend } from "@/lib/backend-storage";
import { listLibrary, type CopyAdaptation, type CourseSummary } from "@/lib/course-library";
import { PROGRAM_KIND_LABELS, type CourseDocument } from "@/lib/course-schema";

type LibraryItem = CourseSummary & { where: "server" | "browser" };

function formatWhen(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" });
}

export function CourseLibrary({
  currentId,
  revision,
  onOpen,
  onCopy,
}: {
  currentId: string;
  revision: string;
  onOpen: (courseId: string) => Promise<void>;
  onCopy: (courseId: string, adaptation: CopyAdaptation) => Promise<string | void>;
}) {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({
    id: "",
    audience: "",
    duration: "",
    attestation: "",
    error: "",
  });

  useEffect(() => {
    const local = listLibrary(window.localStorage);
    let active = true;
    if (!hasBackendStorage()) {
      setItems(local.map((item) => ({ ...item, where: "browser" })));
      setNote("Курсы записаны в этом браузере.");
      return () => {
        active = false;
      };
    }
    void listCoursesFromBackend()
      .then((body) => {
        if (!active || !body) return;
        const serverIds = new Set(body.courses.map((item) => item.id));
        setItems([
          ...body.courses.map((item) => ({ ...item, where: "server" as const })),
          ...local
            .filter((item) => !serverIds.has(item.id))
            .map((item) => ({ ...item, where: "browser" as const })),
        ]);
        setNote("Копия сохраняет исходный курс. В ней можно сменить аудиторию и объём.");
      })
      .catch(() => {
        if (!active) return;
        setItems(local.map((item) => ({ ...item, where: "browser" })));
        setNote("Сервер списка не ответил. Показаны курсы этого браузера.");
      });
    return () => {
      active = false;
    };
  }, [currentId, revision]);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    try {
      await task();
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="course-library">
      <summary>Мои курсы</summary>
      <div>
        <p>{note}</p>
        {items.length === 0 ? (
          <p>Пока нет сохранённых курсов. Текущая программа запишется сама.</p>
        ) : (
          <ul>
            {items
              .filter((item) => item.id === currentId || item.title.trim() || item.audience.trim())
              .map((item) => {
              const kind =
                PROGRAM_KIND_LABELS[item.programKind as CourseDocument["brief"]["programKind"]] ??
                item.programKind;
              const opened = item.id === currentId;
              return (
                <li key={item.id}>
                  <strong>{item.title.trim() || "Новая образовательная программа"}</strong>
                  <span>
                    {item.audience.trim() || "Аудитория не указана"}
                    {" · "}
                    {kind}
                    {" · "}
                    {formatWhen(item.updatedAt)}
                  </span>
                  {draft.id === item.id ? (
                    <form
                      className="copy-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const durationHours = Number(draft.duration.trim().replace(",", "."));
                        const attestationHours = Number(draft.attestation.trim().replace(",", "."));
                        void run(async () => {
                          const error = await onCopy(item.id, {
                            audience: draft.audience,
                            durationHours,
                            attestationHours,
                          });
                          if (error) setDraft((current) => ({ ...current, error }));
                          else setDraft({ id: "", audience: "", duration: "", attestation: "", error: "" });
                        });
                      }}
                    >
                      <label>
                        Новая аудитория
                        <input
                          value={draft.audience}
                          onChange={(event) => setDraft((current) => ({ ...current, audience: event.target.value, error: "" }))}
                        />
                      </label>
                      <label>
                        Новый объём, ч
                        <input
                          inputMode="decimal"
                          value={draft.duration}
                          onChange={(event) => setDraft((current) => ({ ...current, duration: event.target.value, error: "" }))}
                        />
                      </label>
                      <label>
                        Аттестация, ч
                        <input
                          inputMode="decimal"
                          value={draft.attestation}
                          onChange={(event) => setDraft((current) => ({ ...current, attestation: event.target.value, error: "" }))}
                        />
                      </label>
                      {draft.error ? <p>{draft.error}</p> : null}
                      <span className="library-actions">
                        <button type="submit" className="primary" disabled={busy}>
                          Создать копию
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setDraft({ id: "", audience: "", duration: "", attestation: "", error: "" })}
                        >
                          Отмена
                        </button>
                      </span>
                    </form>
                  ) : (
                    <span className="library-actions">
                      <button type="button" disabled={busy || opened} onClick={() => void run(() => onOpen(item.id))}>
                        {opened ? "Открыт" : "Открыть"}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          setDraft({
                            id: item.id,
                            audience: item.audience,
                            duration: item.durationHours ? String(item.durationHours).replace(".", ",") : "",
                            attestation: String(item.attestationHours ?? 0).replace(".", ","),
                            error: "",
                          })
                        }
                      >
                        Копия
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </details>
  );
}
