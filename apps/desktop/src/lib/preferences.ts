const SHOW_BUTTON_TEXT_KEY = "agentica.showButtonText";

/**
 * Whether header buttons show their text labels. When false, those buttons
 * render as icons only. Defaults to true (labels shown) for first launch.
 */
export function readShowButtonText(): boolean {
  try {
    const stored = localStorage.getItem(SHOW_BUTTON_TEXT_KEY);
    if (stored === "true" || stored === "false") return stored === "true";
  } catch {
    // Storage can be unavailable; fall back to the default.
  }
  return true;
}

/** Remember the show-button-text preference for the next launch. */
export function saveShowButtonText(show: boolean): void {
  try {
    localStorage.setItem(SHOW_BUTTON_TEXT_KEY, String(show));
  } catch {
    // Storage can be unavailable; the choice still applies for this session.
  }
}
