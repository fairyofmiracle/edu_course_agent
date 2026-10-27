export const THEME_KEY = "edu-course-theme";

export type Theme = "light" | "dark";

export function readTheme(storage: Pick<Storage, "getItem">): Theme {
  return storage.getItem(THEME_KEY) === "light" ? "light" : "dark";
}

export function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  if (theme === "light") document.documentElement.dataset.theme = "light";
  else delete document.documentElement.dataset.theme;
}

export function storeTheme(storage: Pick<Storage, "setItem">, theme: Theme) {
  storage.setItem(THEME_KEY, theme);
}
