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

  it("по умолчанию светлая, тёмная читается из хранилища", () => {
    const storage = memory();
    expect(readTheme(storage)).toBe("light");
    storeTheme(storage, "dark");
    expect(storage.getItem(THEME_KEY)).toBe("dark");
    expect(readTheme(storage)).toBe("dark");
    storeTheme(storage, "light");
    expect(readTheme(storage)).toBe("light");
    applyTheme("dark");
  });

  it("ставит и снимает data-theme на документе", () => {
    const root = { dataset: {} as Record<string, string> };
    vi.stubGlobal("document", { documentElement: root });
    applyTheme("dark");
    expect(root.dataset.theme).toBe("dark");
    applyTheme("light");
    expect(root.dataset.theme).toBeUndefined();
  });
});
