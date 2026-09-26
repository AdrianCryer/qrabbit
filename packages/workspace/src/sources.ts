import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, statSync, type Dirent } from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { slugify, type FolderFile, type FolderScan, type ImportResult, type RemovedSource, type SourceInfo, type SourceKind } from "@qrabbit/shared";
import { DIRS, TRASH, readOrder, setOrder, trashStamp } from "./collection.js";
import { readJson, readText, writeAtomic, writeJson } from "./fs.js";
import { looksLikeFileName, saneMetadataTitle, sentenceCase, titleFromText } from "./title.js";
import { fetchWebPage } from "./web.js";

const SOURCE_JSON = "source.json";
const TEXT_MD = "text.md";
const KINDS: Record<string, SourceKind> = { ".pdf": "pdf", ".md": "markdown", ".markdown": "markdown", ".txt": "markdown" };
const SCAN_LIMIT = 2000;

export function sourceDir(collection: string, id: string): string {
  return join(collection, DIRS.sources, id);
}

/** What kind of source a file would become, or null when the app cannot read it. */
export function kindOf(filePath: string): SourceKind | null {
  return KINDS[extname(filePath).toLowerCase()] ?? null;
}

function readInfo(collection: string, id: string): SourceInfo | null {
  const dir = sourceDir(collection, id);
  const info = readJson<SourceInfo>(join(dir, SOURCE_JSON));
  return info ? { ...info, id, hasText: existsSync(join(dir, TEXT_MD)) } : null;
}

function writeInfo(collection: string, info: SourceInfo): void {
  writeJson(join(sourceDir(collection, info.id), SOURCE_JSON), info);
}

function readAll(collection: string): SourceInfo[] {
  const root = join(collection, DIRS.sources);
  if (!existsSync(root)) return [];
  const out: SourceInfo[] = [];
  for (const name of readdirSync(root)) {
    if (!statSync(join(root, name)).isDirectory()) continue;
    const info = readInfo(collection, name);
    if (info) out.push(info);
  }
  return out;
}

/** The collection's sources in reading order; anything the manifest does not list follows, oldest first. */
export function listSources(collection: string): SourceInfo[] {
  const all = readAll(collection);
  const byId = new Map(all.map((s) => [s.id, s]));
  const listed: SourceInfo[] = [];
  for (const id of readOrder(collection)) {
    const s = byId.get(id);
    if (s && !listed.includes(s)) listed.push(s);
  }
  const rest = all.filter((s) => !listed.includes(s)).sort((a, b) => (a.added < b.added ? -1 : a.added > b.added ? 1 : a.id.localeCompare(b.id)));
  return [...listed, ...rest];
}

/** Write the full reading order as it stands, so every source is listed and stale ids are dropped. */
function materialiseOrder(collection: string): string[] {
  const ids = listSources(collection).map((s) => s.id);
  setOrder(collection, ids);
  return ids;
}

function uniqueId(collection: string, base: string): string {
  let id = base;
  let n = 2;
  while (existsSync(sourceDir(collection, id))) id = `${base}-${n++}`;
  return id;
}

// ---------- content hashes ----------
export function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** The source file's hash, computed and saved the first time it is asked for. */
export function sourceHash(collection: string, info: SourceInfo): string {
  if (info.sha256) return info.sha256;
  const sha256 = hashFile(join(sourceDir(collection, info.id), info.file));
  const stored = readInfo(collection, info.id);
  if (stored) writeInfo(collection, { ...stored, sha256 });
  return sha256;
}

/** A source with the same content as the file, if there is one. Sizes are compared first, so hashing is rare. */
export function findDuplicate(collection: string, filePath: string): SourceInfo | null {
  const size = statSync(filePath).size;
  let hash: string | null = null;
  for (const s of listSources(collection)) {
    if (s.kind === "web") continue;
    const file = join(sourceDir(collection, s.id), s.file);
    if (!existsSync(file) || statSync(file).size !== size) continue;
    hash ??= hashFile(filePath);
    if (sourceHash(collection, s) === hash) return s;
  }
  return null;
}

// ---------- adding ----------
/** Copy a PDF or Markdown file into the collection and register it at the end of the reading order. Text extraction happens later. */
export function importFile(collection: string, filePath: string): SourceInfo {
  const kind = kindOf(filePath);
  if (!kind) throw new Error(`Unsupported source type: ${extname(filePath) || "(no extension)"}`);
  const title = basename(filePath, extname(filePath));
  const id = uniqueId(collection, slugify(title));
  const dir = sourceDir(collection, id);
  mkdirSync(dir, { recursive: true });
  const file = kind === "pdf" ? "source.pdf" : "source.md";
  copyFileSync(filePath, join(dir, file));
  const info: SourceInfo = { id, kind, title, file, added: new Date().toISOString(), hasText: false, sha256: hashFile(filePath) };
  if (kind === "markdown") {
    // Markdown is its own text: one "page".
    const text = readFileSync(filePath, "utf8");
    writeAtomic(join(dir, TEXT_MD), `<!-- page 1 -->\n${text}`);
    info.pages = 1;
    info.hasText = true;
  }
  writeJson(join(dir, SOURCE_JSON), info);
  materialiseOrder(collection);
  return info;
}

/** Add several files, skipping any whose content is already in the collection. Failures are collected, not thrown. */
export function importFiles(collection: string, files: string[]): ImportResult {
  const result: ImportResult = { added: [], existing: [], failed: [] };
  for (const f of files) {
    try {
      const dup = findDuplicate(collection, f);
      if (dup) {
        if (!result.existing.some((s) => s.id === dup.id)) result.existing.push(dup);
        continue;
      }
      result.added.push(importFile(collection, f));
    } catch (err) {
      console.error(`import failed for ${basename(f)}:`, err);
      result.failed.push(f);
    }
  }
  return result;
}

/** Add a web page as a source: reader-mode Markdown, with the URL kept in the file for the agent. */
export async function importWebPage(collection: string, url: string): Promise<SourceInfo> {
  const page = await fetchWebPage(url);
  let host = "";
  try {
    host = new URL(page.url).hostname.replace(/^www\./, "");
  } catch {
    /* ignore */
  }
  const id = uniqueId(collection, slugify(page.title || host || "web-page"));
  const dir = sourceDir(collection, id);
  mkdirSync(dir, { recursive: true });
  const meta = [page.url, page.siteName, page.byline].filter(Boolean).join(" · ");
  const md = `# ${page.title}\n\nSource: ${meta}\n\n${page.markdown}\n`;
  writeAtomic(join(dir, "source.md"), md);
  writeAtomic(join(dir, TEXT_MD), `<!-- page 1 -->\n${md}`);
  const info: SourceInfo = {
    id,
    kind: "web",
    title: page.title,
    file: "source.md",
    pages: 1,
    added: page.fetched,
    hasText: true,
    url: page.url,
    fetched: page.fetched,
    ...(page.siteName ? { siteName: page.siteName } : {}),
    ...(page.byline ? { byline: page.byline } : {}),
    ...(page.macros ? { macros: page.macros } : {}),
  };
  writeJson(join(dir, SOURCE_JSON), info);
  materialiseOrder(collection);
  return info;
}

// ---------- scanning a folder ----------
const depth = (rel: string) => rel.split("/").length;

/**
 * List the PDF, Markdown and text files under `root`, root files first, then each subfolder, alphabetically.
 * Files whose content is already in the collection are flagged; sizes are compared before anything is hashed.
 */
export function scanFolder(collection: string, root: string, opts: { recursive: boolean; limit?: number }): FolderScan {
  const limit = opts.limit ?? SCAN_LIMIT;
  const files: FolderFile[] = [];
  let skipped = 0;
  let truncated = false;
  const bySize = new Map<number, SourceInfo[]>();
  for (const s of listSources(collection)) {
    if (s.kind === "web") continue;
    const file = join(sourceDir(collection, s.id), s.file);
    if (!existsSync(file)) continue;
    const size = statSync(file).size;
    const list = bySize.get(size) ?? [];
    list.push(s);
    bySize.set(size, list);
  }
  const walk = (dir: string) => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (truncated) return;
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (opts.recursive && !e.name.startsWith(".") && e.name !== "node_modules") walk(p);
        continue;
      }
      if (!e.isFile()) continue;
      const kind = kindOf(p);
      if (!kind) {
        skipped++;
        continue;
      }
      if (files.length >= limit) {
        truncated = true;
        return;
      }
      const size = statSync(p).size;
      const file: FolderFile = { path: p, rel: relative(root, p).split(sep).join("/"), name: e.name, size, kind };
      const candidates = bySize.get(size);
      if (candidates?.length) {
        const hash = hashFile(p);
        const hit = candidates.find((s) => sourceHash(collection, s) === hash);
        if (hit) file.existing = { id: hit.id, title: hit.title };
      }
      files.push(file);
    }
  };
  walk(root);
  files.sort((a, b) => depth(a.rel) - depth(b.rel) || a.rel.localeCompare(b.rel));
  return { root, files, skipped, truncated };
}

// ---------- read marks ----------
export function setSourceRead(collection: string, id: string, read: boolean): SourceInfo {
  const dir = sourceDir(collection, id);
  const stored = readJson<SourceInfo>(join(dir, SOURCE_JSON));
  if (!stored) throw new Error(`Unknown source: ${id}`);
  const next: SourceInfo = { ...stored, id };
  if (read) next.read = new Date().toISOString();
  else delete next.read;
  writeJson(join(dir, SOURCE_JSON), next);
  return { ...next, hasText: existsSync(join(dir, TEXT_MD)) };
}

// ---------- renaming ----------
/** A title of the reader's own. The folder keeps its id, and later text extraction leaves this title alone. */
export function renameSource(collection: string, id: string, title: string): SourceInfo {
  const dir = sourceDir(collection, id);
  const stored = readJson<SourceInfo>(join(dir, SOURCE_JSON));
  if (!stored) throw new Error(`Unknown source: ${id}`);
  const clean = title.replace(/\s+/g, " ").trim();
  if (!clean) throw new Error("A title cannot be empty");
  const next: SourceInfo = { ...stored, id, title: clean, renamed: new Date().toISOString() };
  writeJson(join(dir, SOURCE_JSON), next);
  return { ...next, hasText: existsSync(join(dir, TEXT_MD)) };
}

/** The document's own title in sentence case, or null when nothing usable is known yet. */
export function autoTitle(collection: string, id: string): string | null {
  const info = readInfo(collection, id);
  if (!info) throw new Error(`Unknown source: ${id}`);
  const raw = saneMetadataTitle(info.docTitle) ?? (info.hasText ? titleFromText(readSourceText(collection, id) ?? "", info.kind) : null);
  const title = raw ? sentenceCase(raw) : "";
  return title || null;
}

/** Rename the source to its document's title in sentence case. Null when no title could be found. */
export function autoTitleSource(collection: string, id: string): SourceInfo | null {
  const title = autoTitle(collection, id);
  if (!title) return null;
  const info = readInfo(collection, id)!;
  return title === info.title ? info : renameSource(collection, id, title);
}

// ---------- removing and restoring ----------
/** Move the source folder into the collection's trash and drop it from the reading order. */
export function removeSource(collection: string, id: string): RemovedSource {
  const dir = sourceDir(collection, id);
  if (!existsSync(dir)) throw new Error(`Unknown source: ${id}`);
  const index = Math.max(0, listSources(collection).findIndex((s) => s.id === id));
  const stampDir = join(collection, TRASH, trashStamp());
  mkdirSync(stampDir, { recursive: true });
  const trashPath = join(stampDir, id);
  renameSync(dir, trashPath);
  materialiseOrder(collection);
  return { id, trashPath, index };
}

/** Move a removed source back and put it where it was in the reading order. */
export function restoreSource(collection: string, removed: RemovedSource): SourceInfo {
  const trashRoot = resolve(collection, TRASH);
  const from = resolve(removed.trashPath);
  if (!from.startsWith(trashRoot + sep)) throw new Error("Not a removed source of this collection");
  if (!existsSync(from)) throw new Error("The removed source is no longer in the trash");
  const dir = sourceDir(collection, removed.id);
  if (existsSync(dir)) throw new Error(`A source named ${removed.id} exists again, so the removed one stays in the trash`);
  renameSync(from, dir);
  try {
    rmdirSync(dirname(from));
  } catch {
    /* the stamp folder still holds another source */
  }
  const ids = listSources(collection).map((s) => s.id).filter((x) => x !== removed.id);
  ids.splice(Math.min(removed.index, ids.length), 0, removed.id);
  setOrder(collection, ids);
  const info = readInfo(collection, removed.id);
  if (!info) throw new Error(`Restored ${removed.id}, but its source.json is missing`);
  return info;
}

// ---------- reading ----------
export function readSourceBytes(collection: string, id: string): Uint8Array {
  const info = readJson<SourceInfo>(join(sourceDir(collection, id), SOURCE_JSON));
  if (!info) throw new Error(`Unknown source: ${id}`);
  return new Uint8Array(readFileSync(join(sourceDir(collection, id), info.file)));
}

export function readSourceText(collection: string, id: string): string | null {
  return readText(join(sourceDir(collection, id), TEXT_MD));
}

/**
 * Store the text the renderer extracted with PDF.js, so the same engine defines every offset.
 * `titles.metadata` is the PDF's own title field and `titles.guess` the largest upright text on the first page;
 * the document's title is remembered as `docTitle`, and unless the reader already chose a title it becomes the
 * source's title in sentence case: a metadata title always, a guess only when the current title is just a file name.
 */
export function saveSourceText(collection: string, id: string, text: string, pages: number, titles?: { metadata?: string; guess?: string }): SourceInfo {
  const dir = sourceDir(collection, id);
  const info = readJson<SourceInfo>(join(dir, SOURCE_JSON));
  if (!info) throw new Error(`Unknown source: ${id}`);
  writeAtomic(join(dir, TEXT_MD), text);
  const metadata = saneMetadataTitle(titles?.metadata);
  const guess = titles?.guess?.replace(/\s+/g, " ").trim() || (info.kind === "pdf" ? titleFromText(text, "pdf") : null);
  const docTitle = metadata ?? guess ?? info.docTitle;
  let title = info.title;
  if (!info.renamed) {
    if (metadata) title = sentenceCase(metadata);
    else if (guess && looksLikeFileName(info.title)) title = sentenceCase(guess);
  }
  const next: SourceInfo = { ...info, id, pages, hasText: true, title, ...(docTitle ? { docTitle } : {}) };
  writeJson(join(dir, SOURCE_JSON), next);
  return next;
}
