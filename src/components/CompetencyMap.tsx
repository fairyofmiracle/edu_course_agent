"use client";

import { BLOOM_LABELS, type CourseDocument } from "@/lib/course-schema";

type CompetencyNode = CourseDocument["competencies"]["nodes"][number];

type CompetencyMapProps = {
  course: CourseDocument;
  onFixLink?: () => void;
};

function linkedModules(course: CourseDocument, node: CompetencyNode) {
  return course.modules
    .filter((item) => item.competencyIds.includes(node.id) || node.moduleIds.includes(item.id))
    .map((item) => item.title);
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

export function CompetencyMap({ course, onFixLink }: CompetencyMapProps) {
  const { nodes } = course.competencies;
  if (nodes.length === 0) {
    return null;
  }

  return (
    <div className="balance">
      <div className="balance-head">
        <p className="kicker">Чему научатся</p>
        <h3>Знания, умения и навыки</h3>
      </div>
      <div className="zun-grid">
        {nodes.map((node) => {
          const titles = linkedModules(course, node);
          return (
            <article key={node.id} className="zun-card">
              <p className="kicker">
                {node.id} · {BLOOM_LABELS[node.bloomLevel]}
              </p>
              <h3>{node.name}</h3>
              {(() => { const cov = coverageOf(course, node.id); return <p className="muted coverage-line">Семинары: {cov.seminars} · Тесты: {cov.tests}</p>; })()}
              {node.laborFunctionCode ? <p className="muted">{node.laborFunctionCode}</p> : null}
              <p className="muted">{titles.length ? titles.join(" · ") : "Модуль ещё не связан"}{!titles.length && onFixLink ? <>{" "}<button type="button" className="text-action" onClick={onFixLink}>Связать в чате</button></> : null}</p>
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
            </article>
          );
        })}
      </div>
    </div>
  );
}
