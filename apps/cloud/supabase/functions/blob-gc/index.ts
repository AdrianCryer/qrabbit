// Removes blobs nothing has referenced for the grace period: the storage objects first, then the rows.
// Runs with the service role and is safe to run twice. Schedule it hourly; see the README.
import { createClient } from "npm:@supabase/supabase-js@2";

const GRACE_DAYS = Number(Deno.env.get("BLOB_GRACE_DAYS") ?? "7");
const BATCH = 500;
const MAX_ROUNDS = 20;

Deno.serve(async (req) => {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return Response.json({ error: "service role not configured" }, { status: 500 });
  // Only the scheduler, which holds the service key, may start a sweep.
  if (req.headers.get("authorization") !== `Bearer ${key}`) return Response.json({ error: "forbidden" }, { status: 403 });

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
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
