<script lang="ts">
  import { onMount } from "svelte";
  import { callRuntime } from "../runtime";
  import {
    ACCENTS,
    DESIGNS,
    type Accent,
    type Appearance,
    type Design,
    type Theme,
  } from "../theme";
  import Icon from "./Icon.svelte";
  import Modal from "./Modal.svelte";
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
    design: Design;
    accent: Accent;
    onChange: (change: Partial<Appearance>) => void;
    onClose: () => void;
  }

  let {
    theme,
    design,
    accent,
    onChange,
    onClose,
    connectionKey,
    connected,
  }: Props = $props();
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
  const activeDesign = $derived(DESIGNS.find((item) => item.id === design));
  const activeAccent = $derived(ACCENTS.find((item) => item.id === accent));

  let apiKey = $state(getOpenRouterApiKey());
  let model = $state(getOpenRouterModel());
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
    setOpenRouterApiKey(value);
    flashSaved();
  }

  function onModelChange(value: string) {
    model = value;
    setOpenRouterModel(value);
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
          OpenRouter generates response text only. It cannot run artifact tools.
        </p>
      </div>
    </section>
    <section class="setting setting--stacked">
      <span class="setting__icon"><Icon name="key" size={20} /></span>
      <div class="setting__text">
        <div class="setting__title-row">
          <h2 id="openrouter-api-key-label">OpenRouter API Key</h2>
          {#if savedMessage}
            <span class="setting__status">
              <Icon name="check" size={14} />{savedMessage}
            </span>
          {/if}
        </div>
        <p>Required to query free models through OpenRouter.</p>
        <div class="setting__body">
          <div class="setting__input-row">
            <input
              id="openrouter-api-key"
              aria-labelledby="openrouter-api-key-label"
              type={showKey ? "text" : "password"}
              value={apiKey}
              oninput={(event) => onKeyInput(event.currentTarget.value)}
              placeholder="sk-or-v1-..."
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
            Get an API key at <a
              href="https://openrouter.ai/keys"
              target="_blank"
              rel="noreferrer">openrouter.ai/keys</a
            >. It is stored locally on this device.
          </p>
        </div>
      </div>
    </section>

    <section class="setting setting--stacked">
      <span class="setting__icon"><Icon name="smart_toy" size={20} /></span>
      <div class="setting__text">
        <h2 id="openrouter-model-label">OpenRouter Model</h2>
        <p>
          Specify any OpenRouter model identifier (defaults to free router).
        </p>
        <div class="setting__body">
          <input
            id="openrouter-model"
            aria-labelledby="openrouter-model-label"
            type="text"
            value={model}
            placeholder={DEFAULT_MODEL}
            oninput={(event) => onModelChange(event.currentTarget.value)}
            autocomplete="off"
            spellcheck="false"
          />
          <p class="setting__hint">
            Default: <code>openrouter/free</code> (auto-routes across all available
            free models).
          </p>
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
        onclick={() => onChange({ theme: dark ? "light" : "dark" })}
      >
        <span class="switch__track"><span class="switch__thumb"></span></span>
        <span class="switch__label">{dark ? "Dark" : "Light"}</span>
      </button>
    </section>

    <section class="setting setting--stacked">
      <span class="setting__icon"><Icon name="style" size={20} /></span>
      <div class="setting__text">
        <h2 id="design-theme-label">Design theme</h2>
        <p>Pick a surface family and an accent color for the whole app.</p>
        <div class="setting__body">
          <div
            class="choice-group"
            role="group"
            aria-labelledby="design-theme-label"
          >
            {#each DESIGNS as option (option.id)}
              <button
                class="choice"
                class:choice--active={design === option.id}
                type="button"
                title={option.hint}
                aria-pressed={design === option.id}
                onclick={() => onChange({ design: option.id })}
              >
                {option.name}
              </button>
            {/each}
          </div>
          <p class="setting__hint">{activeDesign?.hint}</p>

          <div class="swatch-row">
            <span class="swatch-row__label" id="accent-label">Accent</span>
            <div
              class="swatch-group"
              role="group"
              aria-labelledby="accent-label"
            >
              {#each ACCENTS as option (option.id)}
                <button
                  class="accent-swatch"
                  class:accent-swatch--active={accent === option.id}
                  type="button"
                  title={option.name}
                  aria-label={option.name}
                  aria-pressed={accent === option.id}
                  style:background={option.swatch[theme]}
                  onclick={() => onChange({ accent: option.id })}
                ></button>
              {/each}
            </div>
            <span class="swatch-row__value">{activeAccent?.name}</span>
          </div>
        </div>
      </div>
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

  .choice-group {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .choice {
    padding: 0.4rem 0.7rem;
    font: inherit;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--ink-soft);
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition:
      border-color 0.16s ease,
      background 0.16s ease,
      color 0.16s ease;
  }

  .choice:hover {
    border-color: var(--accent);
  }

  .choice--active {
    color: var(--accent-strong);
    background: var(--accent-soft);
    border-color: var(--accent);
  }

  .swatch-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-top: 0.55rem;
  }

  .swatch-row__label {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--ink-soft);
  }

  .swatch-row__value {
    font-size: 0.78rem;
    color: var(--muted);
  }

  .swatch-group {
    display: flex;
    gap: 0.4rem;
  }

  .accent-swatch {
    width: 1.5rem;
    height: 1.5rem;
    padding: 0;
    border: 2px solid transparent;
    border-radius: 50%;
    cursor: pointer;
    transition:
      transform 0.12s ease,
      box-shadow 0.16s ease;
  }

  .accent-swatch:hover {
    transform: scale(1.08);
  }

  /* An inner ring keeps the selection readable on every accent colour. */
  .accent-swatch--active {
    border-color: var(--ink);
    box-shadow: inset 0 0 0 2px var(--surface);
  }
</style>
