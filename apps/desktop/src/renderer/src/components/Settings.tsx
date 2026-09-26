import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import { formatKeys, SHORTCUTS } from "../lib/shortcuts";
import { Icon } from "./Icons";

const REOPEN_KEY = "qrabbit:reopen-last";

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function Settings() {
  const open = useStore((s) => s.settingsOpen);
  const platform = useStore((s) => s.platform);
  const collection = useStore((s) => s.collection);
  const agent = useStore((s) => s.agent);
  const known = useStore((s) => s.knownOptions);
  const optionsLoading = useStore((s) => s.optionsLoading);
  const optionsError = useStore((s) => s.optionsError);
  const { setSettingsOpen, updateCollectionSettings, loginAgent, connectAgent, refreshOptions } = useStore.getState();
  const [reopen, setReopen] = useState(() => readFlag(REOPEN_KEY));

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); setSettingsOpen(false); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, setSettingsOpen]);

  if (!open) return null;

  const settings = collection?.manifest.settings ?? {};
  const modelOpt = known.find((o) => o.category === "model" || o.id === "model");
  const effortOpt = known.find((o) => o.category === "thought_level" || o.id === "effort");
  // What the agent starts on when nothing is chosen here: Claude Code's own /model choice, or its recommended default.
  const currentName = (opt: typeof modelOpt) => {
    if (!opt) return null;
    const cur = opt.options?.find((o) => o.value === opt.currentValue);
    if (!cur) return typeof opt.currentValue === "string" ? opt.currentValue : null;
    return cur.value === "default" && cur.description ? `${cur.name} · ${cur.description}` : cur.name;
  };
  const agentModel = currentName(modelOpt);
  const agentEffort = currentName(effortOpt);
  const groups = new Map<string, typeof SHORTCUTS>();
  for (const s of SHORTCUTS) {
    if (!groups.has(s.group)) groups.set(s.group, []);
    groups.get(s.group)!.push(s);
  }
  const toggleReopen = (v: boolean) => {
    setReopen(v);
    try {
      localStorage.setItem(REOPEN_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setSettingsOpen(false); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Settings">
        <div className="dhead">
          <h2>Settings</h2>
          <button className="btn icon" title="Close (Esc)" onClick={() => setSettingsOpen(false)}>
            <Icon name="x" />
          </button>
        </div>
        <div className="dbody">
          <section>
            <h3>Agent</h3>
            <p className="dsub">
              {agent?.connected ? `Connected to ${agent.agent?.name?.includes("claude") ? "Claude Code" : agent.agent?.name}. ${agent.auth ? `Turns bill to ${agent.auth.label}.` : ""}` : "Not connected."}
            </p>
            <div className="drow">
              <button className="btn" onClick={() => void connectAgent()}><Icon name="refresh" />{agent?.connected ? "Reconnect" : "Connect"}</button>
              <button className="btn" onClick={() => void loginAgent("claude-ai-login")}><Icon name="key" />Sign in with Claude subscription</button>
              <button className="btn" onClick={() => void loginAgent("console-login")}><Icon name="key" />Sign in with Anthropic Console</button>
            </div>
            {collection && (
              <>
                <h4>Defaults for new threads in {collection.info.name}</h4>
                <p className="dsub">A thread keeps whatever you pick in its composer; these apply until you do. Saved in the collection's manifest.</p>
                <div className="drow">
                  <label className="field">
                    <span>Model</span>
                    <select id="settings-model" value={settings.model ?? ""} disabled={optionsLoading && !modelOpt} onChange={(e) => void updateCollectionSettings({ model: e.target.value || undefined })}>
                      <option value="">{agentModel ? `Agent default (${agentModel})` : "Agent default"}</option>
                      {modelOpt?.options?.map((o) => (
                        <option key={o.value} value={o.value}>{o.name}{o.value === "default" && o.description ? ` · ${o.description}` : ""}</option>
                      ))}
                      {!modelOpt && settings.model && <option value={settings.model}>{settings.model}</option>}
                    </select>
                  </label>
                  <label className="field">
                    <span>Effort</span>
                    <select id="settings-effort" value={settings.effort ?? ""} disabled={optionsLoading && !effortOpt} onChange={(e) => void updateCollectionSettings({ effort: e.target.value || undefined })}>
                      <option value="">{agentEffort ? `Agent default (${agentEffort})` : "Agent default"}</option>
                      {effortOpt?.options?.map((o) => (
                        <option key={o.value} value={o.value}>{o.name}</option>
                      ))}
                      {!effortOpt && settings.effort && <option value={settings.effort}>{settings.effort}</option>}
                    </select>
                  </label>
                </div>
                {optionsLoading && !modelOpt && <p className="dsub">Asking the agent for its models…</p>}
                {optionsError && (
                  <p className="dsub">
                    Could not reach the agent: {optionsError} <button className="btn" onClick={() => void refreshOptions()}><Icon name="refresh" />Try again</button>
                  </p>
                )}
                {modelOpt && (
                  <p className="dsub">
                    The agent's own default is whatever Claude Code is set to (its /model choice in ~/.claude/settings.json, or ANTHROPIC_MODEL). A choice here overrides it for new threads in this collection; a thread keeps a model only once you pick one in its composer.
                  </p>
                )}
              </>
            )}
          </section>

          <section>
            <h3>On launch</h3>
            <label className="check">
              <input type="checkbox" checked={reopen} onChange={(e) => toggleReopen(e.target.checked)} />
              <span>Reopen the last collection instead of showing the list</span>
            </label>
          </section>

          <section>
            <h3>Shortcuts</h3>
            {[...groups.entries()].map(([g, items]) => (
              <div key={g} className="kgroup">
                <h4>{g}</h4>
                <table className="keys">
                  <tbody>
                    {items.map((s) => (
                      <tr key={s.id}>
                        <td>{s.label}</td>
                        <td>
                          {formatKeys(s.keys, platform).map((k, i) => (
                            <kbd key={i}>{k}</kbd>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}
