import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

// Workspace packages are TypeScript sources and the ACP SDK is ESM-only; bundle them into the
// CommonJS main build instead of requiring them at runtime. The agent adapters (Claude Code, Codex)
// stay external: each is spawned as a separate process, never imported. The web extraction libraries (readability,
// linkedom, turndown) and the Supabase client are plain CommonJS and stay external too: they are
// listed as dependencies of this app so Electron resolves them, and their own dependencies, from
// node_modules at runtime.
const bundled = ["@qrabbit/shared", "@qrabbit/workspace", "@qrabbit/acp-client", "@qrabbit/cloud-api", "@qrabbit/cloud-sync", "@agentclientprotocol/sdk"];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: bundled })],
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: bundled })],
  },
  renderer: {
    plugins: [react()],
    worker: { format: "es" },
  },
});
