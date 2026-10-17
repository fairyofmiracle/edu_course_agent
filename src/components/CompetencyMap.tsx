"use client";

import { BLOOM_LABELS, type CourseDocument } from "@/lib/course-schema";

const COLUMNS = [
  "remember",
  "understand",
  "apply",
  "analyze",
  "evaluate",
  "create",
] as const;

function borderPoint(
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const halfW = 86;
  const halfH = 32;
  if (dx === 0 && dy === 0) return to;
  const scaleX = dx === 0 ? Number.POSITIVE_INFINITY : halfW / Math.abs(dx);
  const scaleY = dy === 0 ? Number.POSITIVE_INFINITY : halfH / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);
  return { x: to.x - dx * scale, y: to.y - dy * scale };
}

type CompetencyMapProps = {
  course: CourseDocument;
};

export function CompetencyMap({ course }: CompetencyMapProps) {
  const { nodes, edges } = course.competencies;
  if (nodes.length === 0) {
    return (
      <p className="empty-hint">
        Карта появится, когда агент соберёт компетенции, или загрузите пример.
      </p>
    );
  }

  const width = 920;
  const columnWidth = width / COLUMNS.length;
  const positions = new Map<string, { x: number; y: number }>();

  COLUMNS.forEach((level, column) => {
    const columnNodes = nodes.filter((node) => node.bloomLevel === level);
    columnNodes.forEach((node, row) => {
      positions.set(node.id, {
        x: column * columnWidth + columnWidth / 2,
        y: 88 + row * 118,
      });
    });
  });

  const height = Math.max(
    240,
    ...[...positions.values()].map((point) => point.y + 70),
  );

  return (
    <div className="map-shell">
      <svg viewBox={`0 0 ${width} ${height}`} className="map-svg" role="img" aria-label="Карта компетенций">
        <defs>
          <marker
            id="competency-arrow"
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
          >
            <path d="M0,0 L8,4 L0,8 Z" className="map-arrow" />
          </marker>
        </defs>
        {COLUMNS.map((level, index) => (
          <text
            key={level}
            x={index * columnWidth + columnWidth / 2}
            y={28}
            textAnchor="middle"
            className="map-col"
          >
            {BLOOM_LABELS[level]}
          </text>
        ))}
        {edges.map((edge) => {
          const from = positions.get(edge.from);
          const to = positions.get(edge.to);
          if (!from || !to) return null;
          const start = borderPoint(to, from);
          const end = borderPoint(from, to);
          return (
            <line
              key={`${edge.from}-${edge.to}`}
              x1={start.x}
              y1={start.y}
              x2={end.x}
              y2={end.y}
              className="map-edge"
              markerEnd="url(#competency-arrow)"
            />
          );
        })}
        {nodes.map((node) => {
          const point = positions.get(node.id);
          if (!point) return null;
          const moduleLabel = node.moduleIds.join(", ");
          return (
            <g key={node.id} transform={`translate(${point.x}, ${point.y})`}>
              <rect x={-86} y={-28} width={172} height={64} rx={2} className="map-node" />
              <text y={-6} textAnchor="middle" className="map-id">
                {node.id}
              </text>
              <text y={14} textAnchor="middle" className="map-name">
                {node.name.length > 22 ? `${node.name.slice(0, 22)}…` : node.name}
              </text>
              <text y={28} textAnchor="middle" className="map-mod">
                {moduleLabel}
              </text>
            </g>
          );
        })}
      </svg>
      <ul className="map-legend">
        {nodes.map((node) => (
          <li key={node.id}>
            <strong>{node.id}</strong> {node.name}
            {node.laborFunctionCode ? ` · ${node.laborFunctionCode}` : ""}
            {node.knowledge.length ? ` · знания: ${node.knowledge.join("; ")}` : ""}
            {node.skills.length ? ` · умения: ${node.skills.join("; ")}` : ""}
            {node.abilities.length ? ` · навыки: ${node.abilities.join("; ")}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}
