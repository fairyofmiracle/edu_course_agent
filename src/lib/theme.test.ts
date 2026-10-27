import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTheme, readTheme, storeTheme, THEME_KEY } from "@/lib/theme";

function memory() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

describe("theme", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("по умолчанию тёмная, светлая читается из хранилища", () => {
    const storage = memory();
    expect(readTheme(storage)).toBe("dark");
    storeTheme(storage, "light");
    expect(storage.getItem(THEME_KEY)).toBe("light");
    expect(readTheme(storage)).toBe("light");
    storeTheme(storage, "dark");
    expect(readTheme(storage)).toBe("dark");
    applyTheme("light");
  });

  it("ставит и снимает data-theme на документе", () => {
    const root = { dataset: {} as Record<string, string> };
    vi.stubGlobal("document", { documentElement: root });
    applyTheme("light");
    expect(root.dataset.theme).toBe("light");
    applyTheme("dark");
    expect(root.dataset.theme).toBeUndefined();
  });
});
