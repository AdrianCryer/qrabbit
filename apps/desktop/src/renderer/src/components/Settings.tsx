import { useEffect, useState } from "react";
import { AGENTS, agentDefaults, agentInfo, billingLine, isAgentId, type CloudDevice } from "@qrabbit/shared";
import { useStore, type SettingsTab } from "../state/store";
import { api } from "../lib/api";
import { displayPath } from "../lib/paths";
import { formatKeys, SHORTCUTS } from "../lib/shortcuts";
import { ago, fmtStorage } from "../lib/time";
import { Icon } from "./Icons";

const REOPEN_KEY = "qrabbit:reopen-last";
const TAB_KEY = "qrabbit:settings-tab";
const errText = (err: unknown) => String((err as Error)?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

/** The pages down the side of the dialog, in order. Cloud only shows in a build that can reach it. */
const TABS: { id: SettingsTab; label: string; title: string; icon: string }[] = [
  { id: "agent", label: "Agent", title: "Agent", icon: "bot" },
  { id: "cloud", label: "Cloud", title: "QRabbit Cloud", icon: "cloud" },
  { id: "general", label: "General", title: "General", icon: "sliders" },
  { id: "shortcuts", label: "Shortcuts", title: "Shortcuts", icon: "keyboard" },
];

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

/** The page the dialog was last on, so Ctrl+, comes back to it. */
function readTab(): SettingsTab | null {
  try {
    const v = localStorage.getItem(TAB_KEY);
    return TABS.some((t) => t.id === v) ? (v as SettingsTab) : null;
  } catch {
    return null;
  }
}

function rememberTab(id: SettingsTab) {
  try {
    localStorage.setItem(TAB_KEY, id);
  } catch {
    /* ignore */
  }
}

/** Which agent answers on this computer, its sign-in, and what new threads in the open collection start on. */
function AgentPanel() {
  const collection = useStore((s) => s.collection);
  const agentId = useStore((s) => s.agentId);
  const agent = useStore((s) => s.agent);
  const known = useStore((s) => s.knownOptions);
  const optionsLoading = useStore((s) => s.optionsLoading);
  const optionsError = useStore((s) => s.optionsError);
  const { updateAgentDefaults, loginAgent, connectAgent, chooseAgent, refreshOptions } = useStore.getState();

  const info = agentInfo(agentId);
  const defaults = collection ? agentDefaults(collection.manifest.settings, agentId) : {};
  const signIn = agent?.authMethods.length ? agent.authMethods : info.signIn;
  const modelOpt = known.find((o) => o.category === "model" || o.id === "model");
  const effortOpt = known.find((o) => o.category === "thought_level" || o.id === "effort");
  // What the agent starts on when nothing is chosen here: the agent's own configured model, or its recommended default.
  const currentName = (opt: typeof modelOpt) => {
    if (!opt) return null;
    const cur = opt.options?.find((o) => o.value === opt.currentValue);
    if (!cur) return typeof opt.currentValue === "string" ? opt.currentValue : null;
    return cur.value === "default" && cur.description ? `${cur.name} · ${cur.description}` : cur.name;
  };
  const agentModel = currentName(modelOpt);
  const agentEffort = currentName(effortOpt);

  return (
    <>
      <section>
        <div className="drow">
          <label className="field">
            <span>Agent on this computer</span>
            <select id="settings-agent" value={agentId} onChange={(e) => { if (isAgentId(e.target.value)) void chooseAgent(e.target.value); }}>
              {AGENTS.map((a) => (
                <option key={a.id} value={a.id}>{a.title} · {a.plan}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="dsub">
          {agent?.connected ? `Connected to ${info.title}. ${agent.auth ? billingLine(agent.auth) : ""}` : collection ? "Not connected." : `Connects to ${info.title} when a collection opens.`}
        </p>
        {collection && (
          <div className="drow">
            <button className="btn" onClick={() => void connectAgent()}><Icon name="refresh" />{agent?.connected ? "Reconnect" : "Connect"}</button>
            {signIn.map((m) => (
              <button key={m.id} className="btn" title={m.description} onClick={() => void loginAgent(m.id)}><Icon name="key" />Sign in with {m.name}</button>
            ))}
          </div>
        )}
      </section>
      {collection && (
        <section>
          <h3>Defaults for new threads</h3>
          <p className="dsub">In {collection.info.name}, a thread keeps whatever you pick in its composer; these apply until you do. Saved in the collection's manifest, separately for each agent.</p>
          <div className="drow">
            <label className="field">
              <span>Model</span>
              <select id="settings-model" value={defaults.model ?? ""} disabled={optionsLoading && !modelOpt} onChange={(e) => void updateAgentDefaults({ model: e.target.value || undefined })}>
                <option value="">{agentModel ? `Agent default (${agentModel})` : "Agent default"}</option>
                {modelOpt?.options?.map((o) => (
                  <option key={o.value} value={o.value}>{o.name}{o.value === "default" && o.description ? ` · ${o.description}` : ""}</option>
                ))}
                {defaults.model && !modelOpt?.options?.some((o) => o.value === defaults.model) && <option value={defaults.model}>{defaults.model}</option>}
              </select>
            </label>
            <label className="field">
              <span>Effort</span>
              <select id="settings-effort" value={defaults.effort ?? ""} disabled={optionsLoading && !effortOpt} onChange={(e) => void updateAgentDefaults({ effort: e.target.value || undefined })}>
                <option value="">{agentEffort ? `Agent default (${agentEffort})` : "Agent default"}</option>
                {effortOpt?.options?.map((o) => (
                  <option key={o.value} value={o.value}>{o.name}</option>
                ))}
                {defaults.effort && !effortOpt?.options?.some((o) => o.value === defaults.effort) && <option value={defaults.effort}>{defaults.effort}</option>}
              </select>
            </label>
          </div>
          {optionsLoading && !modelOpt && <p className="dsub">Asking the agent for its models…</p>}
          {optionsError && agent?.auth?.kind === "none" && <p className="dsub">Sign in to {info.title} to see its models.</p>}
          {optionsError && agent?.auth?.kind !== "none" && (
            <p className="dsub">
              Could not reach the agent: {optionsError} <button className="btn" onClick={() => void refreshOptions()}><Icon name="refresh" />Try again</button>
            </p>
          )}
          {modelOpt && (
            <p className="dsub">
              The agent's own default is whatever {info.title} is set to ({info.ownDefault}). A choice here overrides it for new threads in this collection; a thread keeps a model only once you pick one in its composer.
            </p>
          )}
        </section>
      )}
    </>
  );
}

/** Sign in with an emailed code; then the account: room used, computers, collections in the cloud. */
function CloudPanel() {
  const cloud = useStore((s) => s.cloud);
  const cloudCollections = useStore((s) => s.cloudCollections);
  const home = useStore((s) => s.home);
  const { cloudRequestCode, cloudVerifyCode, cloudSignOut, refreshCloud, removeCloudCollection } = useStore.getState();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<CloudDevice[]>([]);
  // "Remove" asks once by turning into "Really remove" for a few seconds.
  const [removing, setRemoving] = useState<string | null>(null);
  const signedIn = !!cloud?.signedIn;

  useEffect(() => {
    if (!signedIn) {
      setDevices([]);
      return;
    }
    void refreshCloud();
    void api.cloud.devices().then(setDevices).catch(() => setDevices([]));
  }, [signedIn, refreshCloud]);

  useEffect(() => {
    if (!removing) return;
    const t = setTimeout(() => setRemoving(null), 4000);
    return () => clearTimeout(t);
  }, [removing]);

  if (!cloud?.available) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!sent) {
        await cloudRequestCode(email.trim());
        setSent(true);
      } else {
        await cloudVerifyCode(email.trim(), code);
        setSent(false);
        setCode("");
      }
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  if (!signedIn) {
    return (
      <section>
        <p className="dsub">Keep collections in step across your computers, with a copy of every file. Sign in with your email: a code arrives by email, and there is no password.</p>
        <form className="drow" onSubmit={(e) => void submit(e)}>
          <label className="field">
            <span>Email</span>
            <input type="email" value={email} autoFocus disabled={sent} autoComplete="email" onChange={(e) => setEmail(e.target.value)} />
          </label>
          {!sent ? (
            <button className="btn primary" type="submit" disabled={busy || !email.includes("@")}><Icon name="mail" />Send code</button>
          ) : (
            <>
              <label className="field">
                <span>Code from the email</span>
                <input inputMode="numeric" autoComplete="one-time-code" value={code} autoFocus onChange={(e) => setCode(e.target.value)} />
              </label>
              <button className="btn primary" type="submit" disabled={busy || code.replace(/\D/g, "").length < 6}><Icon name="key" />Sign in</button>
              <button className="btn" type="button" onClick={() => { setSent(false); setCode(""); setError(null); }}>Another email</button>
            </>
          )}
        </form>
        {sent && !error && <p className="dsub">The code is on its way to {email.trim()}. It works once and expires in ten minutes.</p>}
        {error && <p className="err">{error}</p>}
      </section>
    );
  }

  const used = cloud.usedBytes ?? 0;
  const quota = cloud.quotaBytes;
  return (
    <>
      <section>
        <p className="dsub">Signed in as {cloud.email}.{cloud.error ? ` The cloud could not be reached just now: ${cloud.error}` : ""}</p>
        {quota !== undefined && (
          <div className="usage">
            <div className={`bar ${used / quota >= 0.95 ? "full" : ""}`}><i style={{ width: `${Math.min(100, (used / quota) * 100)}%` }} /></div>
            <span>{fmtStorage(used)} of {fmtStorage(quota)} used</span>
          </div>
        )}
      </section>
      <section>
        <h3>Computers</h3>
        <ul className="machines">
          {devices.map((d) => (
            <li key={d.id}>
              <Icon name="monitor" />
              <span className="name">{d.name}</span>
              {d.current && <span className="this">this computer</span>}
              <span className="m">{d.platform === "win32" ? "Windows" : d.platform === "darwin" ? "macOS" : d.platform === "linux" ? "Linux" : d.platform} · seen {ago(d.lastSeenAt)}</span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3>Collections in the cloud</h3>
        {cloudCollections.length === 0 ? (
          <p className="dsub">None yet. Open a collection and choose "Keep in the cloud" from the cloud menu in the header.</p>
        ) : (
          <ul className="machines">
            {cloudCollections.map((c) => (
              <li key={c.id}>
                <Icon name="cloud" />
                <span className="name">{c.name}</span>
                <span className="m">{c.localPath ? displayPath(c.localPath, home) : "not on this computer"} · {ago(c.updatedAt)}</span>
                {removing === c.id ? (
                  <button className="btn danger" onClick={() => { setRemoving(null); void removeCloudCollection(c.id); }}>Really remove</button>
                ) : (
                  <button className="btn quiet" title="Take it out of the cloud; every computer keeps its folder" onClick={() => setRemoving(c.id)}>Remove</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <div className="drow">
          <button className="btn" onClick={() => void cloudSignOut("local")}><Icon name="x" />Sign out</button>
          <button className="btn" onClick={() => void cloudSignOut("others")}><Icon name="monitor" />Sign out other computers</button>
        </div>
      </section>
    </>
  );
}

function GeneralPanel() {
  const [reopen, setReopen] = useState(() => readFlag(REOPEN_KEY));
  const toggleReopen = (v: boolean) => {
    setReopen(v);
    try {
      localStorage.setItem(REOPEN_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  };
  return (
    <section>
      <h3>On launch</h3>
      <label className="check">
        <input type="checkbox" checked={reopen} onChange={(e) => toggleReopen(e.target.checked)} />
        <span>Reopen the last collection instead of showing the list</span>
      </label>
    </section>
  );
}

function ShortcutsPanel() {
  const platform = useStore((s) => s.platform);
  const groups = new Map<string, typeof SHORTCUTS>();
  for (const s of SHORTCUTS) {
    if (!groups.has(s.group)) groups.set(s.group, []);
    groups.get(s.group)!.push(s);
  }
  return (
    <>
      {[...groups.entries()].map(([g, items]) => (
        <section key={g}>
          <h3>{g}</h3>
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
        </section>
      ))}
    </>
  );
}

export function Settings() {
  const open = useStore((s) => s.settingsOpen);
  const requested = useStore((s) => s.settingsTab);
  const cloudAvailable = useStore((s) => !!s.cloud?.available);
  const { setSettingsOpen } = useStore.getState();
  const [tab, setTab] = useState<SettingsTab>(() => requested ?? readTab() ?? "agent");

  // A menu that opens Settings lands on its own page; Ctrl+, comes back to the page last used.
  useEffect(() => {
    if (!open) return;
    setTab(requested ?? readTab() ?? "agent");
    if (requested) rememberTab(requested);
  }, [open, requested]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); setSettingsOpen(false); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, setSettingsOpen]);

  if (!open) return null;

  const tabs = TABS.filter((t) => t.id !== "cloud" || cloudAvailable);
  const current = tabs.find((t) => t.id === tab) ?? tabs[0]!;
  const pick = (id: SettingsTab) => {
    setTab(id);
    rememberTab(id);
  };
  // Arrow keys move along the list; Home and End jump to its ends.
  const onTabKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (!dir && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const i = tabs.findIndex((t) => t.id === current.id);
    const next = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (i + dir + tabs.length) % tabs.length;
    pick(tabs[next]!.id);
    e.currentTarget.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
  };

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setSettingsOpen(false); }}>
      <div className="dialog settings" role="dialog" aria-modal="true" aria-label="Settings">
        <nav className="stabs" aria-label="Settings pages">
          <div className="stitle">Settings</div>
          <div className="stablist" role="tablist" aria-orientation="vertical" onKeyDown={onTabKey}>
            {tabs.map((t) => (
              <button
                key={t.id}
                id={`stab-${t.id}`}
                role="tab"
                className="stab"
                aria-selected={t.id === current.id}
                aria-controls={`spanel-${t.id}`}
                tabIndex={t.id === current.id ? 0 : -1}
                onClick={() => pick(t.id)}
              >
                <Icon name={t.icon} />
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </nav>
        <div className="spanel" role="tabpanel" id={`spanel-${current.id}`} aria-labelledby={`stab-${current.id}`}>
          <div className="dhead">
            <h2>{current.title}</h2>
            <button className="btn icon" title="Close (Esc)" onClick={() => setSettingsOpen(false)}>
              <Icon name="x" />
            </button>
          </div>
          <div className="dbody" key={current.id}>
            {current.id === "agent" && <AgentPanel />}
            {current.id === "cloud" && <CloudPanel />}
            {current.id === "general" && <GeneralPanel />}
            {current.id === "shortcuts" && <ShortcutsPanel />}
          </div>
        </div>
      </div>
    </div>
  );
}
