import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { slugify, type SourceInfo } from "@qrabbit/shared";
import { DIRS } from "./collection.js";
import { readJson, readText, writeAtomic, writeJson } from "./fs.js";
import { fetchWebPage } from "./web.js";

const SOURCE_JSON = "source.json";
const TEXT_MD = "text.md";

export function sourceDir(collection: string, id: string): string {
  return join(collection, DIRS.sources, id);
}

export function listSources(collection: string): SourceInfo[] {
  const root = join(collection, DIRS.sources);
  if (!existsSync(root)) return [];
  const out: SourceInfo[] = [];
  for (const name of readdirSync(root)) {
    const dir = join(root, name);
    if (!statSync(dir).isDirectory()) continue;
    const info = readJson<SourceInfo>(join(dir, SOURCE_JSON));
    if (info) out.push({ ...info, id: name, hasText: existsSync(join(dir, TEXT_MD)) });
  }
  return out.sort((a, b) => (a.added < b.added ? 1 : -1));
}

function uniqueId(collection: string, base: string): string {
  let id = base;
  let n = 2;
  while (existsSync(sourceDir(collection, id))) id = `${base}-${n++}`;
  return id;
}

/** Copy a PDF or Markdown file into the collection and register it. Text extraction happens later. */
export function importFile(collection: string, filePath: string): SourceInfo {
  const ext = extname(filePath).toLowerCase();
  const kind = ext === ".pdf" ? "pdf" : ext === ".md" || ext === ".markdown" || ext === ".txt" ? "markdown" : null;
  if (!kind) throw new Error(`Unsupported source type: ${ext || "(no extension)"}`);
  const title = basename(filePath, extname(filePath));
  const id = uniqueId(collection, slugify(title));
  const dir = sourceDir(collection, id);
  mkdirSync(dir, { recursive: true });
  const file = kind === "pdf" ? "source.pdf" : "source.md";
  copyFileSync(filePath, join(dir, file));
  const info: SourceInfo = { id, kind, title, file, added: new Date().toISOString(), hasText: false };
  if (kind === "markdown") {
    // Markdown is its own text: one "page".
    const text = readFileSync(filePath, "utf8");
    writeAtomic(join(dir, TEXT_MD), `<!-- page 1 -->\n${text}`);
    info.pages = 1;
    info.hasText = true;
  }
  writeJson(join(dir, SOURCE_JSON), info);
  return info;
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
  return info;
}

export function readSourceBytes(collection: string, id: string): Uint8Array {
  const info = readJson<SourceInfo>(join(sourceDir(collection, id), SOURCE_JSON));
  if (!info) throw new Error(`Unknown source: ${id}`);
  return new Uint8Array(readFileSync(join(sourceDir(collection, id), info.file)));
}

export function readSourceText(collection: string, id: string): string | null {
  return readText(join(sourceDir(collection, id), TEXT_MD));
}

/** Store the text the renderer extracted with PDF.js, so the same engine defines every offset. */
export function saveSourceText(collection: string, id: string, text: string, pages: number, title?: string): SourceInfo {
  const dir = sourceDir(collection, id);
  const info = readJson<SourceInfo>(join(dir, SOURCE_JSON));
  if (!info) throw new Error(`Unknown source: ${id}`);
  writeAtomic(join(dir, TEXT_MD), text);
  const next: SourceInfo = { ...info, id, pages, hasText: true, title: title?.trim() ? title.trim() : info.title };
  writeJson(join(dir, SOURCE_JSON), next);
  return next;
}
