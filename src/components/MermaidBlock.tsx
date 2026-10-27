"use client";

import { useEffect, useRef, useState } from "react";

type MermaidBlockProps = {
  chart: string;
  className?: string;
};

export function MermaidBlock({ chart, className }: MermaidBlockProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const render = async () => {
      if (!chart.trim()) return;
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "neutral",
          securityLevel: "strict",
          fontFamily: "IBM Plex Sans, sans-serif",
        });
        const id = `mmd-${Math.random().toString(36).slice(2)}`;
        const { svg } = await mermaid.render(id, chart);
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
          setError(null);
        }
      } catch {
        if (!cancelled) setError("Не удалось отрисовать схему");
      }
    };
    void render();
    return () => {
      cancelled = true;
    };
  }, [chart]);

  if (error) {
    return <pre className={`mermaid-fallback ${className ?? ""}`}>{chart}</pre>;
  }

  return <div ref={containerRef} className={`mermaid-wrap ${className ?? ""}`} />;
}
