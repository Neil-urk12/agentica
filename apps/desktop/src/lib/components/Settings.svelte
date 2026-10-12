<script lang="ts">
  import type { Theme } from "../theme";
  import Icon from "./Icon.svelte";
  import Modal from "./Modal.svelte";

  interface Props {
    theme: Theme;
    onChange: (theme: Theme) => void;
    onClose: () => void;
  }

  let { theme, onChange, onClose }: Props = $props();

  const dark = $derived(theme === "dark");
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
>
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
</Modal>
