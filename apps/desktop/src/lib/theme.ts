export type Theme = "light" | "dark";

/** Surface families. `classic` is the base palette in app.css. */
export type Design = "classic" | "slate" | "sand" | "graphite";

export type Accent = "indigo" | "amber" | "emerald" | "rose" | "ocean";

export interface Appearance {
  theme: Theme;
  design: Design;
  accent: Accent;
}

const THEME_KEY = "agentica.theme";
const DESIGN_KEY = "agentica.design";
const ACCENT_KEY = "agentica.accent";

/** Offered in Settings; the hint explains how the family differs. */
export const DESIGNS: { id: Design; name: string; hint: string }[] = [
  {
    id: "classic",
    name: "Classic",
    hint: "Cool periwinkle, the original look.",
  },
  { id: "slate", name: "Slate", hint: "Neutral blue-grey, quieter surfaces." },
  { id: "sand", name: "Sand", hint: "Warm paper neutrals." },
  { id: "graphite", name: "Graphite", hint: "Monochrome, no colour cast." },
];

/**
 * Offered in Settings. `swatch` mirrors the `--accent` values in app.css so the
 * picker can preview each colour in the mode currently on screen.
 */
export const ACCENTS: {
  id: Accent;
  name: string;
  swatch: Record<Theme, string>;
}[] = [
  {
    id: "indigo",
    name: "Indigo",
    swatch: { light: "#7b7bf0", dark: "#8b8bf5" },
  },
  { id: "amber", name: "Amber", swatch: { light: "#d97706", dark: "#f59e0b" } },
  {
    id: "emerald",
    name: "Emerald",
    swatch: { light: "#0f9d76", dark: "#34d399" },
  },
  { id: "rose", name: "Rose", swatch: { light: "#e05275", dark: "#f8758a" } },
  { id: "ocean", name: "Ocean", swatch: { light: "#0d8fd9", dark: "#38bdf8" } },
];

/** Stored preference first, then the operating-system default. */
export function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // Storage can be unavailable; fall back to the system preference.
  }
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Stored design first, then the base palette. */
export function readDesign(): Design {
  try {
    const stored = localStorage.getItem(DESIGN_KEY);
    const known = DESIGNS.find((design) => design.id === stored);
    if (known) return known.id;
  } catch {
    // Storage can be unavailable; fall back to the base palette.
  }
  return "classic";
}

/** Stored accent first, then the accent each mode has always launched with. */
export function readAccent(theme: Theme): Accent {
  try {
    const stored = localStorage.getItem(ACCENT_KEY);
    const known = ACCENTS.find((accent) => accent.id === stored);
    if (known) return known.id;
  } catch {
    // Storage can be unavailable; fall back to the per-mode accent.
  }
  return theme === "dark" ? "amber" : "indigo";
}

/** Apply the appearance to the document and remember it for the next launch. */
export function applyAppearance(appearance: Appearance) {
  const root = document.documentElement;
  root.dataset.theme = appearance.theme;
  root.dataset.design = appearance.design;
  root.dataset.accent = appearance.accent;
  // Read the resulting background so the window chrome follows every design.
  const background = getComputedStyle(root).getPropertyValue("--bg").trim();
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", background || "#eef0fa");
  try {
    localStorage.setItem(THEME_KEY, appearance.theme);
    localStorage.setItem(DESIGN_KEY, appearance.design);
    localStorage.setItem(ACCENT_KEY, appearance.accent);
  } catch {
    // Storage can be unavailable; the appearance still applies for this session.
  }
}
