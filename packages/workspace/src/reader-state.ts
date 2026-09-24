import { join } from "node:path";
import type { ReaderPosition, ReaderState } from "@qrabbit/shared";
import { DIRS } from "./collection.js";
import { readJson, writeJson } from "./fs.js";

const FILE = "reader-state.json";

export function readReaderState(collection: string): ReaderState {
  return readJson<ReaderState>(join(collection, DIRS.state, FILE)) ?? {};
}

export function setReaderPosition(collection: string, sourceId: string, position: ReaderPosition): void {
  const state = readReaderState(collection);
  state[sourceId] = position;
  writeJson(join(collection, DIRS.state, FILE), state);
}
