import { useEffect, useState } from "react";
import { AGENTS, agentInfo, authLabel, billingLine, type CloudAccount, type CloudSyncState } from "@qrabbit/shared";
import { useStore } from "../state/store";
import { displayPath } from "../lib/paths";
// The icon with its glyph cut out, so the header shows through it; make-icon.mjs writes it beside icon.svg.
import logo from "../../../../resources/mark.svg";
import { ago, fmtStorage, relTime } from "../lib/time";
import { Dropdown } from "./Dropdown";
import { Icon } from "./Icons";

/** The cloud pill's dot and its one-line state, from the account and the open collection's sync state. */
function cloudLine(cloud: CloudAccount | null, sync: CloudSyncState | null): { dot: "" | "on" | "busy" | "bad"; text: string } {
  if (!cloud?.signedIn) return { dot: "", text: "Not signed in to Qrabbit Cloud" };
  if (!sync) return { dot: "", text: "This collection is not in the cloud" };
  if (sync.phase === "syncing") return { dot: "busy", text: "Syncing…" };
  if (sync.phase === "error") return { dot: "bad", text: sync.error ? `Could not sync: ${sync.error}` : "Could not sync; trying again" };
  if (sync.unsaved > 0) return { dot: "bad", text: sync.unsaved === 1 ? "One file did not fit; the cloud is full" : `${sync.unsaved} files did not fit; the cloud is full` };
  return { dot: "on", text: sync.lastSync ? `Synced ${ago(sync.lastSync)}` : "Synced" };
}

/** What stays out of the cloud and why, after the live line; empty when everything syncs. */
function leftOut(sync: CloudSyncState): string {
  let out = "";
  if (sync.skipped) out += sync.skipped === 1 ? " One file name cannot be stored." : ` ${sync.skipped} file names cannot be stored.`;
  if (sync.tooLarge) out += sync.tooLarge === 1 ? " One file is over 50 MB and stays on this computer." : ` ${sync.tooLarge} files are over 50 MB and stay on this computer.`;
  return out;
}

const usageLine = (cloud: CloudAccount) => (cloud.usedBytes !== undefined && cloud.quotaBytes !== undefined ? ` · ${fmtStorage(cloud.usedBytes)} of ${fmtStorage(cloud.quotaBytes)} used` : "");

export function Header() {
  const screen = useStore((s) => s.screen);
  const recent = useStore((s) => s.recent);
  const home = useStore((s) => s.home);
  const collection = useStore((s) => s.collection);
  const sourceId = useStore((s) => s.sourceId);
  const threadId = useStore((s) => s.thread?.id ?? null);
  const { goHome, openCollection, openCollectionDialog, selectSource, showList, importSources, addFromFolder, toggleRead, openThread } = useStore.getState();

  const agentId = useStore((s) => s.agentId);
  const agent = useStore((s) => s.agent);
  const installs = useStore((s) => s.installs);
  const menu = useStore((s) => s.menu);
  const cloud = useStore((s) => s.cloud);
  const cloudSync = useStore((s) => s.cloudSync);
  const { connectAgent, loginAgent, chooseAgent, installAgent, setMenu, setSettingsOpen, setUrlDialogOpen, enableCloud, disableCloud, removeCloudCollection, syncNow } = useStore.getState();
  // Removing a collection from the cloud asks once, inside the menu; the question goes away with the menu.
  const [confirmRemove, setConfirmRemove] = useState(false);
  useEffect(() => {
    if (menu !== "cloud") setConfirmRemove(false);
  }, [menu]);
  const cl = cloudLine(cloud, cloudSync);
  const kindIcon = (kind: string) => (kind === "web" ? "globe" : kind === "markdown" ? "lines" : "file");
  // Page numbers mean something for PDFs only; articles are one page.
  const pageChip = (sourceId: string | undefined, page: number | undefined) =>
    page && collection?.sources.find((s) => s.id === sourceId)?.kind === "pdf" ? <span className="chip">p.{page}</span> : null;
  const controlled = (id: "collection" | "source" | "threads" | "marks" | "cloud") => ({ open: menu === id, onOpenChange: (v: boolean) => setMenu(v ? id : menu === id ? null : menu) });
  const annotations = collection?.annotations ?? [];
  const { goToAnnotation } = useStore.getState();
  const source = collection?.sources.find((s) => s.id === sourceId) ?? null;
  const readCount = collection?.sources.filter((s) => s.read).length ?? 0;
  // Branches are reached from their parent's outline; the popover lists root threads only.
  const threads = (collection?.threads ?? []).filter((t) => !t.parent);
  // Threads whose source was removed keep their quotes and stay reachable.
  const orphaned = threads.filter((t) => t.anchor?.source && !collection?.sources.some((s) => s.id === t.anchor?.source));
  const signedIn = !!agent?.connected && !!agent.auth && agent.auth.kind !== "none";
  const info = agentInfo(agentId);
  const install = installs[agentId];
  const downloading = install?.state === "installing";
  const agentLabel = downloading ? `Downloading ${info.title}…` : !agent ? "Agent" : agent.error ? "Agent failed" : !agent.connected ? "Connecting…" : authLabel(agent.auth) ?? info.title;
  const loginMethods = agent?.authMethods.length ? agent.authMethods : info.signIn;
  const threadItem = (t: (typeof threads)[number], close: () => void) => (
    <button key={t.id} className={`mi ${t.id === threadId ? "cur" : ""}`} role="menuitem" onClick={() => { close(); void openThread(t.id); }}>
      <span className={`dot h${t.hue}`} />
      <span className="txt">
        <span className="t">{t.title}</span>
        <span className="m">
          {relTime(t.created)} · {t.messageCount} messages
        </span>
      </span>
      <span className="meta">{pageChip(t.anchor?.source, t.anchor?.page)}</span>
    </button>
  );

  return (
    <header className="hdr">
      <button className="brand" onClick={goHome} title="All collections (Ctrl+Shift+H)">
        <img className="q" src={logo} alt="" draggable={false} />
        {screen === "home" && <span>Qrabbit</span>}
      </button>
      {screen === "home" && (
        <div className="hright">
          <button className="ibtn" title="Settings and shortcuts (Ctrl+,)" onClick={() => setSettingsOpen(true)}>
            <Icon name="gear" />
          </button>
        </div>
      )}

      {screen === "reader" && collection && (
        <>
          <Dropdown
            {...controlled("collection")}
            title="Switch collection"
            label={
              <>
                <span className="txt">{collection.info.name}</span>
                <Icon name="chevron" />
              </>
            }
          >
            {(close) => (
              <>
                <div className="mh">Collections</div>
                {recent.map((c) => (
                  <button key={c.path} className={`mi ${c.path === collection.info.path ? "cur" : ""}`} role="menuitem" onClick={() => { close(); void openCollection(c.path); }}>
                    <Icon name="folder" />
                    <span className="txt">
                      <span className="t">{c.name}</span>
                      <span className="m">{c.counts ? `${c.counts.sources} sources · ${c.counts.read} read · ${c.counts.threads} threads` : displayPath(c.path, home)}</span>
                    </span>
                    <span className="meta">{relTime(c.lastOpened)}</span>
                  </button>
                ))}
                <div className="msep" />
                <button className="mi" role="menuitem" onClick={() => { close(); void openCollectionDialog(); }}>
                  <Icon name="plus" />
                  <span className="txt"><span className="t">Open another folder…</span></span>
                </button>
                <button className="mi" role="menuitem" onClick={() => { close(); goHome(); }}>
                  <Icon name="home" />
                  <span className="txt"><span className="t">All collections</span></span>
                </button>
              </>
            )}
          </Dropdown>

          <span className="hsep">/</span>

          <Dropdown
            {...controlled("source")}
            className="hsrc"
            title="Switch source"
            label={
              source ? (
                <>
                  <Icon name={kindIcon(source.kind)} />
                  <span className="txt">{source.title}</span>
                  {source.kind === "pdf" && source.pages ? <span className="lbl">{source.pages} p.</span> : null}
                  <Icon name="chevron" />
                </>
              ) : (
                <>
                  <Icon name="list" />
                  <span className="txt">Reading list</span>
                  <span className="n">{collection.sources.length}</span>
                  <Icon name="chevron" />
                </>
              )
            }
          >
            {(close) => (
              <>
                <button className={`mi ${sourceId === null ? "cur" : ""}`} role="menuitem" onClick={() => { close(); showList(); }}>
                  <Icon name="list" />
                  <span className="txt">
                    <span className="t">Reading list</span>
                    <span className="m">{collection.sources.length} sources · {readCount} read</span>
                  </span>
                  <span className="meta"><kbd>Ctrl</kbd><kbd>L</kbd></span>
                </button>
                <div className="msep" />
                <div className="mh">In reading order</div>
                {collection.sources.length === 0 && <div className="mempty">No sources yet.</div>}
                {collection.sources.map((s) => (
                  <button key={s.id} className={`mi ${s.id === sourceId ? "cur" : ""}`} role="menuitem" {...(s.read ? { "data-read": "" } : {})} onClick={() => { close(); selectSource(s.id); }}>
                    <Icon name={kindIcon(s.kind)} />
                    <span className="txt">
                      <span className="t">{s.title}</span>
                      <span className="m">
                        {s.kind === "pdf" ? `PDF${s.pages ? ` · ${s.pages} pages` : ""}` : s.kind === "web" ? (s.siteName ?? s.url ?? "Web page") : "Markdown"}
                        {" · "}{threads.filter((t) => t.anchor?.source === s.id).length} threads
                      </span>
                    </span>
                    <span className="meta">
                      {s.id === sourceId && s.kind === "pdf" && collection.readerState[s.id] ? `p.${collection.readerState[s.id]!.page}` : null}
                      <span
                        className="mchk"
                        role="button"
                        aria-pressed={!!s.read}
                        title={s.read ? "Mark as unread" : "Mark as read"}
                        onClick={(e) => { e.stopPropagation(); void toggleRead(s.id); }}
                      >
                        <Icon name="check" />
                      </span>
                    </span>
                  </button>
                ))}
                <div className="msep" />
                <button className="mi" role="menuitem" onClick={() => { close(); void importSources(); }}>
                  <Icon name="plus" />
                  <span className="txt">
                    <span className="t">Add files…</span>
                    <span className="m">PDF, Markdown or text</span>
                  </span>
                  <span className="meta"><kbd>Ctrl</kbd><kbd>I</kbd></span>
                </button>
                <button className="mi" role="menuitem" onClick={() => { close(); void addFromFolder(); }}>
                  <Icon name="folder" />
                  <span className="txt">
                    <span className="t">Add from a folder…</span>
                    <span className="m">Pick which files to bring in</span>
                  </span>
                </button>
                <button className="mi" role="menuitem" onClick={() => { close(); setUrlDialogOpen(true); }}>
                  <Icon name="globe" />
                  <span className="txt">
                    <span className="t">Add a web page…</span>
                    <span className="m">Saved as reader-mode Markdown</span>
                  </span>
                </button>
              </>
            )}
          </Dropdown>

          <div className="hright">
            <Dropdown
              {...controlled("threads")}
              align="right"
              title="Threads in this collection (Ctrl+Shift+T)"
              label={
                <>
                  <Icon name="branch" />
                  <span className="txt">Threads</span>
                  <span className="n">{threads.length}</span>
                </>
              }
            >
              {(close) => (
                <>
                  {threads.length === 0 && <div className="mempty">Highlight something in the paper and choose Explore.</div>}
                  {collection.sources
                    .filter((s) => threads.some((t) => t.anchor?.source === s.id))
                    .map((s) => (
                      <div key={s.id}>
                        <div className="mh">{s.title}</div>
                        {threads.filter((t) => t.anchor?.source === s.id).map((t) => threadItem(t, close))}
                      </div>
                    ))}
                  {orphaned.length > 0 && (
                    <div>
                      <div className="mh">Removed sources</div>
                      {orphaned.map((t) => threadItem(t, close))}
                    </div>
                  )}
                  {threads.some((t) => !t.anchor) && (
                    <div>
                      <div className="mh">Unanchored</div>
                      {threads.filter((t) => !t.anchor).map((t) => (
                        <button key={t.id} className="mi" role="menuitem" onClick={() => { close(); void openThread(t.id); }}>
                          <span className={`dot h${t.hue}`} />
                          <span className="txt"><span className="t">{t.title}</span></span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </Dropdown>
            <Dropdown
              {...controlled("marks")}
              align="right"
              title="Bookmarks and comments (Ctrl+Shift+M)"
              label={
                <>
                  <Icon name="bookmark" />
                  <span className="txt">Marks</span>
                  <span className="n">{annotations.length}</span>
                </>
              }
            >
              {(close) => (
                <>
                  {annotations.length === 0 && <div className="mempty">Highlight a passage and choose Comment or Bookmark, or press Ctrl+D to bookmark a page.</div>}
                  {collection.sources
                    .filter((s) => annotations.some((a) => a.source === s.id))
                    .map((s) => (
                      <div key={s.id}>
                        <div className="mh">{s.title}</div>
                        {annotations
                          .filter((a) => a.source === s.id)
                          .sort((a, b) => (a.page ?? 0) - (b.page ?? 0))
                          .map((a) => (
                            <button key={a.id} className="mi" role="menuitem" onClick={() => { close(); goToAnnotation(a.id); }}>
                              <Icon name={a.kind} />
                              <span className="txt">
                                <span className="t">{a.text}</span>
                                {a.anchor && <span className="m">{a.anchor.quote}</span>}
                              </span>
                              <span className="meta">{pageChip(a.source, a.page)}</span>
                            </button>
                          ))}
                      </div>
                    ))}
                </>
              )}
            </Dropdown>
            {cloud?.available && (
              <Dropdown
                {...controlled("cloud")}
                align="right"
                title={cl.text}
                label={
                  <span className="cloudpill">
                    <Icon name="cloud" />
                    <span className={`dot ${cl.dot}`} />
                  </span>
                }
              >
                {(close) => (
                  <>
                    <div className="mh">Qrabbit Cloud</div>
                    {!cloud.signedIn ? (
                      <>
                        <div className="mempty">Keep this collection in step across your computers, with a copy of every file.</div>
                        <button className="mi" role="menuitem" onClick={() => { close(); setSettingsOpen(true, "cloud"); }}>
                          <Icon name="key" />
                          <span className="txt"><span className="t">Sign in…</span><span className="m">A code by email, no password</span></span>
                        </button>
                      </>
                    ) : !cloudSync ? (
                      <>
                        <div className="mempty">{cloud.email}{usageLine(cloud)}</div>
                        <button className="mi" role="menuitem" onClick={() => { close(); void enableCloud(); }}>
                          <Icon name="cloud" />
                          <span className="txt"><span className="t">Keep {collection.info.name} in the cloud</span><span className="m">Every file in this folder, PDFs included</span></span>
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="state">
                          <span>{cl.text}</span>
                          <span className="m">{cloudSync.live ? "Changes on other computers arrive as they happen." : "Checked every few minutes."}{leftOut(cloudSync)}</span>
                        </div>
                        <button className="mi" role="menuitem" onClick={() => { close(); void syncNow(); }}>
                          <Icon name="refresh" />
                          <span className="txt"><span className="t">Sync now</span></span>
                        </button>
                        <button className="mi" role="menuitem" onClick={() => { close(); void disableCloud(); }}>
                          <Icon name="x" />
                          <span className="txt"><span className="t">Stop syncing on this computer</span><span className="m">The copy in the cloud stays</span></span>
                        </button>
                        {confirmRemove ? (
                          <div className="confirm">
                            <span>Remove {collection.info.name} from the cloud? Every computer keeps its folder.</span>
                            <div className="btns">
                              <button className="btn danger" onClick={() => { close(); void removeCloudCollection(cloudSync.collectionId); }}>Remove</button>
                              <button className="btn" onClick={() => setConfirmRemove(false)}>Keep</button>
                            </div>
                          </div>
                        ) : (
                          <button className="mi danger" role="menuitem" onClick={() => setConfirmRemove(true)}>
                            <Icon name="trash" />
                            <span className="txt"><span className="t">Remove from the cloud…</span></span>
                          </button>
                        )}
                        <div className="msep" />
                        <button className="mi" role="menuitem" onClick={() => { close(); setSettingsOpen(true, "cloud"); }}>
                          <Icon name="gear" />
                          <span className="txt"><span className="t">Account and computers…</span><span className="m">{cloud.email}{usageLine(cloud)}</span></span>
                        </button>
                      </>
                    )}
                  </>
                )}
              </Dropdown>
            )}
            <Dropdown
              align="right"
              title={agent?.error ?? "Agent status and sign-in"}
              label={
                <span className="agent">
                  <span className={`dot ${signedIn ? "on" : downloading ? "busy" : ""}`} />
                  <span>{agentLabel}</span>
                </span>
              }
            >
              {(close) => (
                <>
                  <div className="mh">{info.title}{agent?.agent?.version ? ` · ${agent.agent.version}` : ""}</div>
                  <div className="mempty">
                    {downloading
                      ? `Downloading ${info.title}, ${info.download}: ${fmtStorage(install?.bytes ?? 0)} so far.`
                      : install?.state === "error"
                        ? `Could not download ${info.title}: ${install.error}`
                        : agent?.error
                          ? agent.error
                          : agent?.connected
                            ? agent.auth
                              ? billingLine(agent.auth)
                              : "Connected. The account is reported when the first message is sent."
                            : "Not connected."}
                  </div>
                  {install?.state === "error" && (
                    <button className="mi" role="menuitem" onClick={() => { close(); void installAgent(agentId); }}>
                      <Icon name="refresh" />
                      <span className="txt"><span className="t">Download again</span></span>
                    </button>
                  )}
                  <div className="msep" />
                  {loginMethods.map((m) => (
                    <button key={m.id} className="mi" role="menuitem" onClick={() => { close(); void loginAgent(m.id); }}>
                      <Icon name="key" />
                      <span className="txt">
                        <span className="t">Sign in · {m.name}</span>
                        {m.description && <span className="m">{m.description}</span>}
                      </span>
                    </button>
                  ))}
                  <button className="mi" role="menuitem" onClick={() => { close(); void connectAgent(); }}>
                    <Icon name="refresh" />
                    <span className="txt"><span className="t">{agent?.connected ? "Reconnect" : "Connect"}</span></span>
                  </button>
                  <div className="msep" />
                  <div className="mh">Agent on this computer</div>
                  {AGENTS.map((a) => (
                    <button key={a.id} className={`mi ${a.id === agentId ? "cur" : ""}`} role="menuitemradio" aria-checked={a.id === agentId} onClick={() => { close(); void chooseAgent(a.id); }}>
                      <Icon name="terminal" />
                      <span className="txt">
                        <span className="t">{a.title}</span>
                        <span className="m">{a.plan}{installs[a.id]?.state === "ready" ? "" : ` · ${a.download} download`}</span>
                      </span>
                    </button>
                  ))}
                </>
              )}
            </Dropdown>
            <button className="ibtn" title="Settings and shortcuts (Ctrl+,)" onClick={() => setSettingsOpen(true)}>
              <Icon name="gear" />
            </button>
          </div>
        </>
      )}
    </header>
  );
}
