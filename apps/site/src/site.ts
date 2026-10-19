/**
 * Everything on the site that changes between releases or deployments lives here, so a release
 * means editing this file and nothing else.
 */
const repo = "https://github.com/AdrianCryer/qrabbit";

export const site = {
  name: "Qrabbit",
  /** The source. Qrabbit is open source under Apache-2.0, and the site says so wherever it links here. */
  repo,
  title: "Qrabbit: read difficult material with AI",
  description:
    "Highlight a passage, explore it with AI, branch off inside any answer and go as deep as you need. Qrabbit keeps your way back, and runs on the agent subscription you already pay for.",
  /** The releases page; a platform's button links its installer by name under here once it is built. */
  releases: `${repo}/releases/latest`,
  /** Qrabbit Cloud's monthly price in US dollars. */
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
  /** Not built yet: the site says "coming soon" instead of linking it, and never offers it as the visitor's own. */
  soon?: boolean;
  /**
   * A second package, linked under the card's button: a build that isn't signed, under "coming soon" for anyone
   * willing to get past the OS's warning, or another format for systems the card's own doesn't suit. With one,
   * the hero sends the visitor here to choose rather than downloading the card's package.
   */
  alt?: { href: string; label: string; title: string };
};

export const downloads: Record<Platform, Download> = {
  windows: { name: "Windows", runs: "Windows 10 and 11, x64", formats: "Installer (.exe)", href: `${site.releases}/download/Qrabbit-Setup-x64.exe` },
  mac: {
    name: "macOS",
    runs: "Apple silicon and Intel",
    formats: "Disk image (.dmg)",
    href: site.releases,
    soon: true,
    alt: {
      href: `${site.releases}/download/Qrabbit-arm64.dmg`,
      label: "Unsigned build for Apple silicon",
      title: "Not signed or notarized yet, so macOS will warn before it opens.",
    },
  },
  linux: {
    name: "Linux",
    runs: "x64",
    formats: "Debian and Ubuntu package (.deb)",
    href: `${site.releases}/download/Qrabbit-amd64.deb`,
    alt: {
      href: `${site.releases}/download/Qrabbit-x86_64.AppImage`,
      label: "AppImage for other distributions",
      title: "Make it executable, then run it. On Ubuntu 24.04 and later, use the .deb.",
    },
  },
};
