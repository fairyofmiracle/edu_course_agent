"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BLOOM_LABELS,
  type BloomLevel,
  type CourseDocument,
} from "@/lib/course-schema";

type CompetencyNode = CourseDocument["competencies"]["nodes"][number];

type CompetencyMapProps = {
  course: CourseDocument;
  onFixLink?: () => void;
  onGoPlan?: () => void;
};

const BLOOM_ORDER: BloomLevel[] = [
  "remember",
  "understand",
  "apply",
  "analyze",
  "evaluate",
  "create",
];

function linkedModules(course: CourseDocument, node: CompetencyNode) {
  return course.modules.filter(
    (item) => item.competencyIds.includes(node.id) || node.moduleIds.includes(item.id),
  );
}

function coverageOf(course: CourseDocument, competencyId: string) {
  const seminars = (course.seminars ?? []).filter((s) => {
    const own = (s as { competencyId?: string }).competencyId === competencyId;
    const tasks = (s as { tasks?: { competencyId?: string }[] }).tasks ?? [];
    return own || tasks.some((t) => t.competencyId === competencyId);
  }).length;
  const tests = (course.assessments ?? []).filter((a) =>
    (a.questions ?? []).some((q) => q.competencyId === competencyId),
  ).length;
  return { seminars, tests };
}

function shortId(id: string) {
  if (id.length <= 10) return id;
  return id.slice(0, 8) + "…";
}

export function CompetencyMap({ course, onFixLink, onGoPlan }: CompetencyMapProps) {
  const { nodes } = course.competencies;
  const [openId, setOpenId] = useState<string | null>(null);

  const byBloom = useMemo(() => {
    const map = new Map<BloomLevel, CompetencyNode[]>();
    for (const level of BLOOM_ORDER) map.set(level, []);
    for (const node of nodes) {
      const list = map.get(node.bloomLevel) ?? [];
      list.push(node);
      map.set(node.bloomLevel, list);
    }
    return map;
  }, [nodes]);

  const selected = openId ? nodes.find((n) => n.id === openId) ?? null : null;

  useEffect(() => {
    if (!openId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId]);

  if (nodes.length === 0) {
    return null;
  }

  return (
    <div className="balance bloom-matrix-wrap">
      <div className="balance-head">
        <p className="kicker">Чему научатся</p>
        <h3>Матрица Bloom × компетенции</h3>
        <p className="muted">Нажмите ячейку — откроются ЗУН, покрытие и связанные модули.</p>
      </div>

      <div className="bloom-matrix" role="table" aria-label="Матрица компетенций по Bloom">
        {BLOOM_ORDER.map((level) => {
          const row = byBloom.get(level) ?? [];
          return (
            <div key={level} className="bloom-row" role="row">
              <div className="bloom-row-label" role="rowheader">
                <span className="bloom-level">{BLOOM_LABELS[level]}</span>
                <span className="muted bloom-count">{row.length || "—"}</span>
              </div>
              <div className="bloom-cells" role="cell">
                {row.length === 0 ? (
                  <span className="bloom-empty-slot muted">нет компетенций</span>
                ) : (
                  row.map((node) => {
                    const linked = linkedModules(course, node);
                    const unlinked = linked.length === 0;
                    return (
                      <button
                        key={node.id}
                        type="button"
                        className={[
                          "bloom-cell",
                          openId === node.id ? "active" : "",
                          unlinked ? "unlinked" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        onClick={() => setOpenId(node.id)}
                        title={node.name}
                      >
                        <strong>{node.name}</strong>
                        <span className="bloom-cell-id mono">{shortId(node.id)}</span>
                        {unlinked ? (
                          <span className="check-badge empty bloom-unlink-badge">не связан</span>
                        ) : null}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>

      {selected ? (
        <CompetencyDrawer
          course={course}
          node={selected}
          onClose={() => setOpenId(null)}
          onFixLink={onFixLink}
          onGoPlan={onGoPlan}
        />
      ) : null}
    </div>
  );
}

function CompetencyDrawer({
  course,
  node,
  onClose,
  onFixLink,
  onGoPlan,
}: {
  course: CourseDocument;
  node: CompetencyNode;
  onClose: () => void;
  onFixLink?: () => void;
  onGoPlan?: () => void;
}) {
  const linked = linkedModules(course, node);
  const cov = coverageOf(course, node.id);
  const unlinked = linked.length === 0;

  return (
    <div className="comp-drawer-root" role="presentation">
      <button type="button" className="comp-drawer-backdrop" aria-label="Закрыть" onClick={onClose} />
      <aside className="comp-drawer" role="dialog" aria-modal="true" aria-labelledby={`comp-drawer-${node.id}`}>
        <header className="comp-drawer-head">
          <div>
            <p className="kicker">
              {node.id} · {BLOOM_LABELS[node.bloomLevel]}
            </p>
            <h3 id={`comp-drawer-${node.id}`}>{node.name}</h3>
          </div>
          <button type="button" className="comp-drawer-close" onClick={onClose} aria-label="Закрыть">
            ×
          </button>
        </header>

        <div className="comp-drawer-body">
          <p className="coverage-line">
            <span className={`check-badge ${cov.seminars ? "ready" : "empty"}`}>
              семинары {cov.seminars || "пусто"}
            </span>
            <span className={`check-badge ${cov.tests ? "ready" : "empty"}`}>
              тесты {cov.tests || "пусто"}
            </span>
          </p>

          {node.laborFunctionCode ? <p className="muted">{node.laborFunctionCode}</p> : null}
          {node.description ? <p className="muted">{node.description}</p> : null}

          <h4>Знания</h4>
          <ul>
            {(node.knowledge.length ? node.knowledge : ["—"]).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <h4>Умения</h4>
          <ul>
            {(node.skills.length ? node.skills : ["—"]).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <h4>Навыки</h4>
          <ul>
            {(node.abilities.length ? node.abilities : ["—"]).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>

          <h4>Модули</h4>
          {unlinked ? (
            <p className="comp-unlink-banner">
              <span className="check-badge empty">не связан</span>
              Модуль ещё не связан с этой компетенцией.
            </p>
          ) : (
            <ul className="comp-module-list">
              {linked.map((item) => (
                <li key={item.id}>{item.title}</li>
              ))}
            </ul>
          )}

          <div className="pane-actions comp-drawer-actions">
            {unlinked && onFixLink ? (
              <button type="button" className="primary" onClick={onFixLink}>
                Связать в чате
              </button>
            ) : null}
            {onGoPlan ? (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onGoPlan();
                }}
              >
                К плану
              </button>
            ) : null}
          </div>
        </div>
      </aside>
    </div>
  );
}
