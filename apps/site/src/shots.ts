// The app captures behind the README images (tools/dev/make-showcase.mjs writes them), imported in
// place so the site and the README always show the same app. Each is 1280x800 captured at 2x.
import branches from "../../../docs/screenshots/raw/branches.png";
import highlight from "../../../docs/screenshots/raw/highlight.png";
import home from "../../../docs/screenshots/raw/home.png";
import readingList from "../../../docs/screenshots/raw/reading-list.png";

export const shots = { branches, highlight, home, readingList };
