# QRabbit — Sources plan (v1)

Status: built 2026-09-26, verified by `tools/dev/drive-sources.mjs`. Extends plan-v2 §3.1, §4.1, §6.2 and §8. The questions raised in the draft were settled the same day; §7 records the answers.

Clickable prototype: `planning/prototype/sources.html`, published at https://claude.ai/artifact/2hez9TRajXkhx5wM7CYTKN. Seven states (list, reorder, row menu, removed, from folder, empty, switcher) with the same accent and theme switches as `central-loop.html`. Rows really drag, marks really toggle, remove really undoes, and the folder picker really filters and counts, so the feel can be judged before any of it is built.

---

## 1. What this adds

A collection could only grow. This plan gives it the rest of a reading list:

- **Remove** a source, with undo.
- **Add from a folder**, choosing which files come in.
- **Mark a source read**, as a record and nothing more.
- **Set the reading order**, by drag or by a one-shot sort.

It also gives the collection a face: a **reading list page** in the reader pane, which is where all of the above happens and which doubles as the first-run screen.

Assumption behind "selective load from folder": the folder is somewhere else on disk (a `~/papers` pile, an Obsidian vault) and the reader wants some of it, not all of it. Files are copied in, as `Add files` does today; nothing is linked in place (§7.1).

---

## 2. Decisions at a glance

- **The reading list is a page, not a sidebar and not a dialog.** It lives in the reader pane where a paper would be, reached from the source switcher, from `Ctrl+L`, and automatically when there is nothing to read. Width still goes to the content; the thread panel can stay open beside it.
- **Order is manual and lives in the manifest.** `qrabbit.json` gets `order: [ids]`. Drag sets it; "Order by title / date added / unread first" rewrites it once and then it is manual again. There is no sort mode to be in.
- **"Read" is a date on the source.** `source.json` gets `read: "<ISO>"`. It is set and cleared only by the reader, is never asked for, gates nothing, and changes nothing but a check and the counts. It is bookkeeping about a document, not a claim about understanding, so it does not conflict with plan-v2 §3.3, which is about threads.
- **Removing moves the source folder to `.qrabbit/trash/`.** Undo moves it back. Threads that quoted it stay, with their quotes, because the anchor already holds the text.
- **Adding from a folder is scan, tick, copy.** The picker lists eligible files, marks the ones already in the collection by content hash, and copies the ticked ones to the end of the reading list.
- **Every list of sources follows the reading order:** the switcher, the groups in the Threads and Marks popovers, the folder picker's "already added" lookups, and the home card counts.

---

## 3. Model and files

### 3.1 Manifest

```json
{
  "id": "col_…",
  "name": "Representation geometry",
  "created": "2026-09-24T…",
  "settings": {},
  "order": ["intrinsic-dimension", "testing-manifold", "manifold-notes"]
}
```

Rules:

- `listSources` returns sources in `order`, then any folder not listed, oldest `added` first. A folder dropped into `sources/` by hand, by Obsidian or by git therefore lands at the end and is never lost.
- Ids in `order` with no folder behind them are ignored on read and pruned on the next write.
- `setOrder(ids)` writes the whole list. Moves are computed in the renderer and written as one array; no fractional positions, no per-source `order` field to renumber.

### 3.2 Source

Two optional fields on `SourceInfo` and `source.json`:

- `read?: string` — ISO timestamp of when the reader marked it read. Absent means unread. Cleared by "Mark as unread".
- `renamed?: string` — ISO timestamp of when the reader gave the source a title of their own (arXiv downloads arrive as numbers). `saveSourceText` then keeps that title instead of the document's.
- `docTitle?: string` — the document's own title as found in it: the PDF's title field when it is a real title, else the largest upright text on page one (PDF.js item heights; the rotated arXiv stamp is skipped), else the first Markdown heading. Kept even when the source keeps another title, so "Title from the document" can offer it later.
- `sha256?: string` — hash of the source file (`source.pdf` or `source.md`). Computed on import from now on; back-filled lazily the first time a folder scan needs it. Used for duplicate detection in the picker and for `Add files` (re-adding a file already in the collection is a no-op with a toast that opens the existing source).

Nothing about the original path is stored. Collections are shared and git-tracked, and a local path in a JSON file is a small leak for no feature.

### 3.3 Reader state

`.qrabbit/reader-state.json` already holds the last page per source. The list shows it as `p. 4 of 14` for PDFs and `Opened` for articles, with `Not started` when there is no entry. That is last position, not pages seen, and the label says so (§7.7). Entries for unknown sources are pruned on write, so a restored source keeps its position as long as it is restored before the next write.

### 3.4 Removing a source

`removeSource(collection, id)`:

1. Move `sources/<id>/` to `.qrabbit/trash/<id>-<timestamp>/`. Annotations live inside the folder, so they go with it.
2. Drop the id from `order`.
3. Return `{ id, trashPath }` for undo.

`restoreSource(collection, trashPath)` moves the folder back and re-inserts the id at its old index (the renderer remembers it). If `sources/<id>` has since been taken, restore fails with a message rather than merging.

Trash entries older than seven days are deleted when the collection is opened (§7.5). `.gitignore` gets `.qrabbit/trash/`.

Threads anchored to a removed source:

- The thread file is untouched. Its anchor still holds the quote, prefix, suffix and page, so the quote card renders from the anchor and the page chip is shown without a link.
- The Threads and Marks popovers currently build their groups from `collection.sources`, so threads of a removed source would vanish from the popover. They get a trailing group, **Removed sources**, so nothing disappears (plan-v2 §3.3: nothing is archived).
- The agent's first-turn context (§5.5) reads surrounding text from `text.md`. With the source gone it falls back to the anchor's quote alone and says so in the preamble.
- If the removed source was open in the reader, the reader shows the reading list.

### 3.5 Adding from a folder

`scanFolder(dir, { recursive })` runs in main and returns:

```ts
type FolderScan = {
  root: string;
  files: Array<{ path: string; rel: string; name: string; size: number; kind: SourceKind; sha256: string; existing?: { id: string; title: string } }>;
  skipped: number;          // files with other extensions
  truncated?: boolean;      // more than the scan limit
};
```

- Eligible: `.pdf`, `.md`, `.markdown`, `.txt`. Dot-folders and `node_modules` are skipped. The scan stops at 2,000 eligible files and says so.
- `existing` is set when the hash matches a source in the collection. The picker shows those rows unticked and disabled with an "in collection" chip and the existing title.
- `importFiles(collection, paths)` copies each file through the existing `importFile`, appends the new ids to `order` in the picker's order, and returns the new `SourceInfo`s. Failures are collected and reported once ("2 files could not be added"), not one toast each.

Drag and drop onto the reading list page does the same: files go straight to `importFiles`; a dropped folder opens the picker on it.

---

## 4. UX

### 4.1 The reading list page

Reached from: the first item of the source switcher, `Ctrl+L` (toggles between the list and the paper you were on), opening a collection with no sources, and removing the source that was open. The header's source pill reads **Reading list** with the count while the page is showing; the thread panel is unaffected.

Layout: the collection's name and `7 sources · 3 read · 12 threads`; an **Order** menu and an **Add** menu on the right; the rows; one line of hint text about where the files live.

A row, left to right:

- **Number**, which becomes a grip on hover. Drag it to reorder; a 2px accent line shows the drop position. `Ctrl+↑` / `Ctrl+↓` move a focused row without the mouse.
- **Kind icon** and **title** over a meta line: `PDF · 14 pages · 3 threads · 2 marks · added 2 d ago`. Clicking the title opens the source where you left it; so does `Enter`.
- **Progress**: `p. 4 of 14`, `Opened`, `Not started`, or `Read · Tue` once marked.
- **Read toggle**: an empty circle that appears on hover for unread rows, a green check always for read rows. Read rows dim their title and stay where they are. `R` toggles on a focused row.
- **More** (`…`): Open, Mark as read / unread, Rename…, Title from the document, Move to top, Move to bottom, Show in folder, Remove from collection. `Delete` removes a focused row; `F2` renames it in place (Enter saves, Escape cancels). A rename changes the title only: the folder keeps its id, so threads and marks stay attached, and a later text extraction does not replace the title. **Title from the document** renames to `docTitle` in sentence case (first letter, acronyms, names with capitals inside and a short list of eponyms keep their capitals) with Undo. The same happens by itself when a PDF's text is first extracted: a real metadata title always becomes the sentence-cased title, and the page-one guess does so only when the current title is just a file name (an arXiv number, a slug), so a good file name is never replaced by a guess.

Remove animates the row out and shows a toast with **Undo** for seven seconds, using the toast action the store already has. Marking read shows no toast in the app; the check is the feedback (the prototype toasts to explain the data).

The **Order** menu offers one-shot reorders (Title, Date added, Unread first) and says how to drag. It is a menu of actions, not a mode.

The **Add** menu offers Files… (`Ctrl+I`), From a folder…, Web page…. With zero sources the rows and header actions are replaced by a card with the same three actions and a drop hint.

### 4.2 The source switcher

- First item: **Reading list**, with `7 sources · 3 read` and the `Ctrl+L` chip.
- Then the sources in reading order under an "In reading order" header; the current one highlighted with its page; read ones dimmed with a check.
- Hovering a row reveals the check toggle, so a paper can be marked read from the header without leaving it. Clicking the check does not close the menu.
- Add files…, Add from a folder…, Add a web page… at the bottom.

### 4.3 Threads and Marks popovers

Groups by source follow the reading order instead of `added`. A trailing **Removed sources** group holds anything anchored to a source that is no longer there.

### 4.4 Home

Collection cards show `7 sources · 3 read · 12 threads` under the name, above the path. The counts come from the manifest and a cheap scan of `source.json` files, which `recentCollections` can afford for twenty entries.

### 4.5 Keyboard

| Keys | Where | Does |
|---|---|---|
| `Ctrl+L` | reader | Reading list, or back to the paper |
| `↑` `↓` | list | Move focus |
| `Ctrl+↑` `Ctrl+↓` | list | Move the row |
| `Enter` | list | Open the source |
| `R` | list | Mark read or unread |
| `F2` | list | Rename in place |
| `Delete` | list | Remove, with undo |
| `Esc` | list | Close a menu; otherwise nothing |

`Ctrl+I` keeps meaning Add files. The Settings shortcut table gains a "Reading list" group.

---

## 5. Renderer ↔ main

Additions to `QrabbitApi`:

```ts
collections: {
  setOrder(path, ids: string[]): Promise<CollectionManifest>;
}
sources: {
  setRead(path, id, read: boolean): Promise<SourceInfo>;
  remove(path, id): Promise<{ id: string; trashPath: string }>;
  restore(path, trashPath: string, index: number): Promise<SourceInfo>;
  reveal(path, id): Promise<void>;                                   // shell.showItemInFolder
  folderDialog(path): Promise<FolderScan | null>;                    // pick a folder, then scan
  scanFolder(path, dir: string, opts: { recursive: boolean }): Promise<FolderScan>;
  importFiles(path, files: string[]): Promise<{ added: SourceInfo[]; failed: string[] }>;
}
```

Store: `sourceId === null` already means "no source"; it now means "the reading list". New actions: `showList()`, `moveSource(id, to)`, `setOrder(ids)`, `toggleRead(id)`, `removeSource(id)` (does the move, shows the undo toast, restores on undo), `addFromFolder()`, `importDropped(paths)`. `selectSource` keeps writing the last source per collection; `showList` does not clear it, so `Ctrl+L` can go back.

Workspace package: `collection.ts` gains `readOrder`, `setOrder` and pruning; `sources.ts` gains `setSourceRead`, `removeSource`, `restoreSource`, `hashFile`, `scanFolder`, `importFiles`, and `listSources` sorts by order. All with Vitest cases beside `annotations.test.ts`.

Components: `ReadingList.tsx` replaces the empty box in `ReaderPane`; `FolderDialog.tsx` follows `UrlDialog.tsx`; `Header.tsx` gets the switcher changes; `Home.tsx` the counts. Drag uses pointer events on the number, as in the prototype; no library.

The agent is not told about order or read marks: nothing is added to `AGENTS.md` and nothing is injected into prompts (§7.4). They are the reader's bookkeeping only.

---

## 6. Build order

1. **Model.** `order`, `read`, `sha256`; `listSources` in order; remove and restore through trash; scan with hashing and duplicate detection; tests for each.
2. **Bridge.** Shared types, IPC handlers, preload, the folder dialog handler with `shell.showItemInFolder` for reveal.
3. **Reading list page.** Rows, progress from reader state, read toggle, row menu, keyboard, drag, remove with undo, empty state, drop target.
4. **Everything that lists sources.** Switcher with the list entry and hover check, `Ctrl+L`, Threads and Marks grouping in order plus the Removed sources group, reader falling back to the list when its source is removed, home counts.
5. **Folder picker.** Dialog with filter, subfolder toggle, select all / none, counts and size, add; drop of a folder opens it.
6. **Verify.** Extend `tools/dev/drive-desktop.mjs` with a fixture folder that contains a duplicate of the collection's PDF and a subfolder of Markdown: add from folder, reorder by drag, mark read, remove and undo, screenshots of each.

---

## 7. Decisions (2026-09-26)

1. **Link in place: no.** Copy only. Collections stay self-contained and portable (plan-v2 §6.1); revisit only if testers hit disk limits.
2. **Bulk actions: deferred.** Multi-select for remove and mark read waits until a list is long enough to need it.
3. **Picker default: everything new ticked.** "Add this folder" is one click; the picker is for excluding.
4. **The agent is not told.** No `AGENTS.md` lines, nothing injected. Order and read marks are the reader's bookkeeping only.
5. **Trash retention: seven days.** Purged when the collection is opened.
6. **No shortcut for mark read.** The hover check in the switcher and the list page are the ways.
7. **Progress is last position.** "p. 4 of 14" means where the reader left off; pages seen are not tracked.

---

## 8. Not in scope

Sections or sub-lists inside a collection, tags, ratings, per-source notes, full-text search, and any reading statistics. Sources with the same hash in two collections are two copies, on purpose.
