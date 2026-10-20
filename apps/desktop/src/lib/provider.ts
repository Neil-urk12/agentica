import { getOpenRouterApiKey, getOpenRouterModel } from "./openrouter.ts";

export type ProviderKind = "openrouter" | "custom";
export type ProviderPresetId =
  | "nvidia"
  | "groq"
  | "together"
  | "mistral"
  | "deepseek";
export type ProviderProfile = "openrouter" | ProviderPresetId | "custom";

/** A hosted OpenAI-compatible endpoint, with storage kept separate per preset. */
export interface ProviderPreset {
  id: ProviderPresetId;
  name: string;
  baseUrl: string;
  docsUrl: string;
  exampleModel: string;
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: "nvidia",
    name: "NVIDIA API (NIM)",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    docsUrl: "https://build.nvidia.com/models",
    exampleModel: "nvidia/nemotron-3-super-120b-a12b",
  },
  {
    id: "groq",
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    docsUrl: "https://console.groq.com/docs/models",
    exampleModel: "openai/gpt-oss-120b",
  },
  {
    id: "together",
    name: "Together AI",
    baseUrl: "https://api.together.xyz/v1",
    docsUrl: "https://docs.together.ai/docs/serverless-models",
    exampleModel: "deepseek-ai/DeepSeek-V4-Pro",
  },
  {
    id: "mistral",
    name: "Mistral AI",
    baseUrl: "https://api.mistral.ai/v1",
    docsUrl: "https://docs.mistral.ai/getting-started/models/models_overview/",
    exampleModel: "mistral-large-latest",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    docsUrl: "https://api-docs.deepseek.com/",
    exampleModel: "deepseek-chat",
  },
];

export type ProviderConfig = {
  kind: ProviderKind;
  baseUrl: string;
  apiKey: string;
  model: string;
  tools: boolean;
};

export const DEFAULT_REQUEST_TIMEOUT_SECONDS = 180;
export const MIN_REQUEST_TIMEOUT_SECONDS = 30;
export const MAX_REQUEST_TIMEOUT_SECONDS = 600;

function clampRequestTimeout(seconds: number): number {
  return Math.min(
    MAX_REQUEST_TIMEOUT_SECONDS,
    Math.max(MIN_REQUEST_TIMEOUT_SECONDS, Math.round(seconds)),
  );
}

function stored(key: string, fallback = ""): string {
  try {
    return localStorage.getItem(`agentica.${key}`) ?? fallback;
  } catch {
    return fallback;
  }
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
    // Storage may be unavailable, as with existing OpenRouter settings.
  }
  return seconds;
}

export function getProviderKind(): ProviderKind {
  return stored("provider") === "custom" ? "custom" : "openrouter";
}

function isPresetId(value: string): value is ProviderPresetId {
  return PROVIDER_PRESETS.some((preset) => preset.id === value);
}

/** The saved non-OpenRouter endpoint, retained while OpenRouter is selected. */
function selectedPresetProfile(): ProviderPresetId | "custom" {
  const preset = stored("providerPreset");
  return isPresetId(preset) ? preset : "custom";
}

/** The selected endpoint: OpenRouter, a named preset, or a free-form endpoint. */
export function getProviderProfile(): ProviderProfile {
  return getProviderKind() === "openrouter"
    ? "openrouter"
    : selectedPresetProfile();
}

export function getActivePreset(): ProviderPreset | null {
  const profile = selectedPresetProfile();
  return PROVIDER_PRESETS.find((preset) => preset.id === profile) ?? null;
}

/** Select an endpoint without losing another preset's key or model. */
export function saveProviderProfile(profile: ProviderProfile): void {
  if (profile === "openrouter") {
    saveProviderSetting("provider", "openrouter");
    return;
  }
  saveProviderSetting("provider", "custom");
  try {
    localStorage.setItem("agentica.providerPreset", profile);
  } catch {
    // Storage may be unavailable, as with existing provider settings.
  }
}

/** Save one field for the active preset, including the free-form endpoint. */
export function savePresetSetting(
  field: "baseUrl" | "apiKey" | "model" | "tools",
  value: string,
): void {
  try {
    localStorage.setItem(
      `agentica.preset.${selectedPresetProfile()}.${field}`,
      value.trim(),
    );
  } catch {
    // Storage may be unavailable, as with existing provider settings.
  }
}

export function getCustomProvider(): ProviderConfig {
  const profile = selectedPresetProfile();
  const preset = PROVIDER_PRESETS.find((entry) => entry.id === profile);
  const read = (field: "baseUrl" | "apiKey" | "model"): string => {
    let value: string | null = null;
    try {
      value = localStorage.getItem(`agentica.preset.${profile}.${field}`);
    } catch {
      // Storage may be unavailable; presets fall back to their defaults.
    }
    if (value !== null) return value;
    if (profile !== "custom") return "";
    // Profiles predate preset storage, so keep their settings working.
    const legacy = {
      baseUrl: "customBaseUrl",
      apiKey: "customApiKey",
      model: "customModel",
    } as const;
    return stored(legacy[field]);
  };
  const fallbackTools =
    profile === "custom" ? stored("customTools", "true") : "true";
  return {
    kind: "custom",
    baseUrl: read("baseUrl") || preset?.baseUrl || "",
    apiKey: read("apiKey"),
    model: read("model"),
    tools: stored(`preset.${profile}.tools`, fallbackTools) === "true",
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
