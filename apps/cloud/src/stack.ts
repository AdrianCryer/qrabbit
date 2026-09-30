import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { CloudClient, type Database } from "@qrabbit/cloud-api";

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

export type Stack = {
  url: string;
  anonKey: string;
  serviceKey: string;
  /** The local mail catcher's web UI, which also has an API the OTP test reads codes from. */
  mailUrl: string | null;
};

/** `supabase status -o env` prints KEY="VALUE" lines on a terminal and one JSON object when piped. */
function parseEnv(text: string): Record<string, string> {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === "string") as Array<[string, string]>);
  }
  const out: Record<string, string> = {};
  for (const line of trimmed.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=("?)(.*)\2$/.exec(line.trim());
    if (m) out[m[1]!] = m[3]!;
  }
  return out;
}

/** The local stack's URL and keys: from the environment, else from `supabase status`. Null when it is not running. */
export function localStack(): Stack | null {
  const env = process.env;
  if (env["SUPABASE_URL"] && env["SUPABASE_ANON_KEY"] && env["SUPABASE_SERVICE_ROLE_KEY"]) {
    return { url: env["SUPABASE_URL"], anonKey: env["SUPABASE_ANON_KEY"], serviceKey: env["SUPABASE_SERVICE_ROLE_KEY"], mailUrl: env["SUPABASE_MAIL_URL"] ?? null };
  }
  // The `supabase` package's bin is a Node shim in front of the platform binary.
  const shim = join(APP_DIR, "node_modules", "supabase", "dist", "supabase.js");
  if (!existsSync(shim)) return null;
  let text: string;
  try {
    text = execFileSync(process.execPath, [shim, "status", "-o", "env"], { cwd: APP_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 60_000 });
  } catch {
    return null;
  }
  const vars = parseEnv(text);
  const url = vars["API_URL"];
  const anonKey = vars["ANON_KEY"] ?? vars["PUBLISHABLE_KEY"];
  const serviceKey = vars["SERVICE_ROLE_KEY"] ?? vars["SECRET_KEY"];
  if (!url || !anonKey || !serviceKey) return null;
  return { url, anonKey, serviceKey, mailUrl: vars["MAILPIT_URL"] ?? vars["INBUCKET_URL"] ?? null };
}

export type TestUser = { id: string; email: string; password: string; client: CloudClient };

/** The service-role client: bypasses row-level security, for setting up and inspecting state. */
export function admin(stack: Stack): SupabaseClient<Database> {
  return createClient<Database>(stack.url, stack.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

let seq = 0;

/** A fresh account, signed in on a fresh client. Tests use passwords; the app itself only ever uses emailed codes. */
export async function newUser(stack: Stack, label = "reader"): Promise<TestUser> {
  const email = `${label}-${Date.now().toString(36)}-${(seq++).toString(36)}@qrabbit.test`;
  const password = `pw-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  const { data, error } = await admin(stack).auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = new CloudClient({ url: stack.url, anonKey: stack.anonKey });
  const signedIn = await client.supabase.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  return { id: data.user.id, email, password, client };
}

/** A second machine of the same account: its own client, same credentials. */
export async function sameUser(stack: Stack, user: TestUser): Promise<CloudClient> {
  const client = new CloudClient({ url: stack.url, anonKey: stack.anonKey });
  const { error } = await client.supabase.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error) throw error;
  return client;
}

/** Deterministic content of a given size, different per seed. */
export function bytes(size: number, seed: string): Uint8Array {
  const out = new Uint8Array(size);
  let x = 0;
  for (let i = 0; i < seed.length; i++) x = (x * 31 + seed.charCodeAt(i)) >>> 0;
  for (let i = 0; i < size; i++) {
    x = (x * 1664525 + 1013904223) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
