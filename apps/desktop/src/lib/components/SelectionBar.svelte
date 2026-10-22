<script lang="ts">
  import Icon from "./Icon.svelte";

  interface Props {
    count: number;
    grouped: boolean;
    disabled: boolean;
    apple: boolean;
    onGroup: () => void;
    onUngroup: () => void;
    onDelete: () => void;
  }
  let { count, grouped, disabled, apple, onGroup, onUngroup, onDelete }: Props =
    $props();
  const mod = $derived(apple ? "⌘" : "Ctrl+");
</script>

<div class="selection-bar" role="toolbar" aria-label="Selection actions">
  <span class="selection-bar__count" role="status"
    >{count} {count === 1 ? "object" : "objects"} selected</span
  >
  {#if count >= 2}
    <button
      class="btn btn--soft"
      type="button"
      title={`Group (${mod}G)`}
      aria-keyshortcuts={apple ? "Meta+G" : "Control+G"}
      {disabled}
      onclick={onGroup}><Icon name="workspaces" size={16} /> Group</button
    >
  {/if}
  {#if grouped}
    <button
      class="btn btn--soft"
      type="button"
      title={`Ungroup (${apple ? "⇧⌘G" : "Ctrl+Shift+G"})`}
      aria-keyshortcuts={apple ? "Shift+Meta+G" : "Control+Shift+G"}
      {disabled}
      onclick={onUngroup}><Icon name="call_split" size={16} /> Ungroup</button
    >
  {/if}
  <button
    class="btn btn--soft selection-bar__delete"
    type="button"
    title="Delete (Delete)"
    aria-keyshortcuts="Delete Backspace"
    {disabled}
    onclick={onDelete}><Icon name="delete" size={16} /> Delete</button
  >
</div>
