<script lang="ts">
  import { formatHtml, linesToText } from "../html-format.ts";

  interface Props {
    source: string;
  }
  let { source }: Props = $props();
  const lines = $derived(formatHtml(source));

  /** Formatted text for the copy action. */
  export function text() {
    return linesToText(lines);
  }
</script>

<!-- Tokens are text nodes: the design's markup is displayed, never parsed. -->
<pre class="code-view" aria-label="Formatted HTML source"><code
    >{#each lines as line, index (index)}<span
        class="code-view__line"
        style:padding-left={`${line.indent * 2}ch`}
        >{#each line.tokens as token, at (at)}<span
            class={`tok tok--${token.kind}`}>{token.text}</span
          >{/each}{"\n"}</span
      >{/each}</code
  ></pre>
