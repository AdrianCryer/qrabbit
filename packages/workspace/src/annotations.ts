import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { newId, type Annotation } from "@qrabbit/shared";
import { DIRS } from "./collection.js";
import { readJson, writeJson } from "./fs.js";
import { sourceDir } from "./sources.js";

const FILE = "annotations.json";

function fileFor(collection: string, sourceId: string): string {
  return join(sourceDir(collection, sourceId), FILE);
}

function readFor(collection: string, sourceId: string): Annotation[] {
  const list = readJson<Annotation[]>(fileFor(collection, sourceId));
  return Array.isArray(list) ? list.map((a) => ({ ...a, source: sourceId })) : [];
}

function writeFor(collection: string, sourceId: string, list: Annotation[]): void {
  writeJson(fileFor(collection, sourceId), list);
}

/** Every bookmark and comment in the collection, newest first. */
export function listAnnotations(collection: string): Annotation[] {
  const root = join(collection, DIRS.sources);
  if (!existsSync(root)) return [];
  const out: Annotation[] = [];
  for (const name of readdirSync(root)) {
    if (!statSync(join(root, name)).isDirectory()) continue;
    out.push(...readFor(collection, name));
  }
  return out.sort((a, b) => (a.created < b.created ? 1 : -1));
}

export function addAnnotation(collection: string, input: Omit<Annotation, "id" | "created" | "updated">): Annotation {
  const a: Annotation = { ...input, id: newId(input.kind === "bookmark" ? "bmk" : "cmt"), created: new Date().toISOString() };
  const list = readFor(collection, input.source);
  list.push(a);
  writeFor(collection, input.source, list);
  return a;
}

function locate(collection: string, id: string): { sourceId: string; list: Annotation[]; index: number } | null {
  const root = join(collection, DIRS.sources);
  if (!existsSync(root)) return null;
  for (const name of readdirSync(root)) {
    if (!statSync(join(root, name)).isDirectory()) continue;
    const list = readFor(collection, name);
    const index = list.findIndex((a) => a.id === id);
    if (index !== -1) return { sourceId: name, list, index };
  }
  return null;
}

export function updateAnnotation(collection: string, id: string, patch: { text?: string }): Annotation {
  const hit = locate(collection, id);
  if (!hit) throw new Error(`Unknown annotation: ${id}`);
  const next: Annotation = { ...hit.list[hit.index]!, ...(patch.text !== undefined ? { text: patch.text } : {}), updated: new Date().toISOString() };
  hit.list[hit.index] = next;
  writeFor(collection, hit.sourceId, hit.list);
  return next;
}

export function deleteAnnotation(collection: string, id: string): boolean {
  const hit = locate(collection, id);
  if (!hit) return false;
  hit.list.splice(hit.index, 1);
  writeFor(collection, hit.sourceId, hit.list);
  return true;
}
