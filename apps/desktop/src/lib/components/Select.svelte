<script lang="ts">
  import Icon from "./Icon.svelte";

  interface Option {
    value: string;
    label: string;
  }
  interface Props {
    value: string;
    options: Option[];
    /** Accessible name; the current choice is appended to it. */
    label: string;
    /** Shown when no option matches `value`. */
    placeholder?: string;
    disabled?: boolean;
    title?: string;
    class?: string;
    onchange: (value: string) => void;
  }
  let {
    value,
    options,
    label,
    placeholder = "",
    disabled = false,
    title,
    class: className = "",
    onchange,
  }: Props = $props();

  // A native <select> popup is drawn by the OS (GTK on Linux) and ignores the
  // app theme, so this listbox replaces it where it shows on the canvas.
  const id = $props.id();
  let open = $state(false);
  let active = $state(0);
  let root = $state<HTMLElement>();
  let list = $state<HTMLElement>();
  let trigger = $state<HTMLButtonElement>();
  const current = $derived(options.find((option) => option.value === value));
  const shown = $derived(current?.label ?? placeholder);

  function show() {
    if (disabled || !options.length) return;
    active = Math.max(
      0,
      options.findIndex((option) => option.value === value),
    );
    open = true;
    requestAnimationFrame(() => list?.focus());
  }

  function close(refocus = true) {
    open = false;
    if (refocus) trigger?.focus();
  }

  function pick(index: number) {
    const option = options[index];
    close();
    if (option && option.value !== value) onchange(option.value);
  }

  function onListKey(event: KeyboardEvent) {
    // Canvas shortcuts must not see keys meant for the list.
    event.stopPropagation();
    const last = options.length - 1;
    switch (event.key) {
      case "ArrowDown":
        active = Math.min(last, active + 1);
        break;
      case "ArrowUp":
        active = Math.max(0, active - 1);
        break;
      case "Home":
        active = 0;
        break;
      case "End":
        active = last;
        break;
      case "Enter":
      case " ":
        pick(active);
        break;
      case "Escape":
        close();
        break;
      case "Tab":
        close(false);
        return;
      default:
        return;
    }
    event.preventDefault();
  }

  $effect(() => {
    if (!open) return;
    document
      .getElementById(`${id}-${active}`)
      ?.scrollIntoView({ block: "nearest" });
  });

  // The canvas pane cancels mousedown, so blur alone misses outside clicks.
  $effect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!root?.contains(event.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  });

  // Options can disappear while open (an agent tile removed, say).
  $effect(() => {
    if (open && (disabled || !options.length)) close(false);
  });
</script>

<div
  class={`select ${className}`}
  class:open
  data-value={value}
  bind:this={root}
>
  <button
    bind:this={trigger}
    type="button"
    class="select__trigger nodrag"
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-controls={open ? `${id}-list` : undefined}
    aria-label={shown ? `${label}: ${shown}` : label}
    {title}
    {disabled}
    onclick={() => (open ? close() : show())}
    onkeydown={(event) => {
      event.stopPropagation();
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        show();
      }
    }}
  >
    <span class="select__value">{shown}</span>
    <Icon name="expand_more" size={16} />
  </button>
  {#if open}
    <ul
      bind:this={list}
      id={`${id}-list`}
      class="select__list nodrag nowheel"
      role="listbox"
      aria-label={label}
      tabindex="-1"
      aria-activedescendant={`${id}-${active}`}
      onkeydown={onListKey}
    >
      {#each options as option, index (option.value)}
        <!-- Keyboard selection is handled by the listbox (aria-activedescendant). -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <li
          id={`${id}-${index}`}
          role="option"
          aria-selected={option.value === value}
          data-value={option.value}
          title={option.label}
          class:active={index === active}
          onpointerenter={() => (active = index)}
          onclick={() => pick(index)}
        >
          {option.label}
        </li>
      {/each}
    </ul>
  {/if}
</div>
