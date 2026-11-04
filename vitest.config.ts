import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The app's config holds its preprocessing; the default lookup is the repo root.
  plugins: [svelte({ configFile: "apps/desktop/svelte.config.js" })],
  test: {
    environment: "node",
    // Explicit: the default pattern would also pick up the node --test files.
    include: ["tests/*.vitest.mjs"],
    restoreMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["lcov"],
      // Vitest cleans this directory; keep it away from js.lcov and rust.lcov.
      reportsDirectory: "coverage/vitest",
    },
  },
});
