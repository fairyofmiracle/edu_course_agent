"use client";

import { BLOOM_LABELS, type CourseDocument } from "@/lib/course-schema";

type CompetencyNode = CourseDocument["competencies"]["nodes"][number];

type CompetencyMapProps = {
  course: CourseDocument;
};

const SIZE = 640;
const CENTER = SIZE / 2;
const RADIUS = 210;

function coverage(course: CourseDocument, node: CompetencyNode) {
  const zun = [node.knowledge, node.skills, node.abilities].filter((items) => items.length > 0).length / 3;
  const linked = node.moduleIds.length > 0 || course.modules.some((item) => item.competencyIds.includes(node.id));
  const moduleIds = new Set([
    ...node.moduleIds,
    ...course.modules.filter((item) => item.competencyIds.includes(node.id)).map((item) => item.id),
  ]);
  const lecture = course.lectures.some((item) => moduleIds.has(item.moduleId));
  const seminar = course.seminars.some((item) =>
    item.tasks.some((task) => task.competencyId === node.id) || moduleIds.has(item.moduleId),
  );
  const test = course.assessments.some((item) =>
    item.questions.some((question) => question.competencyId === node.id) || moduleIds.has(item.moduleId),
  );
  const score = zun * 0.45 + (linked ? 0.1 : 0) + (lecture ? 0.15 : 0) + (seminar ? 0.15 : 0) + (test ? 0.15 : 0);
  return Math.max(0.08, Math.min(1, score));
}

function point(index: number, count: number, scale: number) {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
  return {
    x: CENTER + Math.cos(angle) * RADIUS * scale,
    y: CENTER + Math.sin(angle) * RADIUS * scale,
  };
}

export function CompetencyMap({ course }: CompetencyMapProps) {
  const { nodes } = course.competencies;
  if (nodes.length === 0) {
    return (
      <p className="empty-hint">
        Колесо появится, когда агент соберёт компетенции, или загрузите пример.
      </p>
    );
  }

  const scores = nodes.map((node) => coverage(course, node));
  const average = Math.round((scores.reduce((sum, value) => sum + value, 0) / scores.length) * 100);
  const polygon = scores
    .map((score, index) => {
      const spot = point(index, nodes.length, score);
      return `${spot.x},${spot.y}`;
    })
    .join(" ");
  const label = nodes
    .map((node, index) => `${node.name}: ${Math.round(scores[index] * 100)}%`)
    .join(". ");

  return (
    <div className="balance">
      <div className="balance-head">
        <p className="kicker">Колесо баланса</p>
        <h3>Компетенции программы</h3>
        <p className="muted">
          Радиус спицы — полнота: знания, умения, навыки, связь с модулем, лекция, задание и тест.
        </p>
      </div>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="balance-wheel" role="img" aria-label={label}>
        {[1, 0.66, 0.33].map((ring) => (
          <circle key={ring} cx={CENTER} cy={CENTER} r={RADIUS * ring} className="wheel-ring" />
        ))}
        {nodes.map((node, index) => {
          const end = point(index, nodes.length, 1);
          const spot = point(index, nodes.length, scores[index]);
          const labelPoint = point(index, nodes.length, 1.18);
          const anchor = labelPoint.x < CENTER - 8 ? "end" : labelPoint.x > CENTER + 8 ? "start" : "middle";
          return (
            <g key={node.id}>
              <line x1={CENTER} y1={CENTER} x2={end.x} y2={end.y} className="wheel-spoke" />
              <circle cx={spot.x} cy={spot.y} r={4} className="wheel-dot" />
              <text x={labelPoint.x} y={labelPoint.y} textAnchor={anchor} className="wheel-label">
                {node.name.length > 28 ? `${node.name.slice(0, 28)}…` : node.name}
              </text>
            </g>
          );
        })}
        {nodes.length >= 3 ? (
          <polygon points={polygon} className="wheel-shape" />
        ) : (
          <circle cx={CENTER} cy={CENTER} r={RADIUS * scores[0]} className="wheel-shape" />
        )}
        <text x={CENTER} y={CENTER - 8} textAnchor="middle" className="wheel-score">
          {average}%
        </text>
        <text x={CENTER} y={CENTER + 16} textAnchor="middle" className="wheel-caption">
          полнота
        </text>
      </svg>
      <div className="zun-grid">
        {nodes.map((node, index) => {
          const titles = course.modules
            .filter((item) => item.competencyIds.includes(node.id) || node.moduleIds.includes(item.id))
            .map((item) => item.title);
          return (
            <article key={node.id} className="zun-card">
              <p className="kicker">
                {node.id} · {BLOOM_LABELS[node.bloomLevel]} · {Math.round(scores[index] * 100)}%
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
