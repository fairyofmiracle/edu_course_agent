"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { applyTheme, readTheme, storeTheme, type Theme } from "@/lib/theme";

export function SiteFrame({
  actions,
  title,
  progress,
  note,
  chatOpen = true,
  activity = null,
  children,
}: {
  actions?: () => ReactNode;
  title?: string;
  progress?: ReactNode;
  note?: string;
  chatOpen?: boolean;
  activity?: { ratio: number; label: string } | null;
  children: ReactNode;
}) {
  const [theme, setTheme] = useState<Theme>("light");
  const [faqOpen, setFaqOpen] = useState(false);

  useEffect(() => {
    const stored = readTheme(window.localStorage);
    applyTheme(stored);
    const timer = window.setTimeout(() => setTheme(stored), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
    storeTheme(window.localStorage, next);
  };

  return (
    <div className="studio" data-chat={chatOpen ? "open" : "closed"}>
      <header className="site-header">
        <div className="site-brand">
          <Link className="site-mark" href="/">
            Студия методиста
          </Link>
          {title ? <h1 className="site-title">{title}</h1> : null}
        </div>
        {activity ? (
          <div
            className="work-line"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(activity.ratio * 100)}
            aria-label={activity.label}
          >
            <span style={{ width: `${Math.round(activity.ratio * 100)}%` }} />
          </div>
        ) : null}
      </header>
      <nav className="site-nav" aria-label="Меню студии">
        <div className="top-actions">
          {actions?.()}
          <div className="nav-icons">
            <ThemeButton theme={theme} onToggle={toggleTheme} />
            <button
              type="button"
              className="faq-toggle"
              aria-expanded={faqOpen}
              aria-label="Вопросы"
              title="Вопросы"
              onClick={() => setFaqOpen((open) => !open)}
            >
              <FaqIcon />
            </button>
          </div>
        </div>
        {faqOpen ? <FaqCard onClose={() => setFaqOpen(false)} /> : null}
      </nav>
      <div className="studio-column">
        <div className="studio-main">{children}</div>
      </div>
      <footer className="site-footer">
        <div className="footer-note">
          <span>Команда not_idea</span>
          {note ? (
            <p className="save-state" aria-live="polite">
              {note}
            </p>
          ) : null}
        </div>
        {progress ?? <span>Запрос, каркас, комплект</span>}
        <span>Next.js · FastAPI · Cloud.ru</span>
      </footer>
    </div>
  );
}

function ThemeButton({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const label = theme === "dark" ? "Светлая тема" : "Тёмная тема";
  return (
    <button type="button" className="theme-toggle" aria-label={label} title={label} onClick={onToggle}>
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function FaqCard({ onClose }: { onClose: () => void }) {
  return (
    <div className="faq-card" role="dialog" aria-label="Вопросы">
      <p>Напишите в чате, для кого программа и сколько в ней часов.</p>
      <p>Лекции, семинары и тесты открываются после «Утвердить каркас».</p>
      <p>Офлайн-пример показывает готовую программу без модели.</p>
      <button type="button" onClick={onClose}>
        Закрыть
      </button>
    </div>
  );
}

function FaqIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M9.6 9.3a2.4 2.4 0 1 1 3.2 2.3c-.7.3-1.1.8-1.1 1.5V14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path d="M11.7 16.8h.1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
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
