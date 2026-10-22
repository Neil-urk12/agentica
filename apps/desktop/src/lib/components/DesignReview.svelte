<script lang="ts">
  import { tick } from "svelte";
  import Modal from "./Modal.svelte";
  import Icon from "./Icon.svelte";
  import {
    REVIEW_LIMITS,
    describeElement,
    usableComments,
    type DesignComment,
  } from "../design-review.ts";

  interface Props {
    html: string;
    width: number;
    height: number;
    comments: DesignComment[];
    /** Why a revision cannot start now, or "" when it can. */
    blocked: string;
    onChange: (comments: DesignComment[]) => void;
    onGenerate: () => void;
    onClose: () => void;
  }
  let {
    html,
    width,
    height,
    comments,
    blocked,
    onChange,
    onGenerate,
    onClose,
  }: Props = $props();

  let stageWidth = $state(0);
  let frame = $state<HTMLIFrameElement>();
  let list = $state<HTMLOListElement>();
  // Render the design at its canvas size, scaled down to fit the dialog, so
  // its layout matches the node and pins map to the same elements.
  const scale = $derived(
    stageWidth
      ? Math.min(1, stageWidth / width, (window.innerHeight * 0.5) / height)
      : 0,
  );
  const full = $derived(comments.length >= REVIEW_LIMITS.comments);
  const ready = $derived(usableComments(comments).length > 0);

  async function add(pin: DesignComment["pin"]) {
    if (full) return;
    const comment = { id: crypto.randomUUID(), text: "", pin };
    onChange([...comments, comment]);
    await tick();
    list
      ?.querySelector<HTMLTextAreaElement>(`[data-comment="${comment.id}"]`)
      ?.focus();
  }

  function pinAt(event: MouseEvent) {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width;
    const y = (event.clientY - box.top) / box.height;
    let target = "";
    try {
      // The frame is unscaled inside its own document.
      target = describeElement(
        frame?.contentDocument?.elementFromPoint(x * width, y * height) ?? null,
      );
    } catch {
      // A frame without document access still accepts positional pins.
    }
    void add({ x, y, target });
  }

  function update(id: string, text: string) {
    onChange(
      comments.map((comment) =>
        comment.id === id ? { ...comment, text } : comment,
      ),
    );
  }

  function remove(id: string) {
    onChange(comments.filter((comment) => comment.id !== id));
  }
</script>

<Modal
  title="Annotate design"
  subtitle="Click the design to pin a comment, or add a general one. A revised design is proposed beside the original."
  icon="rate_review"
  wide
  {onClose}
>
  <div class="review">
    <div class="review__stage" bind:clientWidth={stageWidth}>
      <div
        class="review__canvas"
        style:width={`${width * scale}px`}
        style:height={`${height * scale}px`}
      >
        <iframe
          bind:this={frame}
          class="review__frame"
          title="Design being annotated"
          sandbox="allow-same-origin"
          srcdoc={html}
          referrerpolicy="no-referrer"
          tabindex="-1"
          style:width={`${width}px`}
          style:height={`${height}px`}
          style:transform={`scale(${scale})`}
        ></iframe>
        <button
          class="review__overlay"
          type="button"
          aria-label="Pin a comment at this point of the design"
          disabled={full}
          onclick={pinAt}
        ></button>
        {#each comments as comment, index (comment.id)}
          {#if comment.pin}
            <span
              class="review__pin"
              style:left={`${comment.pin.x * 100}%`}
              style:top={`${comment.pin.y * 100}%`}
              aria-hidden="true">{index + 1}</span
            >
          {/if}
        {/each}
      </div>
    </div>

    {#if comments.length}
      <ol class="review__list" bind:this={list}>
        {#each comments as comment, index (comment.id)}
          <li class="review__item">
            <span class="review__number" aria-hidden="true">{index + 1}</span>
            <div class="review__field">
              <label for={`comment-${comment.id}`}>
                {comment.pin
                  ? `Pinned${comment.pin.target ? ` on ${comment.pin.target}` : ""}`
                  : "Whole design"}
              </label>
              <textarea
                id={`comment-${comment.id}`}
                data-comment={comment.id}
                rows="2"
                maxlength={REVIEW_LIMITS.text}
                placeholder="What should change?"
                value={comment.text}
                oninput={(event) =>
                  update(comment.id, event.currentTarget.value)}></textarea>
            </div>
            <button
              class="btn btn--ghost review__remove"
              type="button"
              aria-label={`Remove comment ${index + 1}`}
              onclick={() => remove(comment.id)}
              ><Icon name="close" size={16} /></button
            >
          </li>
        {/each}
      </ol>
    {:else}
      <p class="review__empty">No comments yet.</p>
    {/if}

    {#if blocked}<p class="review__blocked" role="status">{blocked}</p>{/if}
    <div class="review__actions">
      <button
        class="btn btn--soft"
        type="button"
        disabled={full}
        onclick={() => add(null)}
        ><Icon name="add_comment" size={16} /> General comment</button
      >
      <span class="review__count"
        >{comments.length}/{REVIEW_LIMITS.comments}</span
      >
      <button class="btn btn--ghost" type="button" onclick={onClose}
        >Keep for later</button
      >
      <button
        class="btn btn--primary"
        type="button"
        disabled={!ready || !!blocked}
        onclick={onGenerate}
        ><Icon name="auto_awesome" size={16} /> Generate revision</button
      >
    </div>
  </div>
</Modal>
