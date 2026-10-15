import { defineConfig, externalizeDepsPlugin, loadEnv } from "electron-vite";
import react from "@vitejs/plugin-react";

// Workspace packages are TypeScript sources and the ACP SDK is ESM-only; bundle them into the
// CommonJS main build instead of requiring them at runtime. The Claude adapter stays external:
// it is spawned as a separate process, never imported. The web extraction libraries (readability,
// linkedom, turndown) and the Supabase client are plain CommonJS and stay external too: they are
// listed as dependencies of this app so Electron resolves them, and their own dependencies, from
// node_modules at runtime.
const bundled = ["@qrabbit/shared", "@qrabbit/workspace", "@qrabbit/acp-client", "@qrabbit/cloud-api", "@qrabbit/cloud-sync", "@agentclientprotocol/sdk"];

// The cloud a build talks to comes from the build's environment, never the source: environment variables, or
// .env.<mode>.local here (see .env.example), so .env.production.local for release builds and .env.development.local
// for `pnpm desktop:dev`. Only these two names reach the bundle.
const CLOUD_ENV = ["QRABBIT_CLOUD_URL", "QRABBIT_CLOUD_PUBLISHABLE_KEY"] as const;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "QRABBIT_CLOUD_");
  const missing = CLOUD_ENV.filter((name) => !env[name]);
  if (missing.length) {
    console.warn(`[qrabbit] ${missing.join(" and ")} not set for ${mode}: the app will have no cloud. See apps/desktop/.env.example.`);
  }
  return {
    main: {
      plugins: [externalizeDepsPlugin({ exclude: bundled })],
      define: Object.fromEntries(CLOUD_ENV.map((name) => [`import.meta.env.${name}`, JSON.stringify(env[name] ?? "")])),
    },
    preload: {
      plugins: [externalizeDepsPlugin({ exclude: bundled })],
    },
    renderer: {
      plugins: [react()],
      worker: { format: "es" },
    },
  };
});
