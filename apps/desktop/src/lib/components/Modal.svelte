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
  let previousFocus: Element | null = null;
  let restored = false;
  // Close and hand focus back once, as soon as the modal starts leaving.
  function release() {
    dialog.close();
    if (restored) return;
    restored = true;
    if (previousFocus instanceof HTMLElement) previousFocus.focus();
  }
  onMount(() => {
    previousFocus = document.activeElement;
    dialog.showModal();
    return release;
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
  onoutrostart={() => {
    // Unmount waits for the fade. Meanwhile a modal dialog would keep the page
    // inert and late focus restoration would land after later input, so release
    // both now and fade out as an inert overlay.
    release();
    dialog.inert = true;
    dialog.show();
  }}
  onintrostart={() => {
    // Reopened mid-fade: Svelte reverses on the same element, so restore modality.
    if (!dialog.inert) return;
    restored = false;
    dialog.inert = false;
    dialog.close();
    dialog.showModal();
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
