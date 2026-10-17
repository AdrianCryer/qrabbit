import type { CollectionInfo } from "@qrabbit/shared";
import { useStore } from "../state/store";
import { displayPath } from "../lib/paths";
import { ago } from "../lib/time";
import { Icon } from "./Icons";

const countsLine = (c: CollectionInfo) => (c.counts ? `${c.counts.sources} sources · ${c.counts.read} read · ${c.counts.threads} threads` : null);

export function Home() {
  const recent = useStore((s) => s.recent);
  const home = useStore((s) => s.home);
  const cloud = useStore((s) => s.cloud);
  const cloudCollections = useStore((s) => s.cloudCollections);
  const cloudDownload = useStore((s) => s.cloudDownload);
  const { openCollection, openCollectionDialog, downloadCollection } = useStore.getState();
  const latest = recent[0];
  // Collections the account keeps in the cloud that have no folder here yet.
  const elsewhere = cloud?.signedIn ? cloudCollections.filter((c) => !c.localPath) : [];

  return (
    <section className="home" aria-label="Collections">
      <div className="col">
        <div>
          <h1>Collections</h1>
          <p className="sub">A collection is a reading list: its sources and every thread you opened from them. Each one is a folder on disk.</p>
        </div>

        {latest && (
          <div className="cont">
            <div className="thumb" aria-hidden="true" />
            <div className="txt">
              <div className="t">{latest.name}</div>
              <div className="m">{countsLine(latest) ?? displayPath(latest.path, home)}</div>
            </div>
            <button className="btn primary" onClick={() => void openCollection(latest.path)}>
              Continue reading
            </button>
          </div>
        )}

        <div className="sect">
          <h2>Recent</h2>
        </div>
        <div className="colls">
          {recent.map((c) => (
            <button key={c.path} className="coll" onClick={() => void openCollection(c.path)}>
              <span className="ico"><Icon name="folder" /></span>
              <span className="txt">
                <span className="t">{c.name}</span>
                {countsLine(c) && <span className="m">{countsLine(c)}</span>}
                <span className="m">{displayPath(c.path, home)}</span>
              </span>
              <span className="meta">
                {c.cloud && <Icon name="cloud" />}
                {c.lastOpened ? new Date(c.lastOpened).toLocaleDateString() : ""}
              </span>
            </button>
          ))}
          <button className="coll new" onClick={() => void openCollectionDialog()}>
            <span className="ico"><Icon name="plus" /></span>
            <span className="txt">
              <span className="t">Open a folder</span>
              <span className="m">An existing collection, or an empty folder to start one</span>
            </span>
          </button>
        </div>

        {elsewhere.length > 0 && (
          <>
            <div className="sect">
              <h2>In the cloud, not on this computer</h2>
            </div>
            <div className="colls">
              {elsewhere.map((c) => {
                const busy = cloudDownload === c.id;
                return (
                  <button
                    key={c.id}
                    className="coll cloudonly"
                    onClick={() => void downloadCollection(c.id)}
                    disabled={cloudDownload !== null && !busy}
                    aria-busy={busy}
                    title="Download into a folder on this computer"
                  >
                    <span className="ico">{busy ? <span className="spin"><Icon name="spin" /></span> : <Icon name="cloud" />}</span>
                    <span className="txt">
                      <span className="t">{c.name}</span>
                      <span className="m">{busy ? "Downloading…" : "Download to a folder here; it then stays in step with the cloud"}</span>
                    </span>
                    <span className="meta">{ago(c.updatedAt)}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        <div className="hint">
          <Icon name="folder" />
          Every collection is a plain folder of Markdown and PDFs. Open one in Obsidian or track it with git whenever you like.
        </div>
      </div>
    </section>
  );
}
