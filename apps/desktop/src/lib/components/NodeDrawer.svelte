<script lang="ts">
  import Icon from "./Icon.svelte";

  interface NodeItem {
    id: string;
    label: string;
    kind: string;
  }

  interface Props {
    items: NodeItem[];
    selectedId: string;
    busy: boolean;
    width: number;
    onSelect: (id: string) => void;
    onClose: () => void;
    onResize: (width: number) => void;
    onDelete: (id: string) => void;
  }

  let {
    items,
    selectedId,
    busy,
    width,
    onSelect,
    onClose,
    onResize,
    onDelete,
  }: Props = $props();

  const ICONS: Record<string, string> = {
    project: "folder_open",
    shell: "terminal",
    "cli-agent": "smart_toy",
    instruction: "note_add",
    text: "text_fields",
    file: "description",
    path: "gesture",
    rectangle: "crop_square",
    ellipse: "circle",
  };

  const KINDS: Record<string, string> = {
    project: "Project",
    shell: "Terminal",
    "cli-agent": "Codex",
    instruction: "Instruction note",
    text: "Text",
    file: "File",
    path: "Drawing",
    rectangle: "Rectangle",
    ellipse: "Ellipse",
  };

  /** Drag the right edge to change the drawer width. */
  function startResize(event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    const grip = event.currentTarget as HTMLElement;
    const startX = event.clientX;
    const startWidth = width;
    grip.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) =>
      onResize(startWidth + (moveEvent.clientX - startX));
    const end = () => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", end);
      grip.removeEventListener("pointercancel", end);
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", end);
    grip.addEventListener("pointercancel", end);
  }

  /** Resize from the keyboard too: arrows nudge, shift arrows jump. */
  function resizeByKey(event: KeyboardEvent) {
    const step = event.shiftKey ? 32 : 8;
    if (event.key === "ArrowRight") onResize(width + step);
    else if (event.key === "ArrowLeft") onResize(width - step);
    else return;
    event.preventDefault();
  }
</script>

<aside class="drawer" style="--drawer-w: {width}px" aria-label="Nodes">
  <div class="drawer__head">
    <h2><Icon name="toc" size={18} />Nodes</h2>
    <span class="drawer__count">{items.length}</span>
    <button
      class="icon-btn"
      type="button"
      title="Hide nodes"
      aria-label="Hide nodes"
      onclick={onClose}
    >
      <Icon name="close" size={18} />
    </button>
  </div>

  <div class="drawer__scroll">
    {#if items.length === 0}
      <div class="drawer__empty">
        <Icon name="layers" size={26} />
        <p>No nodes yet</p>
        <small>Text and drawings you add appear here.</small>
      </div>
    {:else}
      <ul class="drawer__list">
        {#each items as item (item.id)}
          <li class="drawer__row">
            <button
              class="drawer__item"
              class:drawer__item--active={item.id === selectedId}
              type="button"
              disabled={busy}
              title={item.label}
              aria-pressed={item.id === selectedId}
              onclick={() => onSelect(item.id)}
            >
              <span class="drawer__icon"
                ><Icon name={ICONS[item.kind] ?? "gesture"} size={18} /></span
              >
              <span class="drawer__text">
                <strong>{item.label}</strong>
                <small>{KINDS[item.kind] ?? "Node"}</small>
              </span>
            </button>
            <button
              class="icon-btn drawer__delete"
              type="button"
              title={`Delete ${item.label}`}
              aria-label={`Delete ${item.label}`}
              disabled={busy}
              onclick={() => onDelete(item.id)}
            >
              <Icon name="delete" size={16} />
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <button
    class="drawer__grip"
    type="button"
    aria-label="Resize nodes panel"
    title="Drag to resize"
    onpointerdown={startResize}
    onkeydown={resizeByKey}
  ></button>
</aside>
