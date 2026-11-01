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
  return "";
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
  return DEFAULT_MODEL;
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

/**
 * Whether OpenRouter's catalog lists `image` among the model's input
 * modalities. Router IDs such as openrouter/free are checked the same way:
 * unlike tools, image input is not a filter the router guarantees. Throws when
 * capability cannot be established, so images are neither sent nor dropped.
 */
export async function imageInputSupport(
  model: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const unknown = (reason: string) =>
    new Error(
      `${reason} Retry, or choose a model that accepts images in Settings. The selected images were not sent.`,
    );
  let response: Response;
  try {
    response = await fetch("https://openrouter.ai/api/v1/models", { signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw unknown("Could not check whether this model accepts images.");
  }
  if (!response.ok)
    throw unknown("Could not check whether this model accepts images.");
  const catalog = (await response.json().catch(() => null)) as {
    data?: { id: string; architecture?: { input_modalities?: unknown } }[];
  } | null;
  const entry = catalog?.data?.find((entry) => entry.id === model);
  if (!entry)
    throw unknown(
      `${model} is not in OpenRouter's catalog, so its image support is unknown.`,
    );
  const modalities = entry.architecture?.input_modalities;
  if (!Array.isArray(modalities))
    throw unknown(`OpenRouter does not list the input types ${model} accepts.`);
  return modalities.includes("image");
}

/** The model's context window in tokens from OpenRouter's public catalog, if listed. */
export async function contextWindow(
  model: string,
  signal?: AbortSignal,
): Promise<number | undefined> {
  const response = await fetch("https://openrouter.ai/api/v1/models", {
    signal,
  });
  if (!response.ok) return undefined;
  const catalog = (await response.json()) as {
    data?: { id: string; context_length?: unknown }[];
  };
  const size = catalog.data?.find(
    (entry) => entry.id === model,
  )?.context_length;
  return Number.isSafeInteger(size) && (size as number) > 0
    ? (size as number)
    : undefined;
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

const CHECK_TIMEOUT_MS = 30_000;

/** The message in an error body, if the provider sent one. */
function errorDetail(body: string): string {
  let text = body;
  try {
    const data = JSON.parse(body) as {
      detail?: unknown;
      message?: unknown;
      error?: { message?: unknown } | string;
    };
    const message =
      typeof data.error === "string"
        ? data.error
        : (data.error?.message ?? data.detail ?? data.message);
    text = typeof message === "string" ? message : "";
  } catch {
    // Plain-text bodies are shown as received; HTML pages are not.
    if (/^\s*</.test(body)) text = "";
  }
  return text.replace(/\s+/g, " ").trim().slice(0, 200);
}

/** Never echo the key back, even if a provider includes it in an error. */
function redact(text: string, key: string): string {
  return key.length >= 8 ? text.replaceAll(key, "[redacted]") : text;
}

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
  // A check that never answers should report, not wait for the turn limit.
  const timer = new AbortController();
  const stop = () => timer.abort(signal.reason);
  signal.addEventListener("abort", stop, { once: true });
  const timeout = setTimeout(() => timer.abort(), CHECK_TIMEOUT_MS);
  try {
    signal.throwIfAborted();
    const response = await postChat(
      provider,
      provider.apiKey,
      body,
      timer.signal,
    );
    signal.throwIfAborted();
    timer.signal.throwIfAborted();
    if (response.status === 401 || response.status === 403)
      return { result: "key" };
    if (!response.ok) {
      // The provider's own message names retired or unknown models.
      const reason = redact(
        errorDetail(
          await response.text().catch((error) => {
            if (timer.signal.aborted) throw error;
            return "";
          }),
        ),
        provider.apiKey,
      );
      signal.throwIfAborted();
      timer.signal.throwIfAborted();
      return {
        result: "other",
        detail: `The AI service returned error ${response.status}${reason ? `: ${reason}` : ""}. Check the model in Advanced.`,
      };
    }
    try {
      const data = (await response.json()) as OpenRouterChatResponse | null;
      signal.throwIfAborted();
      timer.signal.throwIfAborted();
      const choice = Array.isArray(data?.choices) ? data.choices[0] : undefined;
      const content = choice?.message?.content;
      if (!data?.error && typeof content === "string" && content.trim())
        return { result: "ok" };
      // Reasoning models can spend the probe's tiny token budget before writing
      // an answer. A truncated completion still proves the endpoint, key, and
      // model work, so the check should not call a working provider broken.
      if (!data?.error && choice?.message && choice.finish_reason === "length")
        return { result: "ok" };
    } catch (error) {
      if (timer.signal.aborted) throw error;
    }
    return {
      result: "other",
      detail:
        "The AI service did not return a valid answer. Check the model in Advanced and your API key.",
    };
  } catch (error) {
    if (signal.aborted) throw error;
    if (timer.signal.aborted)
      return {
        result: "other",
        detail: `No answer within ${CHECK_TIMEOUT_MS / 1000} seconds. The service may be slow or unreachable; check the server address and model.`,
      };
    return { result: "unreachable" };
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", stop);
  }
}

/** Bind the canvas agent harness to the configured provider's transport. */
export async function runCanvasAgent(
  start: RuntimeResult<"conversation.start">,
  options: {
    signal: AbortSignal;
    tools: boolean;
    read: HarnessDeps["read"];
    mcp?: HarnessDeps["mcp"];
    images?: HarnessDeps["images"];
    apiKey?: string;
    provider?: ProviderConfig;
    budget?: Budget;
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
    mcp: options.mcp,
    images: options.images,
    budget: options.budget,
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
