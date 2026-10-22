<script module lang="ts">
  export type SettingsSection = "ai" | "tools" | "appearance" | "advanced";
</script>

<script lang="ts">
  import { onMount, tick } from "svelte";
  import { desktopMode } from "../runtime";
  import type { Theme } from "../theme";
  import Icon from "./Icon.svelte";
  import Modal from "./Modal.svelte";
  import ToolsSettings from "./ToolsSettings.svelte";
  import CodingAgents from "./CodingAgents.svelte";
  import type { SessionManager } from "../sessions";
  import {
    PROVIDER_PRESETS,
    getProviderConfig,
    getProviderProfile,
    getCustomProvider,
    savePresetSetting,
    saveProviderProfile,
    type ProviderProfile,
  } from "../provider";
  import {
    DEFAULT_MODEL,
    checkProvider,
    getOpenRouterApiKey,
    setOpenRouterApiKey,
    getOpenRouterModel,
    setOpenRouterModel,
    type ProviderCheck,
  } from "../openrouter";

  interface Props {
    connectionKey: string;
    connected: boolean;
    /** The open workspace, if any; tool servers are saved with it. */
    workspaceId?: string;
    /** Agent detection; custom agent changes refresh it. */
    sessions: SessionManager;
    theme: Theme;
    /** Section to open at; without one, narrow windows start at the category list. */
    section?: SettingsSection;
    onChange: (theme: Theme) => void;
    onClose: () => void;
  }

  let {
    theme,
    section,
    onChange,
    onClose,
    connectionKey,
    connected,
    workspaceId,
    sessions,
  }: Props = $props();

  const sections: { id: SettingsSection; label: string; icon: string }[] = [
    { id: "ai", label: "AI assistant", icon: "smart_toy" },
    { id: "tools", label: "Tools", icon: "extension" },
    { id: "appearance", label: "Appearance", icon: "palette" },
    { id: "advanced", label: "Advanced", icon: "tune" },
  ];
  // svelte-ignore state_referenced_locally
  let selected = $state<SettingsSection>(section ?? "ai");
  // svelte-ignore state_referenced_locally
  let listOpen = $state(!section);

  let checkAbort: AbortController | undefined;
  onMount(() => () => checkAbort?.abort());

  const dark = $derived(theme === "dark");

  const initialProvider = getProviderConfig();
  let apiKey = $state(initialProvider.apiKey);
  let profile = $state<ProviderProfile>(getProviderProfile());
  const providerKind = $derived(
    profile === "openrouter" ? "openrouter" : "custom",
  );
  /** The named hosted provider, or null for OpenRouter and your own server. */
  const preset = $derived(
    PROVIDER_PRESETS.find((entry) => entry.id === profile) ?? null,
  );
  let custom = $state(getCustomProvider());
  let model = $state(initialProvider.model);
  let showKey = $state(false);
  let savedMessage = $state("");
  let saveTimeout: ReturnType<typeof setTimeout> | undefined;
  let check = $state<ProviderCheck | "checking" | null>(null);
  let modelInput = $state<HTMLInputElement>();

  const customHost = $derived.by(() => {
    try {
      return new URL(custom.baseUrl.trim()).host;
    } catch {
      return "";
    }
  });

  const status = $derived.by((): { ok: boolean; text: string } => {
    if (check === "checking") return { ok: true, text: "Checking your setup…" };
    if (check?.result === "ok")
      return { ok: true, text: "Working: the AI assistant answered." };
    if (check?.result === "key")
      return {
        ok: false,
        text:
          providerKind === "custom"
            ? "Your server didn't accept that key. Check it and paste it again."
            : "That key isn't working. Copy it again from OpenRouter and paste it below.",
      };
    if (check?.result === "unreachable")
      return {
        ok: false,
        text:
          providerKind === "custom"
            ? "Couldn't reach your AI server. Check your connection and the server address in Advanced."
            : "Couldn't reach the AI service. Check your internet connection.",
      };
    if (check?.result === "other") return { ok: false, text: check.detail };
    if (preset)
      return custom.apiKey.trim() && custom.model.trim()
        ? { ok: true, text: `Using ${preset.name} with ${custom.model}.` }
        : {
            ok: false,
            text: `Using ${preset.name}. Add its key below and a model in Advanced.`,
          };
    if (providerKind === "custom")
      return customHost
        ? { ok: true, text: `Using your own AI server (${customHost}).` }
        : {
            ok: false,
            text: "Using your own AI server. Add its address in Advanced.",
          };
    if (!apiKey.trim())
      return {
        ok: false,
        text: "Needs a key. Paste your OpenRouter key below to start.",
      };
    return {
      ok: true,
      text: `Ready to use with ${model === DEFAULT_MODEL ? "free models" : model}.`,
    };
  });

  function openSection(id: SettingsSection) {
    selected = id;
    listOpen = false;
  }

  function flashSaved() {
    checkAbort?.abort();
    check = null;
    savedMessage = "Saved";
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      savedMessage = "";
    }, 2000);
  }

  async function runCheck() {
    checkAbort?.abort();
    const controller = new AbortController();
    checkAbort = controller;
    check = "checking";
    try {
      check = await checkProvider(getProviderConfig(), controller.signal);
    } catch {
      if (!controller.signal.aborted) check = { result: "unreachable" };
    }
  }

  function onKeyInput(value: string) {
    apiKey = value;
    if (providerKind === "custom") {
      savePresetSetting("apiKey", value);
      custom.apiKey = value;
    } else setOpenRouterApiKey(value);
    flashSaved();
  }

  function onModelChange(value: string) {
    model = value;
    if (providerKind === "custom") {
      savePresetSetting("model", value);
      custom.model = value;
    } else setOpenRouterModel(value);
    flashSaved();
  }

  async function onQualityChange(select: HTMLSelectElement) {
    if (select.value === "free") return onModelChange(DEFAULT_MODEL);
    // The model only changes once one is typed in Advanced.
    if (model === DEFAULT_MODEL) select.value = "free";
    openSection("advanced");
    await tick();
    modelInput?.focus();
  }

  /** Each provider keeps its own key and model, so switching never mixes them. */
  function changeProvider(value: ProviderProfile) {
    profile = value;
    saveProviderProfile(value);
    custom = getCustomProvider();
    apiKey = value === "openrouter" ? getOpenRouterApiKey() : custom.apiKey;
    model = value === "openrouter" ? getOpenRouterModel() : custom.model;
    showKey = false;
    flashSaved();
  }
</script>

{#snippet actions()}
  <button
    class="btn btn--ghost"
    type="button"
    aria-label="Back, close settings"
    onclick={onClose}
  >
    <Icon name="arrow_back" size={18} />Back
  </button>
{/snippet}

<Modal
  icon="settings"
  title="Settings"
  subtitle="Personalize Agentica on this device."
  fullscreen
  {actions}
  {onClose}
>
  <div class="settings" class:settings--list={listOpen}>
    <nav class="settings__rail" aria-label="Settings categories">
      {#each sections as item (item.id)}
        <button
          class="settings__tab"
          type="button"
          aria-current={!listOpen && selected === item.id ? "page" : undefined}
          class:settings__tab--active={selected === item.id}
          onclick={() => openSection(item.id)}
        >
          <Icon name={item.icon} size={20} />
          <span>{item.label}</span>
          <span class="settings__chevron"
            ><Icon name="chevron_right" size={18} /></span
          >
        </button>
      {/each}
    </nav>

    <div class="settings__pane">
      <div class="settings__pane-head">
        <button
          class="btn btn--ghost settings__to-list"
          type="button"
          onclick={() => (listOpen = true)}
        >
          <Icon name="arrow_back" size={18} />All settings
        </button>
        {#if savedMessage}
          <span class="setting__status" role="status">
            <Icon name="check" size={14} />{savedMessage}
          </span>
        {/if}
      </div>

      <section
        class="settings__section"
        aria-labelledby="settings-ai-title"
        hidden={selected !== "ai"}
      >
        <h2 id="settings-ai-title" class="settings__title">AI assistant</h2>
        <p class="settings__intro">
          The AI assistant answers on the canvas and can suggest edits for you
          to accept. It can't run commands or open your files; only tools you
          turn on in Tools can look anything else up.
        </p>

        <div
          class="settings__status"
          class:settings__status--warn={!status.ok}
          role="status"
        >
          <Icon name={status.ok ? "check_circle" : "error_outline"} size={20} />
          <span>{status.text}</span>
          <button
            class="btn btn--soft"
            type="button"
            disabled={check === "checking" ||
              (providerKind === "openrouter" && !apiKey.trim())}
            onclick={() => void runCheck()}
          >
            Check
          </button>
        </div>

        <section class="setting setting--stacked">
          <span class="setting__icon"><Icon name="key" size={20} /></span>
          <div class="setting__text">
            <h3 id="openrouter-api-key-label">
              {preset
                ? `Your ${preset.name} key`
                : providerKind === "custom"
                  ? "Your server's key"
                  : "Your OpenRouter key"}
            </h3>
            <p>
              {preset
                ? `Create one in your ${preset.name} account. It is only sent to ${new URL(preset.baseUrl).host}.`
                : providerKind === "custom"
                  ? "Leave empty if your server doesn't need one."
                  : "OpenRouter connects Agentica to AI models. Free models need a free account and key."}
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
                    ? "Key"
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
                {#if providerKind === "openrouter"}{#if desktopMode}Don't have
                    one? Open <code>https://openrouter.ai/keys</code> in your browser
                    to get a free key.
                  {:else}Don't have one? <a
                      href="https://openrouter.ai/keys"
                      target="_blank"
                      rel="noreferrer">Get a free key</a
                    >.
                  {/if}{" "}{/if}Your key stays on this device and is only sent
                to the AI service you chose.
              </p>
            </div>
          </div>
        </section>

        {#if providerKind === "openrouter"}
          <section class="setting setting--stacked">
            <span class="setting__icon"
              ><Icon name="auto_awesome" size={20} /></span
            >
            <div class="setting__text">
              <h3 id="ai-quality-label">Quality</h3>
              <div class="setting__body">
                <select
                  id="ai-quality"
                  aria-labelledby="ai-quality-label"
                  value={model === DEFAULT_MODEL ? "free" : "specific"}
                  onchange={(event) =>
                    void onQualityChange(event.currentTarget)}
                >
                  <option value="free">Free, good for trying things out</option>
                  <option value="specific">A specific model…</option>
                </select>
                <p class="setting__hint">
                  {model === DEFAULT_MODEL
                    ? "A free model is picked for you automatically."
                    : `Using ${model}. Change it in Advanced.`}
                </p>
              </div>
            </div>
          </section>
        {:else}
          <button
            class="btn btn--soft settings__link"
            type="button"
            onclick={() => openSection("advanced")}
          >
            <Icon name="tune" size={16} />{preset
              ? "Choose the model in Advanced"
              : "Change your server in Advanced"}
          </button>
        {/if}
      </section>

      <section
        class="settings__section"
        aria-labelledby="settings-tools-title"
        hidden={selected !== "tools"}
      >
        <h2 id="settings-tools-title" class="settings__title">Tools</h2>
        <p class="settings__intro">
          Tools are what the AI assistant can use besides reading the canvas and
          proposing edits. Tools you add stay off until you turn them on, and
          only tools that say they just read can be turned on.
        </p>
        {#if selected === "tools"}
          <ToolsSettings {connectionKey} {connected} {workspaceId} />
        {/if}
      </section>

      <section
        class="settings__section"
        aria-labelledby="settings-appearance-title"
        hidden={selected !== "appearance"}
      >
        <h2 id="settings-appearance-title" class="settings__title">
          Appearance
        </h2>
        <section class="setting">
          <span class="setting__icon"><Icon name="dark_mode" size={20} /></span>
          <div class="setting__text">
            <h3>Dark mode</h3>
            <p>Use a dark look across the app. Remembered on this device.</p>
          </div>
          <button
            class="switch"
            type="button"
            role="switch"
            aria-checked={dark}
            aria-label="Dark mode"
            onclick={() => onChange(dark ? "light" : "dark")}
          >
            <span class="switch__track"
              ><span class="switch__thumb"></span></span
            >
            <span class="switch__label">{dark ? "Dark" : "Light"}</span>
          </button>
        </section>
      </section>

      <section
        class="settings__section"
        aria-labelledby="settings-advanced-title"
        hidden={selected !== "advanced"}
      >
        <h2 id="settings-advanced-title" class="settings__title">Advanced</h2>
        <p class="settings__intro">
          For people running their own AI server or choosing an exact model.
          Most people don't need to change anything here.
        </p>

        <section class="setting setting--stacked">
          <span class="setting__icon"><Icon name="dns" size={20} /></span>
          <div class="setting__text">
            <h3 id="provider-label">Where the AI runs</h3>
            <div class="setting__body">
              <select
                id="ai-provider"
                aria-labelledby="provider-label"
                value={profile}
                onchange={(event) =>
                  changeProvider(event.currentTarget.value as ProviderProfile)}
              >
                <option value="openrouter">OpenRouter (recommended)</option>
                {#each PROVIDER_PRESETS as entry (entry.id)}
                  <option value={entry.id}>{entry.name}</option>
                {/each}
                <option value="custom"
                  >My own AI server (OpenAI-compatible)</option
                >
              </select>
              <p class="setting__hint">
                {#if preset}Uses <code>{preset.baseUrl}</code>. Each provider
                  keeps its own key and model on this device.
                {:else}Choose a hosted provider, or your own server to use a
                  model on this computer.{/if}
              </p>
            </div>
          </div>
        </section>

        {#if profile === "custom"}
          <section class="setting setting--stacked">
            <span class="setting__icon"><Icon name="link" size={20} /></span>
            <div class="setting__text">
              <h3 id="provider-base-url-label">Server address</h3>
              <div class="setting__body">
                <input
                  id="provider-base-url"
                  aria-labelledby="provider-base-url-label"
                  type="url"
                  value={custom.baseUrl}
                  placeholder="https://api.example.com/v1"
                  oninput={(event) => {
                    custom.baseUrl = event.currentTarget.value;
                    savePresetSetting("baseUrl", custom.baseUrl);
                    flashSaved();
                  }}
                  autocomplete="off"
                  spellcheck="false"
                />
                <p class="setting__hint">
                  The API address, usually ending in /v1. It must use HTTPS, or
                  HTTP on this computer (localhost).
                  {desktopMode
                    ? ""
                    : "Your server must allow requests from this app (CORS)."}
                </p>
                <label class="setting__checkbox"
                  ><input
                    id="provider-tools"
                    type="checkbox"
                    checked={custom.tools}
                    onchange={(event) => {
                      custom.tools = event.currentTarget.checked;
                      savePresetSetting("tools", String(custom.tools));
                      flashSaved();
                    }}
                  /> Let the AI suggest canvas edits (the model must support tool
                  calling)</label
                >
              </div>
            </div>
          </section>
        {/if}

        <section class="setting setting--stacked">
          <span class="setting__icon"><Icon name="smart_toy" size={20} /></span>
          <div class="setting__text">
            <h3 id="openrouter-model-label">Exact model ID</h3>
            <div class="setting__body">
              <input
                id="openrouter-model"
                aria-labelledby="openrouter-model-label"
                bind:this={modelInput}
                type="text"
                value={model}
                placeholder={preset
                  ? preset.exampleModel
                  : providerKind === "custom"
                    ? "Model ID"
                    : DEFAULT_MODEL}
                oninput={(event) => onModelChange(event.currentTarget.value)}
                autocomplete="off"
                spellcheck="false"
              />
              <p class="setting__hint">
                {#if preset}A model ID from {preset.name}'s catalog, for example
                  <code>{preset.exampleModel}</code>. {desktopMode
                    ? `See ${preset.docsUrl}.`
                    : ""}
                {:else if providerKind === "custom"}The model name your server
                  expects.
                {:else}Use <code>{DEFAULT_MODEL}</code> for free models, or any model
                  ID listed on OpenRouter.{/if}
              </p>
              {#if preset}
                <label class="setting__checkbox"
                  ><input
                    id="provider-tools"
                    type="checkbox"
                    checked={custom.tools}
                    onchange={(event) => {
                      custom.tools = event.currentTarget.checked;
                      savePresetSetting("tools", String(custom.tools));
                      flashSaved();
                    }}
                  /> Let the AI suggest canvas edits (the model must support tool
                  calling)</label
                >
              {/if}
            </div>
          </div>
        </section>

        <CodingAgents {connectionKey} {connected} {sessions} />
      </section>
    </div>
  </div>
</Modal>

<style>
  .settings {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 15rem minmax(0, 1fr);
  }

  .settings__rail {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 1.25rem 0.9rem;
    border-right: 1px solid var(--line);
    overflow-y: auto;
  }

  .settings__tab {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    width: 100%;
    padding: 0.7rem 0.85rem;
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    color: var(--ink-soft);
    font: inherit;
    font-size: 0.92rem;
    text-align: left;
    cursor: pointer;
  }

  .settings__tab:hover {
    background: var(--surface-soft);
  }

  .settings__tab--active {
    color: var(--accent-strong);
    background: var(--accent-soft);
    font-weight: 600;
  }

  .settings__chevron {
    display: none;
    margin-left: auto;
    color: var(--muted);
  }

  .settings__pane {
    overflow-y: auto;
    padding: 1.25rem 1.75rem 2rem;
  }

  .settings__pane-head {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    min-height: 2rem;
    max-width: 44rem;
    margin-bottom: 0.5rem;
  }

  .settings__to-list {
    display: none;
    margin-right: auto;
  }

  .settings__section {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    max-width: 44rem;
  }

  .settings__section[hidden] {
    display: none;
  }

  .settings__title {
    margin: 0;
    font-size: 1.2rem;
    font-weight: 600;
  }

  .settings__intro {
    margin: -0.4rem 0 0;
    font-size: 0.85rem;
    line-height: 1.5;
    color: var(--muted);
  }

  .settings__status {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.8rem 1rem;
    border-radius: var(--radius);
    border: 1px solid var(--line);
    background: var(--accent-soft);
    color: var(--ink);
    font-size: 0.88rem;
  }

  .settings__status > span:not(.material-icons) {
    flex: 1;
  }

  .settings__status--warn {
    background: var(--surface-soft);
    border-color: var(--line-strong);
  }

  .settings__link {
    align-self: flex-start;
  }

  .setting__text h3 {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
  }

  .setting--stacked {
    align-items: flex-start;
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
    user-select: text;
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

  /* Narrow windows: category list first, then one section (list → detail). */
  @media (max-width: 680px) {
    .settings {
      grid-template-columns: minmax(0, 1fr);
    }
    .settings__rail {
      border-right: 0;
    }
    .settings__chevron,
    .settings__to-list {
      display: inline-flex;
    }
    .settings__tab--active:not(:hover) {
      color: var(--ink-soft);
      background: transparent;
      font-weight: inherit;
    }
    .settings--list .settings__pane,
    .settings:not(.settings--list) .settings__rail {
      display: none;
    }
    .settings__pane {
      padding: 0.75rem 1rem 1.5rem;
    }
  }
</style>
