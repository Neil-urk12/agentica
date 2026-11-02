<script lang="ts">
  import { LIMITS, type Artifact, type CanvasNode } from "@agentica/protocol";
  import Icon from "./Icon.svelte";
  import { desktopMode } from "../runtime";
  import { compactSize, fitTextField } from "../canvas-view";
  import { fileKindLabel, formatFileSize } from "../files";

  type Geometry = Partial<Pick<CanvasNode, "x" | "y" | "width" | "height">>;

  interface Props {
    selected: CanvasNode | undefined;
    artifact: Artifact | undefined;
    /** Something is selected, possibly a project or session with no fields. */
    hasSelection: boolean;
    busy: boolean;
    canDraw: boolean;
    canFit: boolean;
    /** The selection is a conversation prompt or reply. */
    turn: boolean;
    fitNotice: string;
    onClose: () => void;
    onOpenFile: (artifactId: string) => void;
    onRead: (nodeId: string) => void;
    onCompact: () => void;
    onFit: () => void;
    onEditText: (artifactId: string, text: string) => void;
    onPlace: (nodeId: string, geometry: Geometry) => void;
  }

  let {
    selected,
    artifact,
    hasSelection,
    busy,
    canDraw,
    canFit,
    turn,
    fitNotice,
    onClose,
    onOpenFile,
    onRead,
    onCompact,
    onFit,
    onEditText,
    onPlace,
  }: Props = $props();

  const textArtifact = $derived(
    artifact?.type === "text" ? artifact : undefined,
  );
  const fileArtifact = $derived(
    artifact?.type === "file" ? artifact : undefined,
  );
</script>

<aside class="inspector" aria-label="Inspector">
  <div class="inspector__head">
    <h2><Icon name="tune" size={18} />Inspector</h2>
    <button
      class="icon-btn"
      type="button"
      title="Hide inspector"
      aria-label="Hide inspector"
      onclick={onClose}
    >
      <Icon name="close" size={18} />
    </button>
  </div>

  {#if selected && artifact}
    {#if fileArtifact}
      <div class="field">
        <span class="field__label">File</span>
        <p class="muted">
          {fileArtifact.name} · {fileKindLabel(fileArtifact.mime)} · {formatFileSize(
            fileArtifact.size,
          )}
        </p>
        <p class="muted">
          Copied into this workspace. Selected file text is included in the next
          prompt for the agent.
        </p>
        <div class="inspector__actions">
          <button
            class="btn btn--soft"
            type="button"
            onclick={() => onOpenFile(fileArtifact.id)}
          >
            <Icon name="open_in_new" size={16} />{desktopMode
              ? "Open with system app"
              : "Download a copy"}
          </button>
          {#if fileArtifact.text}
            <button
              class="btn btn--soft"
              type="button"
              onclick={() => onRead(selected.id)}
            >
              <Icon name="open_in_full" size={16} />Read extracted text
            </button>
          {/if}
        </div>
        {#if !fileArtifact.text}
          <p class="muted">
            No text could be extracted; images and legacy Word files are
            preview-only.
          </p>
        {/if}
      </div>
    {/if}
    {#if textArtifact}
      <div class="field">
        <label for="text-content"
          >{textArtifact.purpose === "instruction"
            ? "Agent instructions"
            : "Text content"}</label
        >
        <textarea
          id="text-content"
          value={textArtifact.text}
          maxlength={LIMITS.text}
          disabled={busy}
          rows="7"
          placeholder={textArtifact.purpose === "instruction"
            ? "Describe the task and the result you want…"
            : "Write something…"}
          oninput={(event) =>
            onEditText(textArtifact.id, fitTextField(event.currentTarget))}
        ></textarea>
      </div>
      {#if textArtifact.purpose === "instruction"}
        <div class="field">
          <label for="instruction-reference">Instruction reference</label>
          <input id="instruction-reference" readonly value={textArtifact.id} />
          <p class="muted">
            Saved as a note. Editing instructions does not start an agent.
          </p>
        </div>
      {/if}
    {/if}
    {#if textArtifact || (artifact.type === "drawing" && artifact.drawing.shapes.some((shape) => shape.kind !== "path" && shape.label))}
      <div class="field">
        <span class="field__label">Content</span>
        <div class="inspector__actions">
          <button
            class="btn btn--soft"
            type="button"
            onclick={() => onRead(selected.id)}
          >
            <Icon name="open_in_full" size={16} />Read full content
          </button>
          {#if turn}
            {@const compact = compactSize(selected)}
            <button
              class="btn btn--soft"
              type="button"
              disabled={!canDraw ||
                (compact.width === selected.width &&
                  compact.height === selected.height)}
              onclick={onCompact}
            >
              <Icon name="compress" size={16} />Compact conversation
            </button>
          {/if}
          {#if canFit}
            <button
              class="btn btn--soft"
              type="button"
              disabled={!canDraw}
              onclick={onFit}
            >
              <Icon name="height" size={16} />Fit text
            </button>
          {/if}
        </div>
        {#if fitNotice}<p class="muted" role="status">
            {fitNotice}
          </p>{/if}
      </div>
    {/if}
    <fieldset class="grid" disabled={busy}>
      <legend>Placement &amp; size</legend>
      {#each ["x", "y", "width", "height"] as field}
        {@const property = field as "x" | "y" | "width" | "height"}
        <label for={`node-${field}`}>{field}</label>
        <input
          id={`node-${field}`}
          type="number"
          step="any"
          min={field === "width" || field === "height"
            ? LIMITS.minSize
            : -LIMITS.coordinate}
          max={field === "width" || field === "height"
            ? LIMITS.maxSize
            : LIMITS.coordinate}
          value={selected[property]}
          oninput={(event) => {
            if (
              event.currentTarget.validity.valid &&
              event.currentTarget.value !== ""
            )
              onPlace(selected.id, {
                [property]: event.currentTarget.valueAsNumber,
              });
          }}
        />
      {/each}
    </fieldset>
  {:else if hasSelection}
    <p class="muted">Projects and sessions have no editable properties here.</p>
  {:else}
    <p class="muted">Select a node</p>
  {/if}
</aside>
