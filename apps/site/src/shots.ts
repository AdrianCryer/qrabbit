import type { ImageMetadata } from "astro";
// The app captures behind the README images (tools/dev/make-showcase.mjs writes them), imported in
// place so the site and the README always show the same app.
import highlight from "../../../docs/screenshots/raw/highlight.png";
import home from "../../../docs/screenshots/raw/home.png";
import readingList from "../../../docs/screenshots/raw/reading-list.png";
// The thread with its branches at the widths the site draws it (tools/dev/make-site-shots.mjs): the
// README's 1280-wide capture spans the whole window, and its text would come out too small here.
import thread from "./assets/branches.png";
import threadNarrow from "./assets/branches-narrow.png";

/**
 * A capture and the width of the app layout it shows, in CSS pixels. Crops are given in that layout,
 * whatever scale the capture was taken at: the display's own scaling multiplies it.
 */
export type Shot = { img: ImageMetadata; width: number };

export const shots = {
  highlight: { img: highlight, width: 1280 },
  home: { img: home, width: 1280 },
  readingList: { img: readingList, width: 1280 },
  thread: { img: thread, width: 720 },
  threadNarrow: { img: threadNarrow, width: 400 },
} satisfies Record<string, Shot>;
