"use client";

import { BLOOM_LABELS, type CourseDocument } from "@/lib/course-schema";

type CompetencyNode = CourseDocument["competencies"]["nodes"][number];

type CompetencyMapProps = {
  course: CourseDocument;
};

function linkedModules(course: CourseDocument, node: CompetencyNode) {
  return course.modules
    .filter((item) => item.competencyIds.includes(node.id) || node.moduleIds.includes(item.id))
    .map((item) => item.title);
}

export function CompetencyMap({ course }: CompetencyMapProps) {
  const { nodes } = course.competencies;
  if (nodes.length === 0) {
    return (
      <p className="empty-hint">
        Знания, умения и навыки появятся, когда агент соберёт компетенции, или загрузите пример.
      </p>
    );
  }

  return (
    <div className="balance">
      <div className="balance-head">
        <p className="kicker">Чему научатся</p>
        <h3>Знания, умения и навыки</h3>
        <p className="muted">По каждой компетенции: что узнают, что смогут сделать и какой навык закрепят.</p>
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
              {node.laborFunctionCode ? <p className="muted">{node.laborFunctionCode}</p> : null}
              <p className="muted">{titles.length ? titles.join(" · ") : "Модуль ещё не связан"}</p>
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
