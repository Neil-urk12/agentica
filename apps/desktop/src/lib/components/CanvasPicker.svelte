<script lang="ts">
  import { type RuntimeResult } from "@agentica/protocol";
  import { type Snippet } from "svelte";
  import PickerShell, { type PickerItem } from "./PickerShell.svelte";

  interface Props {
    workspaceName: string;
    canvases: NonNullable<RuntimeResult<"workspace.open">>["canvases"];
    connected: boolean;
    connection: Snippet;
    busy: boolean;
    error: string;
    onCreate: (title: string) => void;
    onOpen: (id: string) => void;
    onDelete: (id: string) => void;
    onBack: () => void;
    onOpenSettings: () => void;
  }

  let {
    workspaceName,
    canvases,
    connected,
    connection,
    busy,
    error,
    onCreate,
    onOpen,
    onDelete,
    onBack,
    onOpenSettings,
  }: Props = $props();

  const items = $derived<PickerItem[]>(
    canvases.map((c) => ({
      id: c.id,
      label: c.title,
      kind: "canvas" as const,
      meta: `${c.nodeCount} object${c.nodeCount === 1 ? "" : "s"}`,
      lastModified: c.revision,
    })),
  );
</script>

<PickerShell
  {items}
  heading="Choose a canvas"
  createLabel="Create & open"
  createPlaceholder="Name it, like Launch plan"
  createInputId="canvas-title"
  createInputLabel="Canvas title"
  hint={`Inside "${workspaceName}". A canvas is an infinite board for notes, files and AI conversations. It's saved in this workspace.`}
  refreshLabel="Refresh canvas list"
  deleteLabel="Delete canvas"
  deleteConfirm={(label) =>
    `Delete "${label}" and everything in it, including saved review feedback, from this computer?`}
  showBack
  breadcrumb={workspaceName}
  {connected}
  {connection}
  {busy}
  {error}
  {onCreate}
  {onOpen}
  {onDelete}
  onRefresh={() => {}}
  {onBack}
  {onOpenSettings}
/>
