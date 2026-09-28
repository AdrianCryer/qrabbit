import type { ImageMetadata } from "astro";
// The app capture behind the README's highlighting image (tools/dev/make-showcase.mjs writes it),
// imported in place so the site and the README show the same app.
import highlight from "../../../docs/screenshots/raw/highlight.png";
// Views the README captures at 1280 wide, where they sit in a column with wide margins or span the
// whole window, captured again at the widths the site draws them (tools/dev/make-site-shots.mjs),
// and at a phone's width: at 1280 their text would come out too small to read here.
import home from "./assets/home.png";
import homeNarrow from "./assets/home-narrow.png";
import readingList from "./assets/reading-list.png";
import readingListNarrow from "./assets/reading-list-narrow.png";
import thread from "./assets/branches.png";
import threadNarrow from "./assets/branches-narrow.png";

/**
 * A capture and the width of the app layout it shows, in CSS pixels. Crops are given in that layout,
 * whatever scale the capture was taken at: the display's own scaling multiplies it.
 */
export type Shot = { img: ImageMetadata; width: number };
/** A region of a capture, in its layout's pixels. */
export type Crop = { x: number; y: number; w: number; h: number };

export const shots = {
  highlight: { img: highlight, width: 1280 },
  home: { img: home, width: 720 },
  homeNarrow: { img: homeNarrow, width: 400 },
  readingList: { img: readingList, width: 808 },
  readingListNarrow: { img: readingListNarrow, width: 400 },
  thread: { img: thread, width: 720 },
  threadNarrow: { img: threadNarrow, width: 400 },
} satisfies Record<string, Shot>;

/** Everything in a capture below the app's 44px header, which the site draws at page size instead. */
export function belowHeader({ img, width }: Shot): Crop {
  return { x: 0, y: 44, w: width, h: (img.height * width) / img.width - 44 };
}
