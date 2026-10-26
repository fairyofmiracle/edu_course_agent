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
  const [panel, setPanel] = useState<"faq" | "account" | null>(null);
  const [methodistName, setMethodistName] = useState(DEFAULT_METHODIST_NAME);

  useEffect(() => {
    const stored = readTheme(window.localStorage);
    applyTheme(stored);
    const storedName = readMethodistName(window.localStorage);
    const timer = window.setTimeout(() => {
      setTheme(stored);
      setMethodistName(storedName);
    }, 0);
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
          <div className="nav-foot">
            <p className="account-name">{methodistName.trim() || DEFAULT_METHODIST_NAME}</p>
            <div className="nav-icons">
              <ThemeButton theme={theme} onToggle={toggleTheme} />
              <button
                type="button"
                className="faq-toggle"
                aria-expanded={panel === "faq"}
                aria-label="Инструкция"
                title="Инструкция"
                onClick={() => setPanel((current) => (current === "faq" ? null : "faq"))}
              >
                <FaqIcon />
              </button>
              <button
                type="button"
                className="account-toggle"
                aria-expanded={panel === "account"}
                aria-label="Настройки"
                title="Настройки"
                onClick={() => setPanel((current) => (current === "account" ? null : "account"))}
              >
                <SettingsIcon />
              </button>
            </div>
            {panel === "faq" ? <FaqCard onClose={() => setPanel(null)} /> : null}
            {panel === "account" ? (
              <AccountCard
                name={methodistName}
                onName={(next) => {
                  setMethodistName(next);
                  storeMethodistName(window.localStorage, next);
                }}
                onClose={() => setPanel(null)}
              />
            ) : null}
          </div>
        </div>
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
        {progress ?? <span />}
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

const DEFAULT_METHODIST_NAME = "Методист Методистов";
const METHODIST_NAME_KEY = "edu-course-methodist-name";

function readMethodistName(storage: Pick<Storage, "getItem">) {
  const stored = storage.getItem(METHODIST_NAME_KEY)?.trim() ?? "";
  return stored.slice(0, 80) || DEFAULT_METHODIST_NAME;
}

function storeMethodistName(storage: Pick<Storage, "setItem" | "removeItem">, name: string) {
  const next = name.trim().slice(0, 80);
  if (!next || next === DEFAULT_METHODIST_NAME) storage.removeItem(METHODIST_NAME_KEY);
  else storage.setItem(METHODIST_NAME_KEY, next);
}

function AccountCard({
  name,
  onName,
  onClose,
}: {
  name: string;
  onName: (name: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="faq-card account-card" role="dialog" aria-label="Личный кабинет">
      <h2>Личный кабинет</h2>
      <label>
        Имя
        <input
          value={name}
          maxLength={80}
          aria-label="Имя методиста"
          onChange={(event) => onName(event.target.value)}
        />
      </label>
      <p>Роль: методист</p>
      <p>Имя хранится в этом браузере. Кабинет не открывает курсы и выгрузку.</p>
      <button type="button" onClick={onClose}>
        Закрыть
      </button>
    </div>
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

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 3.4v2.1M12 18.5v2.1M3.4 12h2.1M18.5 12h2.1M6.1 6.1l1.5 1.5M16.4 16.4l1.5 1.5M17.9 6.1l-1.5 1.5M7.6 16.4l-1.5 1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
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
