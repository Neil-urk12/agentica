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
    onSelect: (id: string) => void;
    onClose: () => void;
  }

  let { items, selectedId, busy, onSelect, onClose }: Props = $props();

  const ICONS: Record<string, string> = {
    text: "text_fields",
    path: "gesture",
    rectangle: "crop_square",
    ellipse: "circle",
  };

  const KINDS: Record<string, string> = {
    text: "Text",
    path: "Drawing",
    rectangle: "Rectangle",
    ellipse: "Ellipse",
  };
</script>

<aside class="drawer" aria-label="Nodes">
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

  {#if items.length === 0}
    <div class="drawer__empty">
      <Icon name="layers" size={26} />
      <p>No nodes yet</p>
      <small>Text and drawings you add appear here.</small>
    </div>
  {:else}
    <ul class="drawer__list">
      {#each items as item (item.id)}
        <li>
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
        </li>
      {/each}
    </ul>
  {/if}
</aside>
