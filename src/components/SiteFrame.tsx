"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { applyTheme, readTheme, storeTheme, type Theme } from "@/lib/theme";

export function SiteFrame({
  actions,
  children,
}: {
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const stored = readTheme(window.localStorage);
    applyTheme(stored);
    const timer = window.setTimeout(() => setTheme(stored), 0);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="studio">
      <header className="site-header">
        <Link className="site-mark" href="/">
          Студия методиста
        </Link>
        <div className="top-actions">
          <button
            type="button"
            className="theme-toggle"
            aria-label={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
            title={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
            onClick={() => {
              const next = theme === "dark" ? "light" : "dark";
              setTheme(next);
              applyTheme(next);
              storeTheme(window.localStorage, next);
            }}
          >
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>
          {actions}
        </div>
      </header>
      <div className="studio-main">{children}</div>
      <footer className="site-footer">
        <span>Команда not_idea</span>
        <span>Запрос, каркас, комплект</span>
        <span>Next.js · FastAPI · Cloud.ru</span>
      </footer>
    </div>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M15.5 3.2a8.2 8.2 0 1 0 5.3 12.6A7.2 7.2 0 0 1 15.5 3.2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 3.2v2.2M12 18.6v2.2M3.2 12h2.2M18.6 12h2.2M5.8 5.8l1.6 1.6M16.6 16.6l1.6 1.6M18.2 5.8l-1.6 1.6M7.4 16.6l-1.6 1.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
