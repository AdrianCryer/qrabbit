import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

// Workspace packages are TypeScript sources; bundle them instead of requiring them at runtime.
const bundled = ["@qrabbit/shared", "@qrabbit/workspace"];

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
