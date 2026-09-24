import type { QrabbitApi } from "@qrabbit/shared";

declare global {
  interface Window {
    qrabbit: QrabbitApi;
  }
}

export {};
