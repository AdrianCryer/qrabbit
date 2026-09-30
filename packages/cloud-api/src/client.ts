import { createClient, type AuthError, type PostgrestError, type Session, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "./database.types.js";
import {
  CloudError,
  type ChangesCursor,
  type ChangesPage,
  type CloudCollection,
  type CloudErrorCode,
  type CommitInput,
  type CommitResult,
  type Device,
  type DevicePlatform,
  type Me,
  type ReserveResult,
} from "./protocol.js";

const BUCKET = "blobs";

export type WatchStatus = "live" | "off";

/** Where the session (a refresh token) lives between runs. The desktop app hands in a store backed by the OS keychain. */
export type SessionStore = {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
};

export type CloudClientOptions = {
  /** The Supabase project URL. */
  url: string;
  /** The project's anon (publishable) key; row-level security does the rest. */
  anonKey: string;
  /** Without a store the session lives in memory and is gone when the process ends. */
  sessionStore?: SessionStore;
  fetch?: typeof fetch;
};

/**
 * QRabbit Cloud from the app's side. One instance per signed-in account; every method throws a `CloudError`
 * with a code the app can act on.
 */
export class CloudClient {
  readonly supabase: SupabaseClient<Database>;

  constructor(opts: CloudClientOptions) {
    this.supabase = createClient<Database>(opts.url, opts.anonKey, {
      auth: {
        persistSession: !!opts.sessionStore,
        ...(opts.sessionStore ? { storage: opts.sessionStore } : {}),
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
      ...(opts.fetch ? { global: { fetch: opts.fetch } } : {}),
    });
  }

  // ---------- sign-in: an emailed code, no password ----------

  /** Email a sign-in code. New addresses get an account. */
  async requestCode(email: string): Promise<void> {
    const { error } = await this.supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
    if (error) throw fromAuth(error);
  }

  /** Exchange the emailed code for a session. */
  async verifyCode(email: string, code: string): Promise<Session> {
    const { data, error } = await this.supabase.auth.verifyOtp({ email: email.trim(), token: code.replace(/\s+/g, ""), type: "email" });
    if (error) throw fromAuth(error);
    if (!data.session) throw new CloudError("unauthenticated", "The code was accepted but no session came back");
    return data.session;
  }

  /** The current session, refreshed when its access token has expired; null when signed out. */
  async session(): Promise<Session | null> {
    const { data, error } = await this.supabase.auth.getSession();
    if (error) throw fromAuth(error);
    return data.session;
  }

  /** Fires on sign-in, refresh and sign-out. Returns the unsubscribe. */
  onAuthChange(cb: (session: Session | null) => void): () => void {
    const { data } = this.supabase.auth.onAuthStateChange((_event, session) => cb(session));
    return () => data.subscription.unsubscribe();
  }

  /** `local` signs this machine out; `others` every other machine; `global` all of them. */
  async signOut(scope: "local" | "others" | "global" = "local"): Promise<void> {
    const { error } = await this.supabase.auth.signOut({ scope });
    if (error) throw fromAuth(error);
  }

  private async userId(): Promise<string> {
    const session = await this.session();
    if (!session) throw new CloudError("unauthenticated", "Sign in to QRabbit Cloud first");
    return session.user.id;
  }

  // ---------- the account ----------

  async me(): Promise<Me> {
    const { data, error } = await this.supabase.rpc("me");
    if (error) throw fromPostgrest(error);
    if (!data) throw new CloudError("unauthenticated", "Sign in to QRabbit Cloud first");
    return data as unknown as Me;
  }

  /** Register this machine, so other machines can see who changed what. Keep the id with the session. */
  async registerDevice(name: string, platform: DevicePlatform): Promise<Device> {
    const { data, error } = await this.supabase.from("devices").insert({ name, platform }).select().single();
    if (error) throw fromPostgrest(error);
    return toDevice(data);
  }

  async devices(): Promise<Device[]> {
    const { data, error } = await this.supabase.from("devices").select().order("last_seen_at", { ascending: false });
    if (error) throw fromPostgrest(error);
    return data.map(toDevice);
  }

  async touchDevice(id: string): Promise<void> {
    const { error } = await this.supabase.from("devices").update({ last_seen_at: new Date().toISOString() }).eq("id", id);
    if (error) throw fromPostgrest(error);
  }

  async removeDevice(id: string): Promise<void> {
    const { error } = await this.supabase.from("devices").delete().eq("id", id);
    if (error) throw fromPostgrest(error);
  }

  // ---------- collections ----------

  async collections(): Promise<CloudCollection[]> {
    const { data, error } = await this.supabase.from("collections").select().order("updated_at", { ascending: false });
    if (error) throw fromPostgrest(error);
    return data.map(toCollection);
  }

  /** Put a collection in the cloud, or rename it there. The id is the manifest's, so it is the same on every machine. */
  async putCollection(id: string, name: string): Promise<CloudCollection> {
    const { data, error } = await this.supabase.from("collections").upsert({ id, name }, { onConflict: "user_id,id" }).select().single();
    if (error) throw fromPostgrest(error);
    return toCollection(data);
  }

  /** Take a collection out of the cloud. Its files go at once; its content is collected after the grace period. */
  async deleteCollection(id: string): Promise<void> {
    const { error } = await this.supabase.from("collections").delete().eq("id", id);
    if (error) throw fromPostgrest(error);
  }

  /** What changed since a revision, oldest first. Follow `next` until it is null, then keep `rev` as the new `since`. */
  async changes(collectionId: string, opts: { since?: number; cursor?: ChangesCursor | null; limit?: number } = {}): Promise<ChangesPage> {
    const { data, error } = await this.supabase.rpc("list_changes", {
      p_collection: collectionId,
      p_since: opts.since ?? 0,
      p_cursor_rev: opts.cursor?.rev ?? undefined,
      p_cursor_path: opts.cursor?.path ?? undefined,
      p_limit: opts.limit ?? 1000,
    });
    if (error) throw fromPostgrest(error);
    return data as unknown as ChangesPage;
  }

  /**
   * Be told when the collection's revision moves, from any machine. `onStatus` says whether the live channel is up;
   * while it is not, the app polls `changes` instead. Returns the unsubscribe.
   */
  watch(collectionId: string, onRev: (rev: number) => void, onStatus?: (status: WatchStatus, error?: string) => void): () => void {
    const channel = this.supabase
      .channel(`collection:${collectionId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "collections", filter: `id=eq.${collectionId}` }, (payload) => {
        const rev = (payload.new as { rev?: number }).rev;
        if (typeof rev === "number") onRev(rev);
      })
      .subscribe((state, err) => {
        if (!onStatus) return;
        if (state === "SUBSCRIBED") onStatus("live");
        else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") onStatus("off", err?.message ?? state);
        else if (state === "CLOSED") onStatus("off");
      });
    return () => {
      void this.supabase.removeChannel(channel);
    };
  }

  // ---------- content ----------

  /** Ask for room for these blobs. Upload the ones that come back `upload`; `stored` ones are already there. */
  async reserveBlobs(items: Array<{ sha256: string; size: number }>): Promise<ReserveResult> {
    const { data, error } = await this.supabase.rpc("reserve_blobs", { p_items: items as unknown as Json });
    if (error) throw fromPostgrest(error);
    return data as unknown as ReserveResult;
  }

  /** Upload a reserved blob. Content is immutable, so uploading the same hash twice is harmless. */
  async putBlob(sha256: string, bytes: Uint8Array | Blob): Promise<void> {
    const uid = await this.userId();
    const { error } = await this.supabase.storage.from(BUCKET).upload(`${uid}/${sha256}`, bytes, { contentType: "application/octet-stream", upsert: true });
    if (error) throw fromStorage(error, `Could not upload ${sha256.slice(0, 12)}`);
  }

  async getBlob(sha256: string): Promise<Uint8Array> {
    const uid = await this.userId();
    const { data, error } = await this.supabase.storage.from(BUCKET).download(`${uid}/${sha256}`);
    if (error) throw fromStorage(error, `Could not download ${sha256.slice(0, 12)}`);
    return new Uint8Array(await data.arrayBuffer());
  }

  /** Push changes made since `base`. Conflicts come back for the client to merge and commit again. */
  async commit(collectionId: string, input: CommitInput): Promise<CommitResult> {
    const { data, error } = await this.supabase.rpc("commit_changes", {
      p_collection: collectionId,
      p_base: input.base,
      p_changes: input.changes as unknown as Json,
      p_device: input.deviceId ?? undefined,
    });
    if (error) throw fromPostgrest(error);
    return data as unknown as CommitResult;
  }
}

// ---------- rows to protocol objects ----------
type DeviceRow = Database["public"]["Tables"]["devices"]["Row"];
type CollectionRow = Database["public"]["Tables"]["collections"]["Row"];

const toDevice = (r: DeviceRow): Device => ({ id: r.id, name: r.name, platform: r.platform as DevicePlatform, createdAt: r.created_at, lastSeenAt: r.last_seen_at });
const toCollection = (r: CollectionRow): CloudCollection => ({ id: r.id, name: r.name, rev: Number(r.rev), createdAt: r.created_at, updatedAt: r.updated_at });

// ---------- errors ----------
const KNOWN_CODES: ReadonlySet<string> = new Set<CloudErrorCode>(["unauthenticated", "bad_request", "invalid_path", "collection_not_found", "blobs_missing", "quota_exceeded"]);

const looksLikeNetwork = (message: string) => /fetch failed|network|ECONN|ENOTFOUND|EAI_AGAIN|Failed to fetch/i.test(message);

function describe(code: CloudErrorCode, details: unknown, fallback: string): string {
  switch (code) {
    case "unauthenticated":
      return "Sign in to QRabbit Cloud first";
    case "collection_not_found":
      return "This collection is not in the cloud";
    case "quota_exceeded": {
      const d = details as { usedBytes?: number; quotaBytes?: number } | undefined;
      return d?.usedBytes !== undefined && d.quotaBytes !== undefined ? `The cloud is full: ${gb(d.usedBytes)} of ${gb(d.quotaBytes)} used` : "The cloud is full";
    }
    case "blobs_missing": {
      const n = Array.isArray(details) ? details.length : 0;
      return n === 1 ? "One file has not been uploaded yet" : `${n || "Some"} files have not been uploaded yet`;
    }
    case "invalid_path": {
      const paths = Array.isArray(details) ? (details as string[]) : [];
      return paths.length ? `These paths cannot be stored in the cloud: ${paths.slice(0, 3).join(", ")}${paths.length > 3 ? "…" : ""}` : "A path cannot be stored in the cloud";
    }
    case "network":
      return "QRabbit Cloud could not be reached";
    default:
      return fallback;
  }
}

const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(bytes >= 1024 ** 3 ? 1 : 2)} GB`;

/** PostgREST errors: our functions raise `PTxyz` with the code as the message and JSON in the detail. */
export function fromPostgrest(e: PostgrestError): CloudError {
  const status = /^PT(\d{3})$/.exec(e.code ?? "") ? Number(e.code.slice(2)) : undefined;
  let details: unknown = e.details;
  if (typeof e.details === "string" && /^[[{]/.test(e.details)) {
    try {
      details = JSON.parse(e.details);
    } catch {
      /* keep the text */
    }
  }
  let code: CloudErrorCode = "unknown";
  if (KNOWN_CODES.has(e.message)) code = e.message as CloudErrorCode;
  else if (e.code === "PGRST301" || e.code === "42501" || status === 401) code = "unauthenticated";
  else if (looksLikeNetwork(e.message)) code = "network";
  const fallback = code === "unknown" && typeof e.details === "string" && e.details ? `${e.message}: ${e.details}` : e.message;
  return new CloudError(code, describe(code, details, fallback), { status, details, cause: e });
}

/** Auth errors about the session mean "sign in again"; everything else is about the request (a wrong code, a rate limit). */
const SESSION_ERRORS = new Set(["session_not_found", "session_expired", "refresh_token_not_found", "refresh_token_already_used", "bad_jwt", "no_authorization", "user_not_found"]);

function fromAuth(e: AuthError): CloudError {
  let code: CloudErrorCode = "bad_request";
  if (looksLikeNetwork(e.message)) code = "network";
  else if (e.status === 401 || (e.code && SESSION_ERRORS.has(e.code))) code = "unauthenticated";
  let message = e.message;
  if (code === "network" || code === "unauthenticated") message = describe(code, undefined, e.message);
  else if (e.code === "otp_expired") message = "That code has expired or was already used; ask for a new one";
  else if (e.code === "over_email_send_rate_limit") message = "Too many codes were sent to that address; wait a little before asking again";
  return new CloudError(code, message, { status: e.status, details: e.code, cause: e });
}

function fromStorage(e: { message: string; status?: number; statusCode?: string }, what: string): CloudError {
  const status = e.status ?? (e.statusCode ? Number(e.statusCode) : undefined);
  const code: CloudErrorCode = looksLikeNetwork(e.message) ? "network" : status === 401 ? "unauthenticated" : "storage";
  return new CloudError(code, code === "network" ? describe(code, undefined, e.message) : `${what}: ${e.message}`, { status, cause: e });
}
