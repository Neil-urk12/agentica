export type Theme = "light" | "dark";

const STORAGE_KEY = "agentica.theme";

/** Stored preference first, then the operating-system default. */
export function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // Storage can be unavailable; fall back to the system preference.
  }
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Apply a theme to the document and remember it for the next launch. */
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#0d0f1e" : "#eef0fa");
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage can be unavailable; the theme still applies for this session.
  }
}
