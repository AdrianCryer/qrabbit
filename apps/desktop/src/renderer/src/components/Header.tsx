import { useStore } from "../state/store";
import { Dropdown } from "./Dropdown";
import { Icon } from "./Icons";

function relTime(iso?: string): string {
  if (!iso) return "";
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.round(d / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h`;
  const days = Math.round(h / 24);
  if (days < 7) return `${days} d`;
  return new Date(iso).toLocaleDateString();
}

export function Header() {
  const screen = useStore((s) => s.screen);
  const recent = useStore((s) => s.recent);
  const collection = useStore((s) => s.collection);
  const sourceId = useStore((s) => s.sourceId);
  const threadId = useStore((s) => s.thread?.id ?? null);
  const { goHome, openCollection, openCollectionDialog, selectSource, importSources, openThread } = useStore.getState();

  const source = collection?.sources.find((s) => s.id === sourceId) ?? null;
  const threads = collection?.threads ?? [];

  return (
    <header className="hdr">
      <button className="brand" onClick={goHome} title="All collections">
        <span className="q">Q</span>
        {screen === "home" && <span>QRabbit</span>}
      </button>

      {screen === "reader" && collection && (
        <>
          <Dropdown
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
                      <span className="m">{c.path}</span>
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
            className="hsrc"
            title="Switch source"
            label={
              <>
                <Icon name={source?.kind === "markdown" ? "lines" : "file"} />
                <span className="txt">{source ? source.title : "No source"}</span>
                {source?.pages ? <span className="lbl">{source.pages} p.</span> : null}
                <Icon name="chevron" />
              </>
            }
          >
            {(close) => (
              <>
                <div className="mh">Sources in this collection</div>
                {collection.sources.length === 0 && <div className="mempty">No sources yet.</div>}
                {collection.sources.map((s) => (
                  <button key={s.id} className={`mi ${s.id === sourceId ? "cur" : ""}`} role="menuitem" onClick={() => { close(); selectSource(s.id); }}>
                    <Icon name={s.kind === "markdown" ? "lines" : "file"} />
                    <span className="txt">
                      <span className="t">{s.title}</span>
                      <span className="m">
                        {s.kind === "pdf" ? "PDF" : "Markdown"}
                        {s.pages ? ` · ${s.pages} pages` : ""} · {threads.filter((t) => t.anchor?.source === s.id).length} threads
                      </span>
                    </span>
                  </button>
                ))}
                <div className="msep" />
                <button className="mi" role="menuitem" onClick={() => { close(); void importSources(); }}>
                  <Icon name="plus" />
                  <span className="txt">
                    <span className="t">Add sources…</span>
                    <span className="m">PDF or Markdown</span>
                  </span>
                </button>
              </>
            )}
          </Dropdown>

          <div className="hright">
            <Dropdown
              align="right"
              title="Threads in this collection"
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
                        {threads
                          .filter((t) => t.anchor?.source === s.id)
                          .map((t) => (
                            <button key={t.id} className={`mi ${t.id === threadId ? "cur" : ""}`} role="menuitem" onClick={() => { close(); void openThread(t.id); }}>
                              <span className={`dot h${t.hue}`} />
                              <span className="txt">
                                <span className="t">{t.title}</span>
                                <span className="m">
                                  {relTime(t.created)} · {t.messageCount} messages
                                </span>
                              </span>
                              <span className="meta">{t.anchor?.page ? <span className="chip">p.{t.anchor.page}</span> : null}</span>
                            </button>
                          ))}
                      </div>
                    ))}
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
            <div className="agent" title="Agent wiring comes in step 3">
              <span className="dot" />
              <span>No agent yet</span>
            </div>
          </div>
        </>
      )}
    </header>
  );
}
