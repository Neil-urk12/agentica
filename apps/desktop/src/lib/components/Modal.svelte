<script lang="ts">
  import { fade, fly } from "svelte/transition";
  import { onMount, type Snippet } from "svelte";
  import Icon from "./Icon.svelte";

  interface Props {
    title: string;
    subtitle?: string;
    icon?: string;
    wide?: boolean;
    fullscreen?: boolean;
    actions?: Snippet;
    children: Snippet;
    onClose?: () => void;
  }
  let {
    title,
    subtitle,
    icon = "blur_on",
    wide = false,
    fullscreen = false,
    actions,
    children,
    onClose,
  }: Props = $props();

  let dialog: HTMLDialogElement;
  onMount(() => {
    const previousFocus = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  });

  function onKeydown(event: KeyboardEvent) {
    if (event.key !== "Tab") return;
    const controls = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        "button, input, select, textarea, a[href], [tabindex]",
      ),
    ).filter(
      (element) =>
        element.tabIndex >= 0 &&
        !element.matches(":disabled") &&
        element.getClientRects().length > 0,
    );
    const boundary = event.shiftKey ? controls[0] : controls.at(-1);
    if (document.activeElement === boundary) {
      event.preventDefault();
      (event.shiftKey ? controls.at(-1) : controls[0])?.focus();
    }
  }
</script>

<dialog
  bind:this={dialog}
  class="scrim"
  class:scrim--full={fullscreen}
  transition:fade={{ duration: 180 }}
  aria-label={title}
  onkeydown={onKeydown}
  oncancel={(event) => {
    event.preventDefault();
    onClose?.();
  }}
>
  <div
    class="modal"
    class:modal--wide={wide}
    class:modal--full={fullscreen}
    transition:fly={{ y: 18, duration: 260, opacity: 0.4 }}
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
</dialog>
