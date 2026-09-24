import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

// Workspace packages are TypeScript sources and the ACP SDK is ESM-only; bundle them into the
// CommonJS main build instead of requiring them at runtime. The Claude adapter stays external:
// it is spawned as a separate process, never imported.
const bundled = ["@qrabbit/shared", "@qrabbit/workspace", "@qrabbit/acp-client", "@agentclientprotocol/sdk"];

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
