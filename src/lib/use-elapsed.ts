"use client";

import { useEffect, useState } from "react";

export function useElapsed(active: boolean): number {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!active) {
      setElapsedMs(0);
      return;
    }
    const started = Date.now();
    setElapsedMs(0);
    const timer = window.setInterval(() => setElapsedMs(Date.now() - started), 400);
    return () => window.clearInterval(timer);
  }, [active]);

  return elapsedMs;
}
