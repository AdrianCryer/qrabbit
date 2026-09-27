/**
 * Everything on the site that changes between releases or deployments lives here, so a release
 * means editing this file and nothing else.
 */
export const site = {
  name: "QRabbit",
  title: "QRabbit: read difficult material with AI",
  description:
    "Highlight a passage, explore it with AI, branch off inside any answer and go as deep as you need. QRabbit keeps your way back, and runs on the agent subscription you already pay for.",
  /** The download buttons point here until each platform has its own asset URL below. */
  releases: "https://github.com/AdrianCryer/qrabbit/releases/latest",
  /** QRabbit Cloud's monthly price in US dollars. */
  cloudPrice: 5,
};

export type Platform = "windows" | "mac" | "linux";

export type Download = {
  name: string;
  /** Which versions and chips the build runs on. */
  runs: string;
  /** The package formats offered. */
  formats: string;
  href: string;
};

export const downloads: Record<Platform, Download> = {
  windows: { name: "Windows", runs: "Windows 10 and 11, x64", formats: "Installer (.exe)", href: site.releases },
  mac: { name: "macOS", runs: "Apple silicon and Intel", formats: "Disk image (.dmg)", href: site.releases },
  linux: { name: "Linux", runs: "x64", formats: "AppImage and .deb", href: site.releases },
};
