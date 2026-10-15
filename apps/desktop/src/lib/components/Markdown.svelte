<script lang="ts">
  import { desktopMode } from "../runtime";
  import { parseMarkdown, type Inline } from "../markdown";

  interface Props {
    source: string;
    /**
     * Cards render links as text so they stay inside a single focusable
     * control; the reader makes safe HTTP(S) links actionable.
     */
    links?: boolean;
  }
  let { source, links = false }: Props = $props();

  const blocks = $derived(parseMarkdown(source));
  // The desktop webview has no external-browser opener; navigating the app
  // window away would lose state, so links there show their destination only.
  const actionable = $derived(links && !desktopMode);
</script>

{#snippet inline(nodes: Inline[])}
  {#each nodes as node}
    {#if node.t === "text"}{node.v}{:else if node.t === "code"}<code
        >{node.v}</code
      >{:else if node.t === "strong"}<strong>{@render inline(node.c)}</strong
      >{:else if node.t === "em"}<em>{@render inline(node.c)}</em
      >{:else if node.href && actionable}<a
        href={node.href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        referrerpolicy="no-referrer">{@render inline(node.c)}</a
      >{:else if node.href && links}<span class="md-link"
        >{@render inline(node.c)}</span
      ><span class="md-href"> ({node.href})</span>{:else}<span class="md-link"
        >{@render inline(node.c)}</span
      >{/if}
  {/each}
{/snippet}

<div class="md">
  {#each blocks as block}
    {#if block.t === "p"}
      <p>{@render inline(block.c)}</p>
    {:else if block.t === "h"}
      <!-- Heading levels are relative to the card or reader title. -->
      <p
        class={`md-h md-h${block.level}`}
        role="heading"
        aria-level={Math.min(6, block.level + 1)}
      >
        {@render inline(block.c)}
      </p>
    {:else if block.t === "code"}
      <pre><code>{block.v}</code></pre>
    {:else if block.ordered}
      <ol start={block.start}>
        {#each block.items as item}
          <li style:margin-inline-start={`${item.depth * 1.25}em`}>
            {@render inline(item.c)}
          </li>
        {/each}
      </ol>
    {:else}
      <ul>
        {#each block.items as item}
          <li style:margin-inline-start={`${item.depth * 1.25}em`}>
            {@render inline(item.c)}
          </li>
        {/each}
      </ul>
    {/if}
  {/each}
</div>
