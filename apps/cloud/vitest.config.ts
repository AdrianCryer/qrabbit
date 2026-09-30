import { defineConfig } from "vitest/config";

// Every test talks to the local Supabase stack, so they run one file at a time and get generous timeouts.
export default defineConfig({
  test: {
    dir: "src",
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
