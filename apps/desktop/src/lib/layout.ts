export type Layout = "classic" | "activity-bar";

const STORAGE_KEY = "agentica.layout";

/** The saved canvas layout; missing, unknown, or unreadable values are Classic. */
export function readLayout(): Layout {
  try {
    if (localStorage.getItem(STORAGE_KEY) === "activity-bar")
      return "activity-bar";
  } catch {
    // Storage can be unavailable; Classic still works.
  }
  return "classic";
}

/** Remember the layout for the next launch; false when storage rejected it. */
export function saveLayout(layout: Layout): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, layout);
    return true;
  } catch {
    return false;
  }
}
