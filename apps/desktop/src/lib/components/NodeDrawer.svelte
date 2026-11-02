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
    onDelete: (id: string) => void;
  }

  // The sidebar wrapper owns the width grip, so this list fits any placement.
  let { items, selectedId, busy, onSelect, onClose, onDelete }: Props =
    $props();

  const ICONS: Record<string, string> = {
    project: "folder_open",
    shell: "terminal",
    "cli-agent": "smart_toy",
    changes: "difference",
    instruction: "note_add",
    text: "text_fields",
    file: "description",
    "web-preview": "web",
    path: "gesture",
    rectangle: "crop_square",
    ellipse: "circle",
  };

  const KINDS: Record<string, string> = {
    project: "Project",
    shell: "Terminal",
    "cli-agent": "Coding agent",
    changes: "Changes",
    instruction: "Instruction note",
    text: "Text",
    file: "File",
    "web-preview": "Local preview",
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
</aside>
