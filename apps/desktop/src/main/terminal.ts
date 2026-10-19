import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentLaunch } from "@qrabbit/acp-client";

/**
 * Terminals to try on Linux, in order, each with how it runs a program and its arguments. xdg-terminal-exec is the
 * freedesktop proposal and x-terminal-emulator Debian's alternative, both of which follow the user's own choice;
 * the rest are desktops' defaults and common picks, for systems with neither. kgx takes the command as one string.
 */
const LINUX_TERMINALS: [string, (argv: string[]) => string[]][] = [
  ["xdg-terminal-exec", (argv) => argv],
  ["x-terminal-emulator", (argv) => ["-e", ...argv]],
  ["gnome-terminal", (argv) => ["--", ...argv]],
  ["ptyxis", (argv) => ["--", ...argv]],
  ["kgx", (argv) => ["-e", argv.map(sh).join(" ")]],
  ["konsole", (argv) => ["-e", ...argv]],
  ["xfce4-terminal", (argv) => ["-x", ...argv]],
  ["mate-terminal", (argv) => ["-x", ...argv]],
  ["alacritty", (argv) => ["-e", ...argv]],
  ["kitty", (argv) => argv],
  ["foot", (argv) => argv],
  ["wezterm", (argv) => ["start", "--", ...argv]],
  ["xterm", (argv) => ["-e", ...argv]],
];

/**
 * Runs `cmd` in a new terminal window the user types into: Claude Code's sign-in is an interactive CLI. The command
 * goes into a script under `dir` that waits for a key at the end, so the window stays until the user has read it.
 * Rejects when no terminal could be started, with a message that says what to run instead.
 */
export async function runInTerminal(dir: string, cmd: AgentLaunch): Promise<void> {
  mkdirSync(dir, { recursive: true });
  const env = Object.entries(cmd.env ?? {});
  const done = "Done. You can close this window and return to Qrabbit.";
  if (process.platform === "win32") {
    const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;
    const script = join(dir, "sign-in.cmd");
    const lines = ["@echo off", "title Qrabbit sign-in", ...env.map(([k, v]) => `set ${k}=${v}`), [cmd.command, ...cmd.args].map(q).join(" "), "echo.", `echo ${done}`, "pause"];
    writeFileSync(script, lines.join("\r\n") + "\r\n");
    await launch("cmd.exe", ["/c", "start", "Qrabbit sign-in", script]);
    return;
  }
  const script = join(dir, process.platform === "darwin" ? "sign-in.command" : "sign-in.sh");
  const lines = ["#!/bin/bash", ...env.map(([k, v]) => `export ${k}=${sh(v)}`), [cmd.command, ...cmd.args].map(sh).join(" "), "echo", `echo ${sh(done)}`, "read -r"];
  writeFileSync(script, lines.join("\n") + "\n", { mode: 0o755 });
  if (process.platform === "darwin") {
    await launch("open", ["-a", "Terminal", script]);
    return;
  }
  for (const [terminal, argv] of LINUX_TERMINALS) {
    try {
      await launch(terminal, argv(["bash", script]));
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  throw new Error(`No terminal app found. Run this in a terminal to sign in: bash ${sh(script)}`);
}

/** Starts a program on its own, resolving once it is running and rejecting when it cannot start (ENOENT when missing). */
function launch(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: false });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

/** One word for bash: single-quoted, so nothing in it expands. */
function sh(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
