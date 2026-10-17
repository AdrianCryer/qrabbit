import { useEffect } from "react";
import { AGENTS } from "@qrabbit/shared";
import { useStore } from "../state/store";
import { Icon } from "./Icons";

/**
 * The first thing a new reader is asked: which agent to read with. Picking one downloads that agent's adapter and
 * CLI, and sign-in follows from the header. Escape puts the question off until the next launch.
 */
export function AgentChooser() {
  const chosen = useStore((s) => s.agentChosen);
  const installs = useStore((s) => s.installs);
  const { chooseAgent, dismissChooser } = useStore.getState();
  const open = chosen === false;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); dismissChooser(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, dismissChooser]);

  if (!open) return null;
  return (
    <div className="overlay">
      <div className="dialog chooser" role="dialog" aria-modal="true" aria-label="Choose an agent">
        <div className="dbody">
          <h2>Which agent will you read with?</h2>
          <p className="dsub">
            Qrabbit runs on the agent subscription you already pay for and never asks for an API key. The one you pick downloads now; you sign in from the header once it is ready, and can switch any time in Settings.
          </p>
          <div className="choices">
            {AGENTS.map((a) => {
              const ready = installs[a.id]?.state === "ready";
              return (
                <button key={a.id} className="choice" onClick={() => void chooseAgent(a.id)}>
                  <Icon name="terminal" />
                  <span className="t">{a.title}</span>
                  <span className="m">{a.plan}</span>
                  <span className="m">{ready ? "Ready to use" : `${a.download} download`}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
