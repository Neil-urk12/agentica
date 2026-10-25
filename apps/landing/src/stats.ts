export async function loadStats(root: ParentNode = document): Promise<void> {
  const elements = ["visits", "downloads"].map((name) => ({
    name,
    element: root.querySelector<HTMLElement>(`[data-stat="${name}"]`),
  }));
  for (const { element } of elements) if (element) element.textContent = "—";
  let data: Record<string, unknown> = {};
  try {
    const response = await fetch("/api/stats", {
      signal: AbortSignal.timeout(7000),
    });
    if (response.ok) {
      const body: unknown = await response.json();
      if (body && typeof body === "object" && !Array.isArray(body))
        data = body as Record<string, unknown>;
    }
  } catch {
    // Static fallback also covers missing Functions during local Vite development.
  }
  for (const { name, element } of elements) {
    if (!element) continue;
    const value = data[name];
    element.textContent =
      typeof value === "number" && Number.isSafeInteger(value) && value >= 0
        ? new Intl.NumberFormat().format(value)
        : "Unavailable";
  }
}
