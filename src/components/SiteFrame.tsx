"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { applyTheme, readTheme, storeTheme, type Theme } from "@/lib/theme";
import { LAW_273, ORDER_266, ORDER_499, ORDER_629 } from "@/lib/legal-basis";

export function SiteFrame({
  actions,
  title,
  subtitle,
  crumb,
  onSample,
  note,
  chatOpen = true,
  onOpenChat,
  activity = null,
  tools = null,
  menu = true,
  children,
}: {
  actions?: () => ReactNode;
  title?: string;
  subtitle?: string;
  crumb?: { href: string; label: string };
  onSample?: () => void;
  note?: string;
  chatOpen?: boolean;
  onOpenChat?: () => void;
  activity?: { ratio: number; label: string } | null;
  tools?: ReactNode;
  menu?: boolean;
  children: ReactNode;
}) {
  const [theme, setTheme] = useState<Theme>("dark");
  const [panel, setPanel] = useState<"faq" | "account" | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
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
    <div className="studio" data-chat={chatOpen ? "open" : "closed"} data-menu={menuOpen ? "open" : "closed"} data-nav={menu ? "on" : "off"}>
      <header className="site-header">
        {menu ? (
          <button
            type="button"
            className="nav-burger"
            aria-label={menuOpen ? "Закрыть меню" : "Меню"}
            aria-expanded={menuOpen}
            onClick={() => {
              setPanel(null);
              setMenuOpen((open) => !open);
            }}
          >
            <span />
            <span />
            <span />
          </button>
        ) : null}
        <div className="site-brand">
          {title ? (
            <div className="site-heading">
              {crumb ? (
                <p className="site-crumb">
                  <a href={crumb.href}>{crumb.label}</a>
                </p>
              ) : null}
              <h1 className="site-title">{title}</h1>
              {subtitle ? <p className="site-subtitle">{subtitle}</p> : null}
            </div>
          ) : null}
        </div>
        {tools ? <div className="site-tools site-tools-header">{tools}</div> : null}
        {onOpenChat ? (
          <button
            type="button"
            className="header-chat"
            aria-label="Ассистент"
            title="Ассистент"
            onClick={() => {
              setPanel(null);
              onOpenChat();
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 8.5h12v7.2a1.5 1.5 0 0 1-1.5 1.5H10l-3.2 2.3V17H7.5A1.5 1.5 0 0 1 6 15.5v-7Z" fill="none" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </button>
        ) : null}
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
      <div className="studio-stage">
      {menuOpen ? (
        <button type="button" className="nav-scrim" aria-label="Закрыть меню" onClick={() => setMenuOpen(false)} />
      ) : null}
      <nav
        className="site-nav"
        aria-label="Меню студии"
        onClick={(event) => {
          const target = event.target as HTMLElement;
          if (target.closest("a, button")) setMenuOpen(false);
          if (target.closest(".nav-sections")) setPanel(null);
        }}
      >
        <Link className="nav-brand" href="/">
          <span className="nav-brand-text">
            <strong>Методий</strong>
            <small>студия методиста</small>
          </span>
        </Link>
        {tools ? <div className="site-tools site-tools-nav">{tools}</div> : null}
        <div className="top-actions">{actions?.()}</div>
        <div className="nav-foot">
          {note ? (
            <p className="nav-note" aria-live="polite">
              {note}
            </p>
          ) : null}
          <button
            type="button"
            className="nav-help"
            aria-pressed={panel === "faq"}
            onClick={() => setPanel((current) => (current === "faq" ? null : "faq"))}
          >
            Инструкция
          </button>
          <div className="nav-user">
            <span className="nav-avatar" aria-hidden="true">
              <span className="nav-glyph" style={{ ["--glyph" as string]: "url(/icons/user.png)" }} />
            </span>
            <span className="nav-user-text">
              <strong>{methodistName.trim() || DEFAULT_METHODIST_NAME}</strong>
              <small>Методист</small>
            </span>
            <div className="nav-icons">
              <ThemeButton theme={theme} onToggle={toggleTheme} />
              <button
                type="button"
                className="account-toggle"
                aria-pressed={panel === "account"}
                aria-label="Настройки"
                title="Настройки"
                onClick={() => setPanel((current) => (current === "account" ? null : "account"))}
              >
                <SettingsIcon />
              </button>
            </div>
          </div>
        </div>
      </nav>
      <div className="studio-column">
        <div className="studio-main">
          {panel ? (
            <SideTab
              panel={panel}
              name={methodistName}
              onSample={onSample}
              onPanel={setPanel}
              onName={(next) => {
                setMethodistName(next);
                storeMethodistName(window.localStorage, next);
              }}
            />
          ) : (
            children
          )}
        </div>
      </div>
      </div>
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

function SideTab({
  panel,
  name,
  onSample,
  onPanel,
  onName,
}: {
  panel: "faq" | "account";
  name: string;
  onSample?: () => void;
  onPanel: (panel: "faq" | "account" | null) => void;
  onName: (name: string) => void;
}) {
  return (
    <section className="side-tab">
      <nav className="journal-tabs" aria-label="Инструкция и настройки">
        <button
          type="button"
          className={panel === "faq" ? "journal-tab active" : "journal-tab"}
          onClick={() => onPanel("faq")}
        >
          Инструкция
        </button>
        <button
          type="button"
          className={panel === "account" ? "journal-tab active" : "journal-tab"}
          onClick={() => onPanel("account")}
        >
          Настройки
        </button>
      </nav>
      {panel === "faq" ? (
        <div className="side-tab-body">
          <h2>Инструкция</h2>
          <p>Напишите в чате, для кого программа и сколько в ней часов.</p>
          <p>Лекции, семинары и тесты открываются после «Утвердить каркас».</p>
          {onSample ? (
            <button
              type="button"
              className="instruction-sample"
              title="Готовая программа без модели. В проход проверяющего не входит."
              onClick={() => {
                onSample();
                onPanel(null);
              }}
            >
              Пример без модели
            </button>
          ) : null}
          <h3>С чем сверяем</h3>
          <p>Общеразвивающая программа опирается на приказ № 629. Повышение квалификации — на 273-ФЗ и приказ № 266.</p>
          <ul className="order-list">
            {[ORDER_629, LAW_273, ORDER_266, ORDER_499].map((document) => (
              <li key={document.id}>
                <strong>{document.title}</strong>
                <span>{document.note}</span>
                <a href={document.source} target="_blank" rel="noreferrer">
                  Источник
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="side-tab-body">
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
        </div>
      )}
    </section>
  );
}

function SettingsIcon() {
  return <span className="nav-glyph" style={{ ["--glyph" as string]: "url(/icons/settings.png)" }} aria-hidden="true" />;
}

function MoonIcon() {
  return <span className="nav-glyph" style={{ ["--glyph" as string]: "url(/icons/moon.png)" }} aria-hidden="true" />;
}

function SunIcon() {
  return <span className="nav-glyph" style={{ ["--glyph" as string]: "url(/icons/sun.png)" }} aria-hidden="true" />;
}
