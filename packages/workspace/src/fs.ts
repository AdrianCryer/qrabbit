import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Write through a temp file and rename, so a crash never leaves a half-written file. */
export function writeAtomic(path: string, data: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

export function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

export function writeJson(path: string, value: unknown): void {
  writeAtomic(path, JSON.stringify(value, null, 2) + "\n");
}

export function readText(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}
