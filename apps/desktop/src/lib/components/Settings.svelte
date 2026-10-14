<script lang="ts">
  import type { Theme } from "../theme";
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
    theme: Theme;
    onChange: (theme: Theme) => void;
    onClose: () => void;
  }

  let { theme, onChange, onClose }: Props = $props();

  const dark = $derived(theme === "dark");

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
    <section class="setting setting--stacked">
      <span class="setting__icon"><Icon name="key" size={20} /></span>
      <div class="setting__text">
        <div class="setting__title-row">
          <h2>OpenRouter API Key</h2>
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
        <h2>OpenRouter Model</h2>
        <p>Specify any OpenRouter model identifier (defaults to free router).</p>
        <div class="setting__body">
          <input
            id="openrouter-model"
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
