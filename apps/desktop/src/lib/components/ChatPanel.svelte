<script lang="ts">
  import { tick, type Snippet } from "svelte";
  import type { ConversationTurn } from "@agentica/protocol";
  import Icon from "./Icon.svelte";
  import Markdown from "./Markdown.svelte";
  import { turnStatus } from "../canvas-view";

  type Chat = { chatId: string; title: string; turns: number };

  interface Props {
    open: boolean;
    /** Loaded turns of the shown chat, newest first. */
    turns: ConversationTurn[];
    hasOlder: boolean;
    loadingOlder: boolean;
    olderError: string;
    onLoadOlder: () => Promise<void>;
    onClose: () => void;
    /** The shown chat; null until the first prompt of a new chat. */
    chatId: string | null;
    /** Switching is blocked while a turn runs, waits for review, or must be saved. */
    canSwitch: boolean;
    onOpenChat: (chatId: string | null) => void;
    listChats: () => Promise<{ chats: Chat[] }>;
    /** Panel width in pixels; the caller clamps and stores it. */
    width: number;
    onResize: (width: number) => void;
    /** Recovery, review, and composer controls for the current turn. */
    children: Snippet;
  }

  let {
    open,
    turns,
    hasOlder,
    loadingOlder,
    olderError,
    onLoadOlder,
    onClose,
    chatId,
    canSwitch,
    onOpenChat,
    listChats,
    width,
    onResize,
    children,
  }: Props = $props();

  let panel: HTMLElement | undefined = $state();
  let log: HTMLElement | undefined = $state();
  // New replies follow only while the reader is already at the latest message.
  let atBottom = true;
  const ordered = $derived([...turns].reverse());
  const latest = $derived(
    turns[0] ? `${turns[0].id}:${turns[0].status}:${turns[0].reply}` : "",
  );

  function scrolled() {
    if (log)
      atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
  }

  $effect(() => {
    void latest;
    if (!open) return;
    void tick().then(() => {
      if (atBottom && log) log.scrollTop = log.scrollHeight;
    });
  });

  let historyOpen = $state(false);
  let historyButton: HTMLButtonElement | undefined = $state();
  let chats = $state<Chat[]>([]);
  let chatsLoading = $state(false);
  let chatsError = $state("");

  async function toggleHistory() {
    historyOpen = !historyOpen;
    if (!historyOpen) return;
    chatsLoading = true;
    chatsError = "";
    try {
      chats = (await listChats()).chats;
    } catch (error) {
      chatsError =
        error instanceof Error ? error.message : "Chats could not be loaded.";
    } finally {
      chatsLoading = false;
    }
  }

  function closeHistory() {
    historyOpen = false;
    historyButton?.focus();
  }

  /** Open a chat (null for a new one) starting at its latest message. */
  function show(next: string | null) {
    historyOpen = false;
    atBottom = true;
    if (next !== chatId) onOpenChat(next);
  }

  /** Keyboard entry point after the panel is opened from its toggle. */
  export function focus() {
    panel?.focus();
  }

  /** Drag the left edge: the panel grows as the pointer moves left. */
  function startResize(event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    const grip = event.currentTarget as HTMLElement;
    const startX = event.clientX;
    const startWidth = width;
    grip.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) =>
      onResize(startWidth - (moveEvent.clientX - startX));
    const end = () => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", end);
      grip.removeEventListener("pointercancel", end);
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", end);
    grip.addEventListener("pointercancel", end);
  }

  /** Arrows nudge, shift arrows jump; left widens like dragging left. */
  function resizeByKey(event: KeyboardEvent) {
    const step = event.shiftKey ? 32 : 8;
    if (event.key === "ArrowLeft") onResize(width + step);
    else if (event.key === "ArrowRight") onResize(width - step);
    else return;
    event.preventDefault();
  }

  async function loadOlder() {
    const fromBottom = log ? log.scrollHeight - log.scrollTop : 0;
    await onLoadOlder();
    await tick();
    // Prepending keeps the message being read in place.
    if (log) log.scrollTop = log.scrollHeight - fromBottom;
  }
</script>

<svelte:window
  onkeydown={(event) => {
    if (historyOpen && event.key === "Escape") closeHistory();
  }}
/>

<aside
  class="chat"
  aria-label="Conversation"
  hidden={!open}
  tabindex="-1"
  style="--chat-w: {width}px"
  bind:this={panel}
>
  <button
    class="chat__grip"
    type="button"
    aria-label="Resize chat panel"
    title="Drag to resize"
    onpointerdown={startResize}
    onkeydown={resizeByKey}
  ></button>
  <div class="chat__head">
    <h2><Icon name="forum" size={18} />Chat</h2>
    <button
      class="icon-btn chat__history-toggle"
      class:icon-btn--active={historyOpen}
      type="button"
      title={canSwitch
        ? "Chat history"
        : "Chat history: finish or review the current turn first"}
      aria-label="Chat history"
      aria-expanded={historyOpen}
      aria-controls="chat-history"
      disabled={!canSwitch}
      bind:this={historyButton}
      onclick={() => void toggleHistory()}
    >
      <Icon name="history" size={18} />
    </button>
    <button
      class="btn btn--ghost chat__new"
      type="button"
      title="Start a new chat: the agent won't see other chats"
      disabled={!canSwitch || !chatId}
      onclick={() => show(null)}
    >
      <Icon name="add_comment" size={16} />New chat
    </button>
    <button
      class="icon-btn"
      type="button"
      title="Hide chat"
      aria-label="Hide chat"
      onclick={onClose}
    >
      <Icon name="close" size={18} />
    </button>
  </div>
  {#if historyOpen && canSwitch}
    <div
      id="chat-history"
      class="chat__history"
      role="region"
      aria-label="Chat history"
    >
      {#if chatsLoading}
        <p class="muted">Loading chats…</p>
      {:else if chatsError}
        <p class="chat__error" role="alert">{chatsError}</p>
      {:else if !chats.length}
        <p class="muted">No saved chats on this canvas yet.</p>
      {:else}
        <ul>
          {#each chats as chat (chat.chatId)}
            <li>
              <button
                class="chat__history-item"
                type="button"
                aria-current={chat.chatId === chatId ? "true" : undefined}
                onclick={() => show(chat.chatId)}
              >
                <span class="chat__history-title"
                  >{chat.title || "Untitled"}</span
                >
                <span class="muted"
                  >{chat.turns}
                  {chat.turns === 1 ? "exchange" : "exchanges"}</span
                >
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
  <div class="chat__log" bind:this={log} onscroll={scrolled}>
    {#if hasOlder || olderError}
      <div class="chat__older">
        {#if olderError}
          <p class="chat__error" role="alert">{olderError}</p>
        {/if}
        <button
          class="btn btn--soft"
          type="button"
          disabled={loadingOlder}
          onclick={() => void loadOlder()}
        >
          {olderError
            ? "Retry loading older messages"
            : loadingOlder
              ? "Loading…"
              : "Load older messages"}
        </button>
      </div>
    {/if}
    {#if !ordered.length}
      <p class="muted chat__empty">
        {chatId ? "" : "New chat. "}Ask about this canvas. Replies stay here;
        proposed canvas changes wait for your review. Earlier chats are in
        History.
      </p>
    {/if}
    <ol class="chat__turns">
      {#each ordered as turn (turn.id)}
        {@const sent = turnStatus(turn.status, "You")}
        {@const outcome = turnStatus(turn.status, "Agent")}
        <li class="chat__turn">
          <article class="chat__msg chat__msg--you" aria-label="Your prompt">
            <p class="chat__role">You</p>
            <p class="chat__text">{turn.prompt}</p>
          </article>
          <article class="chat__msg chat__msg--agent" aria-label="Agent reply">
            <p class="chat__role">
              Agent
              {#if outcome && (turn.reply || turn.status !== "complete")}
                <span class={`chip chip--${outcome.tone}`}>{outcome.label}</span
                >
              {/if}
            </p>
            {#if turn.reply}
              <Markdown source={turn.reply} links />
            {:else if turn.status === "generating"}
              <p class="muted">{sent?.label}…</p>
            {/if}
            {#if turn.error}
              <p class="chat__error">{turn.error}</p>
            {/if}
          </article>
        </li>
      {/each}
    </ol>
  </div>
  <div class="chat__controls">
    {@render children()}
  </div>
</aside>
