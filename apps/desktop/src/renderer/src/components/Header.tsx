import { useStore } from "../state/store";
import { relTime } from "../lib/time";
import { Dropdown } from "./Dropdown";
import { Icon } from "./Icons";

export function Header() {
  const screen = useStore((s) => s.screen);
  const recent = useStore((s) => s.recent);
  const collection = useStore((s) => s.collection);
  const sourceId = useStore((s) => s.sourceId);
  const threadId = useStore((s) => s.thread?.id ?? null);
  const { goHome, openCollection, openCollectionDialog, selectSource, showList, importSources, addFromFolder, toggleRead, openThread } = useStore.getState();

  const agent = useStore((s) => s.agent);
  const menu = useStore((s) => s.menu);
  const { connectAgent, loginAgent, setMenu, setSettingsOpen, setUrlDialogOpen } = useStore.getState();
  const kindIcon = (kind: string) => (kind === "web" ? "globe" : kind === "markdown" ? "lines" : "file");
  // Page numbers mean something for PDFs only; articles are one page.
  const pageChip = (sourceId: string | undefined, page: number | undefined) =>
    page && collection?.sources.find((s) => s.id === sourceId)?.kind === "pdf" ? <span className="chip">p.{page}</span> : null;
  const controlled = (id: "collection" | "source" | "threads" | "marks") => ({ open: menu === id, onOpenChange: (v: boolean) => setMenu(v ? id : menu === id ? null : menu) });
  const annotations = collection?.annotations ?? [];
  const { goToAnnotation } = useStore.getState();
  const source = collection?.sources.find((s) => s.id === sourceId) ?? null;
  const readCount = collection?.sources.filter((s) => s.read).length ?? 0;
  // Branches are reached from their parent's outline; the popover lists root threads only.
  const threads = (collection?.threads ?? []).filter((t) => !t.parent);
  // Threads whose source was removed keep their quotes and stay reachable.
  const orphaned = threads.filter((t) => t.anchor?.source && !collection?.sources.some((s) => s.id === t.anchor?.source));
  const signedIn = !!agent?.connected && !!agent.auth && agent.auth.kind !== "none";
  const agentLabel = !agent ? "Agent" : agent.error ? "Agent failed" : !agent.connected ? "Connecting…" : agent.auth?.label ?? agent.agent?.name ?? "Connected";
  const loginMethods = agent?.authMethods.length
    ? agent.authMethods
    : [
        { id: "claude-ai-login", name: "Claude subscription", description: "Sign in with your Claude plan" },
        { id: "console-login", name: "Anthropic Console", description: "API usage billing" },
      ];
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
        <span className="q">Q</span>
        {screen === "home" && <span>QRabbit</span>}
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
                      <span className="m">{c.counts ? `${c.counts.sources} sources · ${c.counts.read} read · ${c.counts.threads} threads` : c.path}</span>
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
            <Dropdown
              align="right"
              title={agent?.error ?? "Agent status and sign-in"}
              label={
                <span className="agent">
                  <span className={`dot ${signedIn ? "on" : ""}`} />
                  <span>{agentLabel}</span>
                </span>
              }
            >
              {(close) => (
                <>
                  <div className="mh">{agent?.agent?.name ?? "Claude Code"}{agent?.agent?.version ? ` · ${agent.agent.version}` : ""}</div>
                  <div className="mempty">
                    {agent?.error
                      ? agent.error
                      : agent?.connected
                        ? agent.auth
                          ? `Turns bill to ${agent.auth.label}.`
                          : "Connected. The account is reported when the first message is sent."
                        : "Not connected."}
                  </div>
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
