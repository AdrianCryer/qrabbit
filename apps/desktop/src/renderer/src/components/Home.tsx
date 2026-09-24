import { useStore } from "../state/store";
import { Icon } from "./Icons";

export function Home() {
  const recent = useStore((s) => s.recent);
  const { openCollection, openCollectionDialog } = useStore.getState();
  const latest = recent[0];

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
              <div className="m">{latest.path}</div>
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
                <span className="m">{c.path}</span>
              </span>
              <span className="meta">{c.lastOpened ? new Date(c.lastOpened).toLocaleDateString() : ""}</span>
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

        <div className="hint">
          <Icon name="folder" />
          Every collection is a plain folder of Markdown and PDFs. Open one in Obsidian or track it with git whenever you like.
        </div>
      </div>
    </section>
  );
}
