import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { useStore } from "./state/store";
import "./styles.css";

// Handy for debugging and for driving the app from a script; the renderer runs no remote content.
(window as unknown as { __qrabbitStore: typeof useStore }).__qrabbitStore = useStore;

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
