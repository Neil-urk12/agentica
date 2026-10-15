<script lang="ts">
  import { onMount } from "svelte";
  import { callRuntime, desktopMode } from "../runtime";
  import type { Theme } from "../theme";
  import Icon from "./Icon.svelte";
  import Modal from "./Modal.svelte";
  import {
    getProviderConfig,
    getProviderKind,
    getCustomProvider,
    saveProviderSetting,
    type ProviderKind,
  } from "../provider";
  import {
    DEFAULT_MODEL,
    getOpenRouterApiKey,
    setOpenRouterApiKey,
    getOpenRouterModel,
    setOpenRouterModel,
  } from "../openrouter";

  interface Props {
    connectionKey: string;
    connected: boolean;
    theme: Theme;
    onChange: (theme: Theme) => void;
    onClose: () => void;
  }

  let { theme, onChange, onClose, connectionKey, connected }: Props = $props();
  let codexStatus = $state(
    "Connect the backend to check Codex availability. Manual editing works without Codex.",
  );
  onMount(() => {
    if (connected) {
      codexStatus = "Checking Codex availability…";
      void callRuntime(
        connectionKey.trim(),
        false,
        "agent.capabilities",
        {},
      ).then(
        (capabilities) => {
          codexStatus = capabilities.reason;
        },
        () => {
          codexStatus =
            "Codex capability check failed. Execution is unavailable; reconnect the backend and reopen settings. Manual editing remains available.";
        },
      );
    }
  });

  const dark = $derived(theme === "dark");

  const initialProvider = getProviderConfig();
  let apiKey = $state(initialProvider.apiKey);
  let providerKind = $state(getProviderKind());
  let custom = $state(getCustomProvider());
  let model = $state(initialProvider.model);
  let showKey = $state(false);
  let savedMessage = $state("");
  let saveTimeout: ReturnType<typeof setTimeout> | undefined;

  function flashSaved() {
    savedMessage = "Saved";
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      savedMessage = "";
    }, 2000);
  }

  function onKeyInput(value: string) {
    apiKey = value;
    if (providerKind === "custom") saveProviderSetting("customApiKey", value);
    else setOpenRouterApiKey(value);
    flashSaved();
  }

  function onModelChange(value: string) {
    model = value;
    if (providerKind === "custom") saveProviderSetting("customModel", value);
    else setOpenRouterModel(value);
    flashSaved();
  }

  function changeProvider(value: ProviderKind) {
    providerKind = value;
    saveProviderSetting("provider", value);
    custom = getCustomProvider();
    apiKey = value === "custom" ? custom.apiKey : getOpenRouterApiKey();
    model = value === "custom" ? custom.model : getOpenRouterModel();
    showKey = false;
    flashSaved();
  }
</script>

{#snippet actions()}
  <button
    class="icon-btn"
    type="button"
    title="Close settings"
    aria-label="Close settings"
    onclick={onClose}
  >
    <Icon name="close" size={20} />
  </button>
{/snippet}

<Modal
  icon="settings"
  title="Settings"
  subtitle="Personalize Agentica on this device."
  {actions}
  {onClose}
>
  <div class="settings-stack">
    <section
      class="setting setting--stacked"
      aria-labelledby="codex-status-label"
    >
      <div class="setting__text">
        <h2 id="codex-status-label">Codex agent execution</h2>
        <p role="status">{codexStatus}</p>
        <p>
          Your provider replies on the canvas. Compatible models can propose
          canvas edits for your review; they cannot run shell commands or access
          files.
        </p>
      </div>
    </section>
    <section class="setting setting--stacked">
      <div class="setting__text">
        <h2 id="provider-label">AI provider</h2>
        <div class="setting__body">
          <select
            id="ai-provider"
            aria-labelledby="provider-label"
            value={providerKind}
            onchange={(event) =>
              changeProvider(event.currentTarget.value as ProviderKind)}
          >
            <option value="openrouter">OpenRouter</option>
            <option value="custom">Custom (OpenAI-compatible)</option>
          </select>
        </div>
      </div>
    </section>
    {#if providerKind === "custom"}
      <section class="setting setting--stacked">
        <div class="setting__text">
          <h2 id="provider-base-url-label">Base URL</h2>
          <div class="setting__body">
            <input
              id="provider-base-url"
              aria-labelledby="provider-base-url-label"
              type="url"
              value={custom.baseUrl}
              placeholder="https://api.example.com/v1"
              oninput={(event) => {
                custom.baseUrl = event.currentTarget.value;
                saveProviderSetting("customBaseUrl", custom.baseUrl);
                flashSaved();
              }}
              autocomplete="off"
              spellcheck="false"
            />
            <p class="setting__hint">
              Use an OpenAI-compatible API base URL, including /v1 if required,
              or paste the full /chat/completions URL. HTTPS or HTTP on
              localhost is supported.
              {desktopMode
                ? "Desktop requests use a native HTTP connection."
                : "The endpoint must allow CORS requests from this app."}
            </p>
            <label class="setting__checkbox"
              ><input
                id="provider-tools"
                type="checkbox"
                checked={custom.tools}
                onchange={(event) => {
                  custom.tools = event.currentTarget.checked;
                  saveProviderSetting("customTools", String(custom.tools));
                  flashSaved();
                }}
              /> Enable canvas tools (requires function calling)</label
            >
          </div>
        </div>
      </section>
    {/if}
    <section class="setting setting--stacked">
      <span class="setting__icon"><Icon name="key" size={20} /></span>
      <div class="setting__text">
        <div class="setting__title-row">
          <h2 id="openrouter-api-key-label">
            {providerKind === "custom"
              ? "Provider API Key"
              : "OpenRouter API Key"}
          </h2>
          {#if savedMessage}
            <span class="setting__status">
              <Icon name="check" size={14} />{savedMessage}
            </span>
          {/if}
        </div>
        <p>
          {providerKind === "custom"
            ? "Leave blank only if your endpoint needs no authentication."
            : "Required to query free models through OpenRouter."}
        </p>
        <div class="setting__body">
          <div class="setting__input-row">
            <input
              id="openrouter-api-key"
              aria-labelledby="openrouter-api-key-label"
              type={showKey ? "text" : "password"}
              value={apiKey}
              oninput={(event) => onKeyInput(event.currentTarget.value)}
              placeholder={providerKind === "custom"
                ? "API key"
                : "sk-or-v1-..."}
              autocomplete="off"
              spellcheck="false"
            />
            <button
              class="icon-btn"
              type="button"
              title={showKey ? "Hide key" : "Show key"}
              aria-label={showKey ? "Hide key" : "Show key"}
              onclick={() => (showKey = !showKey)}
            >
              <Icon
                name={showKey ? "visibility_off" : "visibility"}
                size={18}
              />
            </button>
          </div>
          <p class="setting__hint">
            {#if providerKind === "openrouter"}Get an API key at <a
                href="https://openrouter.ai/keys"
                target="_blank"
                rel="noreferrer">openrouter.ai/keys</a
              >.
            {/if}Settings and keys are stored locally on this device. The key is
            sent only to the selected provider.
          </p>
        </div>
      </div>
    </section>

    <section class="setting setting--stacked">
      <span class="setting__icon"><Icon name="smart_toy" size={20} /></span>
      <div class="setting__text">
        <h2 id="openrouter-model-label">
          {providerKind === "custom" ? "Provider Model" : "OpenRouter Model"}
        </h2>
        <p>
          {providerKind === "custom"
            ? "Enter the model ID accepted by your endpoint."
            : "Specify any OpenRouter model identifier (defaults to free router)."}
        </p>
        <div class="setting__body">
          <input
            id="openrouter-model"
            aria-labelledby="openrouter-model-label"
            type="text"
            value={model}
            placeholder={providerKind === "custom" ? "Model ID" : DEFAULT_MODEL}
            oninput={(event) => onModelChange(event.currentTarget.value)}
            autocomplete="off"
            spellcheck="false"
          />
          {#if providerKind === "openrouter"}<p class="setting__hint">
              Default: <code>openrouter/free</code> (auto-routes across all available
              free models).
            </p>{/if}
        </div>
      </div>
    </section>

    <section class="setting">
      <span class="setting__icon"><Icon name="palette" size={20} /></span>
      <div class="setting__text">
        <h2>Appearance</h2>
        <p>
          Use a dark theme across the app. Your choice is remembered on this
          device.
        </p>
      </div>
      <button
        class="switch"
        type="button"
        role="switch"
        aria-checked={dark}
        aria-label="Dark mode"
        onclick={() => onChange(dark ? "light" : "dark")}
      >
        <span class="switch__track"><span class="switch__thumb"></span></span>
        <span class="switch__label">{dark ? "Dark" : "Light"}</span>
      </button>
    </section>
  </div>
</Modal>

<style>
  .settings-stack {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }

  .setting--stacked {
    align-items: flex-start;
  }

  .setting__title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .setting__body {
    width: 100%;
    margin-top: 0.65rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .setting__input-row {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .setting__checkbox {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8rem;
  }

  .setting__checkbox input {
    width: auto;
    padding: 0;
    flex: none;
    accent-color: var(--accent);
  }

  .setting__hint {
    font-size: 0.78rem;
    color: var(--muted);
    margin: 0;
    line-height: 1.4;
  }

  .setting__hint a {
    color: var(--accent);
    text-decoration: underline;
  }

  .setting__hint code {
    font-size: 0.75rem;
    padding: 0.1rem 0.3rem;
    border-radius: 4px;
    background: var(--surface);
    border: 1px solid var(--line);
  }

  .setting__status {
    font-size: 0.75rem;
    color: var(--accent-strong);
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-weight: 500;
  }
</style>
