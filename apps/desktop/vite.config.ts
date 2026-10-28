import tailwindcss from "@tailwindcss/vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

// @huggingface/transformers is only imported lazily inside the speech worker.
// Without pre-bundling it, Vite's dependency optimizer discovers it mid-session
// on first voice use and performs a full page reload ("new dependencies
// optimized, reloading"), which remounts the app and drops the user back to the
// workspace/canvas picker. Pre-including it here optimizes it (and its
// onnxruntime-web subgraph) during the cold startup scan instead, so loading
// the voice model never reloads the page.
const HEAVY_DEPS = ["@huggingface/transformers"];

export default defineConfig({
  plugins: [tailwindcss(), svelte()],
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    headers: {
      "Content-Security-Policy":
        "frame-src about: http://localhost:* https://localhost:* http://127.0.0.1:* https://127.0.0.1:*; frame-ancestors 'none'",
    },
    watch: { ignored: ["**/src-tauri/**"] },
  },
  optimizeDeps: {
    include: HEAVY_DEPS,
  },
});
