const HEADER_LABELS_KEY = "agentica.headerLabels";

/** Header controls show their text labels unless the preference says otherwise. */
export function readHeaderLabels(): boolean {
  try {
    return localStorage.getItem(HEADER_LABELS_KEY) !== "hide";
  } catch {
    // Storage can be unavailable; keep the labels for this session.
    return true;
  }
}

/** Apply the compact header preference and remember it for the next launch. */
export function applyHeaderLabels(visible: boolean) {
  document.documentElement.dataset.headerLabels = visible ? "show" : "hide";
  try {
    localStorage.setItem(HEADER_LABELS_KEY, visible ? "show" : "hide");
  } catch {
    // Storage can be unavailable; the preference still applies for this session.
  }
}
