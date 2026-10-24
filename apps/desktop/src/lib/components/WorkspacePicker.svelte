<script lang="ts">
  import { type RuntimeResult } from "@agentica/protocol";
  import { type Snippet } from "svelte";
  import PickerShell, { type PickerItem } from "./PickerShell.svelte";

  interface Props {
    workspaces: RuntimeResult<"workspace.list">["workspaces"];
    connected: boolean;
    connection: Snippet;
    busy: boolean;
    error: string;
    onRefresh: () => void;
    onCreate: (name: string) => void;
    onOpen: (id: string) => void;
    onDelete: (id: string) => void;
    onOpenSettings: () => void;
  }

  let {
    workspaces,
    connected,
    connection,
    busy,
    error,
    onRefresh,
    onCreate,
    onOpen,
    onDelete,
    onOpenSettings,
  }: Props = $props();

  const items = $derived<PickerItem[]>(
    workspaces.map((w) => ({
      id: w.id,
      label: w.name ?? "Can't read this workspace",
      kind: "workspace" as const,
      meta: !w.name
        ? `ID ${w.id}`
        : w.canvasCount > 0
          ? `${w.canvasCount} canvas${w.canvasCount === 1 ? "" : "es"}`
          : undefined,
      lastModified: w.lastModified,
    })),
  );
</script>

<PickerShell
  {items}
  heading="What are you working on?"
  createLabel="Start workspace"
  createPlaceholder="Give it a name, like Kitchen remodel"
  createInputId="workspace-name"
  createInputLabel="Workspace name"
  hint="A workspace keeps your boards, notes and AI conversations together. It's saved on this computer."
  refreshLabel="Refresh workspace list"
  deleteLabel="Delete workspace"
  deleteConfirm={(label) =>
    `Delete "${label}" and everything in it, including saved review feedback, from this computer?`}
  {connected}
  {connection}
  {busy}
  {error}
  {onCreate}
  {onOpen}
  {onDelete}
  {onRefresh}
  {onOpenSettings}
/>
