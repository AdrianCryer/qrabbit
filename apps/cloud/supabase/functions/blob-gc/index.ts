// Removes blobs nothing has referenced for the grace period: the storage objects first, then the rows.
// Runs with a secret key and is safe to run twice. Schedule it hourly; see the README.
import { createClient } from "npm:@supabase/supabase-js@2";

const GRACE_DAYS = Number(Deno.env.get("BLOB_GRACE_DAYS") ?? "7");
const BATCH = 500;
const MAX_ROUNDS = 20;

/** The project's secret keys. `SUPABASE_SECRET_KEYS` is a JSON object of them by name. */
function secretKeys(): string[] {
  try {
    const byName = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}") as Record<string, unknown>;
    return Object.values(byName).filter((k): k is string => typeof k === "string" && k.length > 0);
  } catch {
    return [];
  }
}

Deno.serve(async (req) => {
  const url = Deno.env.get("SUPABASE_URL");
  const keys = secretKeys();
  if (!url || keys.length === 0) return Response.json({ error: "secret keys not configured" }, { status: 500 });
  // Only the scheduler, which holds a secret key, may start a sweep. Any of the project's secret keys will do, so
  // the scheduler's own key can be rotated without touching the others. The gateway does not check it: a secret
  // key is not a JWT, so the function is deployed with JWT verification off (config.toml).
  const presented = /^Bearer (\S+)$/.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!presented || !keys.includes(presented)) return Response.json({ error: "forbidden" }, { status: 403 });

  const supabase = createClient(url, presented, { auth: { persistSession: false, autoRefreshToken: false } });
  let removed = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const marked = await supabase.rpc("gc_mark_blobs", { p_grace: `${GRACE_DAYS} days`, p_limit: BATCH });
    if (marked.error) return Response.json({ error: marked.error.message, removed }, { status: 500 });
    const items = (marked.data ?? []) as Array<{ user_id: string; sha256: string }>;
    if (items.length === 0) break;
    // Missing objects (a reservation never uploaded) are not an error for remove.
    const gone = await supabase.storage.from("blobs").remove(items.map((b) => `${b.user_id}/${b.sha256}`));
    if (gone.error) return Response.json({ error: gone.error.message, removed }, { status: 500 });
    const finished = await supabase.rpc("gc_finish_blobs", { p_items: items });
    if (finished.error) return Response.json({ error: finished.error.message, removed }, { status: 500 });
    removed += Number(finished.data ?? 0);
    if (items.length < BATCH) break;
  }
  return Response.json({ removed });
});
