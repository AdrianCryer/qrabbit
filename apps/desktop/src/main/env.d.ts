// Values the build bakes into the main process (electron.vite.config.ts).
interface ImportMetaEnv {
  /** The hosted cloud's project URL; empty when the build's environment had none. */
  readonly QRABBIT_CLOUD_URL: string;
  /** The hosted cloud's publishable key (`sb_publishable_…`); empty when the build's environment had none. */
  readonly QRABBIT_CLOUD_PUBLISHABLE_KEY: string;
}
