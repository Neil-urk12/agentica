export const DEFAULT_MODEL = "openrouter/free";

const KEY_STORAGE = "agentica.openrouterApiKey";
const MODEL_STORAGE = "agentica.openrouterModel";

export function getOpenRouterApiKey(): string {
  try {
    const stored = localStorage.getItem(KEY_STORAGE);
    if (stored !== null && stored !== undefined) return stored.trim();
  } catch {
    // Storage may be unavailable
  }
  return (
    (typeof import.meta !== "undefined"
      ? (import.meta.env?.VITE_OPENROUTER_API_KEY as string | undefined)?.trim()
      : undefined) ?? ""
  );
}

export function setOpenRouterApiKey(key: string): void {
  try {
    localStorage.setItem(KEY_STORAGE, key.trim());
  } catch {
    // Storage may be unavailable
  }
}

export function getOpenRouterModel(): string {
  try {
    const stored = localStorage.getItem(MODEL_STORAGE);
    if (stored && stored.trim()) return stored.trim();
  } catch {
    // Storage may be unavailable
  }
  return (
    (typeof import.meta !== "undefined"
      ? (import.meta.env?.VITE_OPENROUTER_MODEL as string | undefined)?.trim()
      : undefined) || DEFAULT_MODEL
  );
}

export function setOpenRouterModel(model: string): void {
  try {
    localStorage.setItem(MODEL_STORAGE, model.trim() || DEFAULT_MODEL);
  } catch {
    // Storage may be unavailable
  }
}

export interface OpenRouterChatResponse {
  choices?: Array<{
    message?: {
      role?: string;
      content?: string;
    };
    finish_reason?: string;
  }>;
  error?: {
    message?: string;
    code?: number | string;
  };
}

export async function askOpenRouter(
  prompt: string,
  options?: { apiKey?: string; model?: string },
): Promise<string> {
  const apiKey = (options?.apiKey ?? getOpenRouterApiKey()).trim();
  const model =
    (options?.model ?? getOpenRouterModel()).trim() || DEFAULT_MODEL;

  if (!apiKey) {
    throw new Error(
      "OpenRouter API key is required. Please set your API key in Settings (gear icon in the top right).",
    );
  }

  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://agentica.app",
        "X-Title": "Agentica",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    const errorMessage = `OpenRouter request failed with status ${response.status}`;
    const text = await response.text();
    let detail = text;
    try {
      const errData = JSON.parse(text) as OpenRouterChatResponse;
      if (errData?.error?.message) {
        detail = errData.error.message;
      }
    } catch { }
    throw new Error(detail ? `${errorMessage}: ${detail}` : errorMessage);
  }

  const data = (await response.json()) as OpenRouterChatResponse;
  if (data.error?.message) {
    throw new Error(data.error.message);
  }

  const reply = data.choices?.[0]?.message?.content?.trim();
  if (!reply) {
    throw new Error("OpenRouter returned an empty response.");
  }

  return reply;
}
