import { getOpenRouterApiKey, getOpenRouterModel } from "./openrouter.ts";

export type ProviderKind = "openrouter" | "custom";
export type ProviderConfig = {
  kind: ProviderKind;
  baseUrl: string;
  apiKey: string;
  model: string;
  tools: boolean;
};

function stored(key: string, fallback = ""): string {
  try {
    return localStorage.getItem(`agentica.${key}`) ?? fallback;
  } catch {
    return fallback;
  }
}

export const DEFAULT_REQUEST_TIMEOUT_SECONDS = 180;
export const MIN_REQUEST_TIMEOUT_SECONDS = 30;
export const MAX_REQUEST_TIMEOUT_SECONDS = 600;

function clampRequestTimeout(seconds: number): number {
  return Math.min(
    MAX_REQUEST_TIMEOUT_SECONDS,
    Math.max(MIN_REQUEST_TIMEOUT_SECONDS, Math.round(seconds)),
  );
}

/** Time limit for one agent turn; slow free models often need more. */
export function getRequestTimeoutSeconds(): number {
  const raw = stored("requestTimeoutSeconds");
  if (!raw) return DEFAULT_REQUEST_TIMEOUT_SECONDS;
  const seconds = Number(raw);
  return Number.isFinite(seconds)
    ? clampRequestTimeout(seconds)
    : DEFAULT_REQUEST_TIMEOUT_SECONDS;
}

export function getRequestTimeoutMs(): number {
  return getRequestTimeoutSeconds() * 1000;
}

/** Persist a clamped limit and return the stored value. Blank resets it. */
export function saveRequestTimeoutSeconds(value: number | string): number {
  const text = String(value).trim();
  const parsed = Number(text);
  const seconds =
    text !== "" && Number.isFinite(parsed)
      ? clampRequestTimeout(parsed)
      : DEFAULT_REQUEST_TIMEOUT_SECONDS;
  try {
    localStorage.setItem("agentica.requestTimeoutSeconds", String(seconds));
  } catch {
    // Storage may be unavailable, as with existing provider settings.
  }
  return seconds;
}

export function saveProviderSetting(
  key:
    | "provider"
    | "customBaseUrl"
    | "customApiKey"
    | "customModel"
    | "customTools",
  value: string,
): void {
  try {
    localStorage.setItem(`agentica.${key}`, value.trim());
  } catch {
    // Storage may be unavailable, as with existing OpenRouter settings.
  }
}

export function getProviderKind(): ProviderKind {
  return stored("provider") === "custom" ? "custom" : "openrouter";
}

export function getCustomProvider(): ProviderConfig {
  return {
    kind: "custom",
    baseUrl: stored("customBaseUrl"),
    apiKey: stored("customApiKey"),
    model: stored("customModel"),
    tools: stored("customTools", "true") === "true",
  };
}

export function getProviderConfig(): ProviderConfig {
  return getProviderKind() === "custom"
    ? getCustomProvider()
    : {
        kind: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: getOpenRouterApiKey(),
        model: getOpenRouterModel(),
        tools: true,
      };
}

export function validateProvider(config: ProviderConfig): ProviderConfig {
  let url: URL;
  try {
    url = new URL(config.baseUrl.trim());
  } catch {
    throw new Error(
      "Enter a valid provider base URL in Settings, including /v1 if required.",
    );
  }
  const loopback = ["localhost", "127.0.0.1"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Provider base URL in Settings must use HTTPS (or HTTP on localhost), without credentials, query, or fragment.",
    );
  if (!config.model.trim())
    throw new Error("Enter a provider model ID in Settings.");
  if (config.kind === "openrouter" && !config.apiKey.trim())
    throw new Error(
      "OpenRouter API key is required. Please set your API key in Settings.",
    );
  return {
    ...config,
    baseUrl: `${url.origin}${url.pathname}`
      .replace(/\/+$/, "")
      .replace(/\/chat\/completions$/, ""),
    apiKey: config.apiKey.trim(),
    model: config.model.trim(),
  };
}
