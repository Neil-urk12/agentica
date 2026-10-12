<script lang="ts">
  import { fade, fly } from "svelte/transition";
  import type { Snippet } from "svelte";
  import Icon from "./Icon.svelte";

  interface Props {
    title: string;
    subtitle?: string;
    icon?: string;
    wide?: boolean;
    actions?: Snippet;
    children: Snippet;
  }
  let {
    title,
    subtitle,
    icon = "blur_on",
    wide = false,
    actions,
    children,
  }: Props = $props();
</script>

<div class="scrim" transition:fade={{ duration: 180 }}>
  <div
    class="modal"
    class:modal--wide={wide}
    transition:fly={{ y: 18, duration: 260, opacity: 0.4 }}
    role="dialog"
    aria-modal="true"
    aria-label={title}
  >
    <header class="modal__head">
      <span class="modal__icon"><Icon name={icon} size={22} /></span>
      <div class="modal__titles">
        <h1>{title}</h1>
        {#if subtitle}<p>{subtitle}</p>{/if}
      </div>
      {#if actions}
        <div class="modal__actions">{@render actions()}</div>
      {/if}
    </header>
    <div class="modal__body">
      {@render children()}
    </div>
  </div>
</div>
