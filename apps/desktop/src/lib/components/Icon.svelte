<script lang="ts">
  interface Props {
    name: string;
    size?: number;
  }
  let { name, size = 20 }: Props = $props();
</script>

<span class="material-icons" aria-hidden="true" style="font-size: {size}px"
  >{name}</span
>
