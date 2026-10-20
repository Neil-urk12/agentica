import type { RuntimeResult } from "@agentica/protocol";
import {
  runCanvasTurn,
  type Budget,
  type HarnessDeps,
  type TurnResult,
} from "./canvas-harness.ts";
import { validateProvider, type ProviderConfig } from "./provider.ts";
import { isTauri } from "@tauri-apps/api/core";

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

export async function canvasToolSupport(
  model: string,
  signal?: AbortSignal,
): Promise<boolean> {
  // The free router filters models by requested features, including tools.
  if (model === DEFAULT_MODEL) return true;
  const response = await fetch("https://openrouter.ai/api/v1/models", {
    signal,
  });
  if (!response.ok)
    throw new Error(
      "Could not check the model's canvas tool support. Check your connection and retry.",
    );
  const catalog = (await response.json()) as {
    data?: { id: string; supported_parameters?: string[] }[];
  };
  const entry = catalog.data?.find((entry) => entry.id === model);
  if (!entry)
    throw new Error(
      "This model was not found in OpenRouter's catalog. Check the model in Settings.",
    );
  return entry.supported_parameters?.includes("tools") ?? false;
}

async function postChat(
  provider: ProviderConfig | undefined,
  apiKey: string,
  body: string,
  signal: AbortSignal,
) {
  const nativeHttp = provider?.kind === "custom" && isTauri();
  const send = nativeHttp
    ? (await import("@tauri-apps/plugin-http")).fetch
    : fetch;
  return send(
    `${provider?.baseUrl ?? "https://openrouter.ai/api/v1"}/chat/completions`,
    {
      method: "POST",
      signal,
      redirect: "error",
      ...(nativeHttp ? { maxRedirections: 0, connectTimeout: 30_000 } : {}),
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        ...(provider?.kind !== "custom"
          ? { "HTTP-Referer": "https://agentica.app", "X-Title": "Agentica" }
          : {}),
      },
      body,
    },
  );
}

export type ProviderCheck =
  | { result: "ok" | "key" | "unreachable" }
  | { result: "other"; detail: string };

/** Sends one tiny request with the given settings, the same way canvas calls do. */
export async function checkProvider(
  config: ProviderConfig,
  signal: AbortSignal,
): Promise<ProviderCheck> {
  let provider: ProviderConfig;
  try {
    provider = validateProvider(config);
  } catch (error) {
    return {
      result: "other",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  const body = JSON.stringify({
    model: provider.model,
    messages: [{ role: "user", content: "Reply with OK." }],
    max_tokens: 16,
  });
  let response: Response;
  try {
    response = await postChat(provider, provider.apiKey, body, signal);
  } catch (error) {
    if (signal.aborted) throw error;
    return { result: "unreachable" };
  }
  if (response.status === 401 || response.status === 403)
    return { result: "key" };
  if (!response.ok)
    return {
      result: "other",
      detail: `The AI service returned error ${response.status}. Check the model in Advanced.`,
    };
  try {
    const data = (await response.json()) as OpenRouterChatResponse | null;
    signal.throwIfAborted();
    const choice = Array.isArray(data?.choices) ? data.choices[0] : undefined;
    const content = choice?.message?.content;
    if (
      !data?.error &&
      choice?.finish_reason !== "length" &&
      typeof content === "string" &&
      content.trim()
    )
      return { result: "ok" };
  } catch (error) {
    if (signal.aborted) throw error;
  }
  return {
    result: "other",
    detail:
      "The AI service did not return a valid answer. Check the model in Advanced and your API key.",
  };
}

/** Bind the canvas agent harness to the configured provider's transport. */
export async function runCanvasAgent(
  start: RuntimeResult<"conversation.start">,
  options: {
    signal: AbortSignal;
    tools: boolean;
    read: HarnessDeps["read"];
    apiKey?: string;
    provider?: ProviderConfig;
    budget?: Budget;
    onProgress?: HarnessDeps["onProgress"];
  },
): Promise<TurnResult> {
  const provider = options.provider
    ? validateProvider(options.provider)
    : undefined;
  const nativeHttp = provider?.kind === "custom" && isTauri();
  const apiKey = (
    provider?.apiKey ??
    options.apiKey ??
    getOpenRouterApiKey()
  ).trim();
  if (!apiKey && provider?.kind !== "custom")
    throw new Error(
      "OpenRouter API key is required. Please set your API key in Settings.",
    );
  return runCanvasTurn(start, {
    signal: options.signal,
    tools: options.tools,
    read: options.read,
    budget: options.budget,
    onProgress: options.onProgress,
    label: provider?.kind === "custom" ? "Provider" : "OpenRouter",
    request: {
      model: provider?.model ?? start.turn.model,
      ...(options.tools && provider?.kind !== "custom"
        ? { provider: { require_parameters: true } }
        : {}),
    },
    post: (body, signal) =>
      postChat(provider, apiKey, body, signal).catch((error: unknown) => {
        if (signal.aborted || provider?.kind !== "custom") throw error;
        throw new Error(
          nativeHttp
            ? "Could not reach the custom provider. Check its base URL in Settings, connection, and TLS certificate. Restart the desktop app after updating it."
            : "Could not reach the custom provider. Check its base URL in Settings, connection, and CORS configuration. Redirects are unsupported; use the final API base URL.",
        );
      }),
  });
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
    } catch {}
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
