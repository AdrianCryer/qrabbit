import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CloudClient, CloudError, DEFAULT_QUOTA_BYTES, PATH_FIXTURES, sha256Hex, type FileChange } from "@qrabbit/cloud-api";
import { admin, bytes, localStack, newUser, sameUser, sleep, type Stack, type TestUser } from "./stack.js";

const stack = localStack();
if (!stack) console.warn("\n  Qrabbit Cloud tests skipped: the local Supabase stack is not running (pnpm --filter @qrabbit/cloud start).\n");

const enc = new TextEncoder();
const text = (s: string) => enc.encode(s);

/** Reserve, upload and return the hash, the way the app pushes one file. */
async function upload(client: CloudClient, content: Uint8Array): Promise<string> {
  const sha256 = await sha256Hex(content);
  const r = await client.reserveBlobs([{ sha256, size: content.byteLength }]);
  const status = r.items[0]!.status;
  if (status === "quota") throw new Error("no room for the test blob");
  if (status === "upload") await client.putBlob(sha256, content);
  return sha256;
}

async function expectCloudError(p: Promise<unknown>, code: string): Promise<CloudError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(CloudError);
    expect((err as CloudError).code).toBe(code);
    return err as CloudError;
  }
  throw new Error(`expected a ${code} error`);
}

describe.skipIf(!stack)("Qrabbit Cloud", () => {
  const s = stack as Stack;
  let user: TestUser;

  beforeAll(async () => {
    user = await newUser(s);
  });

  afterAll(async () => {
    await user?.client.signOut();
  });

  it("gives a new account the default quota and nothing used", async () => {
    const me = await user.client.me();
    expect(me.id).toBe(user.id);
    expect(me.email).toBe(user.email);
    expect(me.plan).toBe("cloud");
    expect(me.quotaBytes).toBe(DEFAULT_QUOTA_BYTES);
    expect(me.usedBytes).toBe(0);
  });

  it("agrees with the app about which paths sync", async () => {
    for (const p of PATH_FIXTURES.ok) {
      const { data, error } = await user.client.supabase.rpc("is_valid_sync_path", { p });
      expect(error, p).toBeNull();
      expect(data, p).toBe(true);
    }
    for (const p of PATH_FIXTURES.bad) {
      const { data, error } = await user.client.supabase.rpc("is_valid_sync_path", { p });
      expect(error, JSON.stringify(p)).toBeNull();
      expect(data, JSON.stringify(p)).toBe(false);
    }
  });

  it("syncs a collection from one machine to another", async () => {
    const laptop = user.client;
    const desk = await sameUser(s, user);
    const col = await laptop.putCollection("col_sync1", "Attention");
    expect(col.rev).toBe(0);

    const pdf = bytes(64 * 1024, "paper.pdf");
    const manifest = text(JSON.stringify({ id: "col_sync1", name: "Attention", order: ["paper"] }));
    const pdfSha = await upload(laptop, pdf);
    const manifestSha = await upload(laptop, manifest);
    const device = await laptop.registerDevice("Laptop", "win32");

    const first = await laptop.commit("col_sync1", {
      base: 0,
      deviceId: device.id,
      changes: [
        { path: "sources/paper/source.pdf", sha256: pdfSha },
        { path: "qrabbit.json", sha256: manifestSha },
      ],
    });
    expect(first.rev).toBe(1);
    expect(first.conflicts).toEqual([]);
    expect(first.applied.map((e) => e.path).sort()).toEqual(["qrabbit.json", "sources/paper/source.pdf"]);
    expect(first.applied.every((e) => e.rev === 1 && e.deviceId === device.id)).toBe(true);
    expect(first.applied.find((e) => e.path === "sources/paper/source.pdf")?.size).toBe(pdf.byteLength);

    // The other machine sees everything from the start and gets the same bytes back.
    const page = await desk.changes("col_sync1", { since: 0 });
    expect(page.rev).toBe(1);
    expect(page.next).toBeNull();
    expect(page.entries.map((e) => e.path).sort()).toEqual(["qrabbit.json", "sources/paper/source.pdf"]);
    const back = await desk.getBlob(pdfSha);
    expect(back.byteLength).toBe(pdf.byteLength);
    expect(await sha256Hex(back)).toBe(pdfSha);

    // It changes the manifest; the laptop pulls just that.
    const manifest2 = text(JSON.stringify({ id: "col_sync1", name: "Attention", order: ["paper"], settings: { model: "opus" } }));
    const manifest2Sha = await upload(desk, manifest2);
    const second = await desk.commit("col_sync1", { base: 1, changes: [{ path: "qrabbit.json", sha256: manifest2Sha }] });
    expect(second.rev).toBe(2);
    const delta = await laptop.changes("col_sync1", { since: 1 });
    expect(delta.rev).toBe(2);
    expect(delta.entries).toHaveLength(1);
    expect(delta.entries[0]).toMatchObject({ path: "qrabbit.json", sha256: manifest2Sha, rev: 2, deleted: false });

    // Committing what is already there changes nothing.
    const again = await laptop.commit("col_sync1", { base: 2, changes: [{ path: "qrabbit.json", sha256: manifest2Sha }] });
    expect(again.rev).toBe(2);
    expect(again.applied).toHaveLength(1);

    const list = await desk.collections();
    expect(list.find((c) => c.id === "col_sync1")).toMatchObject({ name: "Attention", rev: 2 });
    await desk.signOut();
  });

  it("returns a conflict when both machines changed the same file, and takes the merge", async () => {
    const laptop = user.client;
    const desk = await sameUser(s, user);
    await laptop.putCollection("col_conflict", "Conflicts");
    const v1 = await upload(laptop, text("[]"));
    await laptop.commit("col_conflict", { base: 0, changes: [{ path: "sources/paper/annotations.json", sha256: v1 }] });

    // Both start from revision 1 and change the same path.
    const laptopEdit = await upload(laptop, text('[{"id":"cmt_1"}]'));
    const deskEdit = await upload(desk, text('[{"id":"cmt_2"}]'));
    const a = await laptop.commit("col_conflict", { base: 1, changes: [{ path: "sources/paper/annotations.json", sha256: laptopEdit }] });
    expect(a.rev).toBe(2);
    const b = await desk.commit("col_conflict", { base: 1, changes: [{ path: "sources/paper/annotations.json", sha256: deskEdit }] });
    expect(b.rev).toBe(2);
    expect(b.applied).toEqual([]);
    expect(b.conflicts).toHaveLength(1);
    expect(b.conflicts[0]).toMatchObject({ path: "sources/paper/annotations.json", current: { sha256: laptopEdit, rev: 2 } });

    // The desk merges (the client knows the format) and commits against what it now knows.
    const merged = await upload(desk, text('[{"id":"cmt_1"},{"id":"cmt_2"}]'));
    const c = await desk.commit("col_conflict", { base: 2, changes: [{ path: "sources/paper/annotations.json", sha256: merged }] });
    expect(c.rev).toBe(3);
    expect(c.conflicts).toEqual([]);
    await desk.signOut();
  });

  it("records deletions as tombstones that later syncs see and first syncs skip", async () => {
    const c = user.client;
    await c.putCollection("col_delete", "Deletions");
    const sha = await upload(c, bytes(2048, "gone.pdf"));
    const keep = await upload(c, text("# keep"));
    await c.commit("col_delete", { base: 0, changes: [{ path: "sources/gone/source.pdf", sha256: sha }, { path: "notes/keep.md", sha256: keep }] });
    const del = await c.commit("col_delete", { base: 1, changes: [{ path: "sources/gone/source.pdf", deleted: true }] });
    expect(del.rev).toBe(2);
    expect(del.applied[0]).toMatchObject({ path: "sources/gone/source.pdf", deleted: true, sha256: null, size: 0, rev: 2 });

    const later = await c.changes("col_delete", { since: 1 });
    expect(later.entries).toHaveLength(1);
    expect(later.entries[0]).toMatchObject({ path: "sources/gone/source.pdf", deleted: true });
    const fresh = await c.changes("col_delete", { since: 0 });
    expect(fresh.entries.map((e) => e.path)).toEqual(["notes/keep.md"]);

    // Deleting what was never there, or is already gone, is fine and records nothing new.
    const noop = await c.commit("col_delete", { base: 2, changes: [{ path: "sources/gone/source.pdf", deleted: true }, { path: "never/here.md", deleted: true }] });
    expect(noop.rev).toBe(2);
    expect(noop.applied).toHaveLength(2);

    // The content is no longer referenced, so it stops counting after the pending window and can be collected.
    const { data: blob } = await admin(s).from("blobs").select("refs, unreferenced_at, state").eq("user_id", user.id).eq("sha256", sha).single();
    expect(blob).toMatchObject({ refs: 0, state: "stored" });
    expect(blob?.unreferenced_at).not.toBeNull();
  });

  it("stores the same content once, across collections", async () => {
    const c = user.client;
    const content = bytes(4096, "shared.pdf");
    const sha = await sha256Hex(content);
    await c.putCollection("col_dedup_a", "A");
    await c.putCollection("col_dedup_b", "B");
    expect((await c.reserveBlobs([{ sha256: sha, size: content.byteLength }])).items[0]?.status).toBe("upload");
    await c.putBlob(sha, content);
    await c.commit("col_dedup_a", { base: 0, changes: [{ path: "sources/shared/source.pdf", sha256: sha }] });
    // The second collection needs no upload at all.
    expect((await c.reserveBlobs([{ sha256: sha, size: content.byteLength }])).items[0]?.status).toBe("stored");
    await c.commit("col_dedup_b", { base: 0, changes: [{ path: "sources/shared/source.pdf", sha256: sha }] });
    const { data: blob } = await admin(s).from("blobs").select("refs").eq("user_id", user.id).eq("sha256", sha).single();
    expect(blob?.refs).toBe(2);
  });

  it("refuses to commit content that was reserved but never uploaded", async () => {
    const c = user.client;
    await c.putCollection("col_missing", "Missing");
    const content = bytes(1024, "never-uploaded.pdf");
    const sha = await sha256Hex(content);
    await c.reserveBlobs([{ sha256: sha, size: content.byteLength }]);
    const err = await expectCloudError(c.commit("col_missing", { base: 0, changes: [{ path: "sources/x/source.pdf", sha256: sha }] }), "blobs_missing");
    expect(err.status).toBe(422);
    expect(err.details).toEqual([sha]);
    expect(err.message).toBe("One file has not been uploaded yet");
  });

  it("rejects paths the app would never send, and bad bases", async () => {
    const c = user.client;
    await c.putCollection("col_paths", "Paths");
    const sha = await upload(c, text("x"));
    const err = await expectCloudError(c.commit("col_paths", { base: 0, changes: [{ path: ".qrabbit/index.sqlite", sha256: sha }, { path: "../escape.md", sha256: sha }] }), "invalid_path");
    expect(err.status).toBe(400);
    expect(err.details).toEqual([".qrabbit/index.sqlite", "../escape.md"]);
    await expectCloudError(c.commit("col_paths", { base: 5, changes: [{ path: "notes/a.md", sha256: sha }] }), "bad_request");
    await expectCloudError(c.commit("col_nope", { base: 0, changes: [] }), "collection_not_found");
    await expectCloudError(c.changes("col_nope"), "collection_not_found");
  });

  it("keeps an account inside its quota", async () => {
    const small = await newUser(s, "small");
    const c = small.client;
    const quota = 1024 * 1024;
    await admin(s).from("profiles").update({ quota_bytes: quota }).eq("id", small.id);
    await c.putCollection("col_quota", "Quota");

    const big = bytes(quota + 1, "too-big.pdf");
    const fits = bytes(600 * 1024, "fits.pdf");
    const more = bytes(500 * 1024, "one-too-many.pdf");
    const r = await c.reserveBlobs([
      { sha256: await sha256Hex(big), size: big.byteLength },
      { sha256: await sha256Hex(fits), size: fits.byteLength },
      { sha256: await sha256Hex(more), size: more.byteLength },
    ]);
    expect(r.items.map((i) => i.status)).toEqual(["quota", "upload", "quota"]);
    expect(r.quotaBytes).toBe(quota);
    expect(r.usedBytes).toBe(fits.byteLength);

    // Storage refuses what was not reserved, even in the account's own folder. A small body stands in for the big
    // file: the local gateway forwards a large body while the storage service is already refusing it, and the
    // upstream connection it then reuses can stall the next upload for a minute (see the README).
    await expectCloudError(c.putBlob(await sha256Hex(big), bytes(64, "stand-in")), "storage");

    await c.putBlob(await sha256Hex(fits), fits);
    await c.commit("col_quota", { base: 0, changes: [{ path: "sources/fits/source.pdf", sha256: await sha256Hex(fits) }] });
    expect((await c.me()).usedBytes).toBe(fits.byteLength);

    // Deleting the file frees the room after the pending window (aged here by hand), and the content can come back.
    await c.commit("col_quota", { base: 1, changes: [{ path: "sources/fits/source.pdf", deleted: true }] });
    await admin(s).from("blobs").update({ unreferenced_at: new Date(Date.now() - 2 * 3600_000).toISOString() }).eq("user_id", small.id).eq("sha256", await sha256Hex(fits));
    expect((await c.me()).usedBytes).toBe(0);
    const r2 = await c.reserveBlobs([{ sha256: await sha256Hex(more), size: more.byteLength }]);
    expect(r2.items[0]?.status).toBe("upload");
    await c.putBlob(await sha256Hex(more), more);
    await c.commit("col_quota", { base: 2, changes: [{ path: "sources/more/source.pdf", sha256: await sha256Hex(more) }] });
    // Bringing the old file back would count its content again, and now it does not fit.
    const err = await expectCloudError(c.commit("col_quota", { base: 3, changes: [{ path: "sources/fits/source.pdf", sha256: await sha256Hex(fits) }] }), "quota_exceeded");
    expect(err.status).toBe(413);
    expect(err.details).toMatchObject({ quotaBytes: quota });
    await c.signOut();
  });

  it("keeps accounts apart", async () => {
    const other = await newUser(s, "other");
    const mine = user.client;
    await mine.putCollection("col_private", "Private");
    const sha = await upload(mine, bytes(1024, "private.pdf"));
    await mine.commit("col_private", { base: 0, changes: [{ path: "sources/p/source.pdf", sha256: sha }] });

    expect((await other.client.collections()).map((c) => c.id)).not.toContain("col_private");
    await expectCloudError(other.client.changes("col_private"), "collection_not_found");
    await expectCloudError(other.client.getBlob(sha), "storage");
    // Not even by naming the other account's folder outright.
    const stray = await other.client.supabase.storage.from("blobs").upload(`${user.id}/${sha}`, bytes(1024, "private.pdf"));
    expect(stray.error).not.toBeNull();
    const peek = await other.client.supabase.storage.from("blobs").download(`${user.id}/${sha}`);
    expect(peek.error).not.toBeNull();
    // Nor can a client write the tables directly.
    const direct = await other.client.supabase.from("files").insert({ user_id: other.id, collection_id: "x", path: "a", sha256: null, deleted: true, rev: 1 } as never);
    expect(direct.error).not.toBeNull();
    const bump = await other.client.supabase.from("profiles").update({ quota_bytes: 10 ** 12 }).eq("id", other.id);
    expect(bump.error).not.toBeNull();
    await other.client.signOut();
  });

  it("pages long change lists without losing or repeating entries", async () => {
    const c = user.client;
    await c.putCollection("col_pages", "Pages");
    const changes: FileChange[] = [];
    for (let i = 0; i < 7; i++) changes.push({ path: `notes/note-${i}.md`, sha256: await upload(c, text(`note ${i}`)) });
    await c.commit("col_pages", { base: 0, changes });
    const seen: string[] = [];
    let cursor = null;
    let rev = 0;
    do {
      const page = await c.changes("col_pages", { since: 0, cursor, limit: 3 });
      seen.push(...page.entries.map((e) => e.path));
      cursor = page.next;
      rev = page.rev;
    } while (cursor);
    expect(seen).toEqual(changes.map((ch) => ch.path).sort());
    expect(rev).toBe(1);
  });

  it("tells other machines when a collection moves on", async () => {
    const laptop = user.client;
    const desk = await sameUser(s, user);
    await laptop.putCollection("col_watch", "Watch");
    const revs: number[] = [];
    const statuses: string[] = [];
    let live: () => void = () => {};
    const isLive = new Promise<void>((resolve) => (live = resolve));
    const stop = desk.watch(
      "col_watch",
      (rev) => revs.push(rev),
      (status, error) => {
        statuses.push(error ? `${status}: ${error}` : status);
        if (status === "live") live();
      },
    );
    // Generous waits: delivery is what is tested, and the whole stack shares this machine with the other suites.
    await Promise.race([isLive, sleep(20_000)]);
    expect(statuses, "the live channel did not come up").toContain("live");
    const sha = await upload(laptop, text("hello"));
    await laptop.commit("col_watch", { base: 0, changes: [{ path: "notes/hello.md", sha256: sha }] });
    for (let i = 0; i < 120 && revs.length === 0; i++) await sleep(250);
    stop();
    expect(revs).toContain(1);
    await desk.signOut();
  });

  it("removes a collection and lets the collector reclaim its content", async () => {
    const c = user.client;
    await c.putCollection("col_gc", "Collected");
    const content = bytes(3000, "collect-me.pdf");
    const sha = await upload(c, content);
    await c.commit("col_gc", { base: 0, changes: [{ path: "sources/c/source.pdf", sha256: sha }] });
    await c.deleteCollection("col_gc");
    expect((await c.collections()).map((x) => x.id)).not.toContain("col_gc");
    await expectCloudError(c.changes("col_gc"), "collection_not_found");

    const a = admin(s);
    const { data: before } = await a.from("blobs").select("refs, unreferenced_at").eq("user_id", user.id).eq("sha256", sha).single();
    expect(before?.refs).toBe(0);
    // Too young for the collector.
    const early = await fetch(`${s.url}/functions/v1/blob-gc`, { method: "POST", headers: { authorization: `Bearer ${s.secretKey}` } });
    expect(early.status).toBe(200);
    expect((await a.from("blobs").select("sha256").eq("user_id", user.id).eq("sha256", sha)).data).toHaveLength(1);
    // Older than the grace period: gone, object and row.
    await a.from("blobs").update({ unreferenced_at: new Date(Date.now() - 8 * 86_400_000).toISOString() }).eq("user_id", user.id).eq("sha256", sha);
    const swept = await fetch(`${s.url}/functions/v1/blob-gc`, { method: "POST", headers: { authorization: `Bearer ${s.secretKey}` } });
    expect(swept.status).toBe(200);
    expect(((await swept.json()) as { removed: number }).removed).toBeGreaterThanOrEqual(1);
    expect((await a.from("blobs").select("sha256").eq("user_id", user.id).eq("sha256", sha)).data).toHaveLength(0);
    await expectCloudError(c.getBlob(sha), "storage");
    // Without a secret key nobody can start a sweep.
    const denied = await fetch(`${s.url}/functions/v1/blob-gc`, { method: "POST", headers: { authorization: `Bearer ${s.publishableKey}` } });
    expect(denied.status).toBe(403);
    const unsigned = await fetch(`${s.url}/functions/v1/blob-gc`, { method: "POST" });
    expect(unsigned.status).toBe(403);
  });

  it("renames and removes devices, and a removed machine has to sign in again", async () => {
    const laptop = user.client;
    const desk = await sameUser(s, user);
    const a = admin(s);
    const sessionOf = async (c: CloudClient) => (JSON.parse(Buffer.from((await c.session())!.access_token.split(".")[1]!, "base64url").toString()) as { session_id: string }).session_id;
    const sessionIds = async () => Object.fromEntries(((await a.from("devices").select("id, session_id").eq("user_id", user.id)).data ?? []).map((d) => [d.id, d.session_id]));

    // A device remembers the session it registered with.
    const mine = await laptop.registerDevice("Laptop", "win32");
    const theirs = await desk.registerDevice("Desk", "darwin");
    expect((await sessionIds())[theirs.id]).toBe(await sessionOf(desk));

    // Any machine may rename any device. The name is checked, and a rename leaves the session alone.
    expect((await laptop.renameDevice(theirs.id, "  Study Mac  ")).name).toBe("Study Mac");
    expect((await desk.devices()).find((d) => d.id === theirs.id)?.name).toBe("Study Mac");
    await expectCloudError(laptop.renameDevice(theirs.id, "   "), "bad_request");
    await expectCloudError(laptop.renameDevice(theirs.id, "x".repeat(81)), "bad_request");
    await expectCloudError(laptop.renameDevice(randomUUID(), "Ghost"), "device_not_found");
    expect((await sessionIds())[theirs.id]).toBe(await sessionOf(desk));

    // Checking in from a new sign-in moves the device to that session.
    const deskAgain = await sameUser(s, user);
    await deskAgain.touchDevice(theirs.id);
    expect((await sessionIds())[theirs.id]).toBe(await sessionOf(deskAgain));

    // Rows cannot be deleted directly, only removed; and only the account's own.
    expect((await desk.supabase.from("devices").delete().eq("id", mine.id)).error).not.toBeNull();
    expect((await laptop.devices()).some((d) => d.id === mine.id)).toBe(true);
    await expectCloudError(laptop.removeDevice(randomUUID()), "device_not_found");
    const other = await newUser(s, "other");
    await expectCloudError(other.client.removeDevice(theirs.id), "device_not_found");
    expect((await laptop.devices()).some((d) => d.id === theirs.id)).toBe(true);

    // Removing the desk ends the session it last checked in with: the token it holds still works until it expires,
    // but it cannot be refreshed, and a push in the meantime names a device the account no longer has.
    await laptop.removeDevice(theirs.id);
    expect((await laptop.devices()).map((d) => d.id)).not.toContain(theirs.id);
    const refreshed = await deskAgain.supabase.auth.refreshSession();
    expect(refreshed.error).not.toBeNull();
    expect(refreshed.data.session).toBeNull();
    await laptop.putCollection("col_devices", "Devices");
    const sha = await upload(desk, text("from the removed desk"));
    const err = await expectCloudError(desk.commit("col_devices", { base: 0, deviceId: theirs.id, changes: [{ path: "notes.md", sha256: sha }] }), "device_removed");
    expect(err.message).toMatch(/removed from the account/);
    // The laptop's own sign-in is untouched.
    expect((await laptop.supabase.auth.refreshSession()).error).toBeNull();

    await other.client.signOut();
    await deskAgain.signOut();
    await desk.signOut();
  });

  it("signs in with an emailed code", { skip: !stack?.mailUrl }, async () => {
    const email = `code-${Date.now().toString(36)}@qrabbit.test`;
    const client = new CloudClient({ url: s.url, publishableKey: s.publishableKey });
    await client.requestCode(email);
    let code: string | null = null;
    for (let i = 0; i < 40 && !code; i++) {
      await sleep(250);
      const found = await fetch(`${s.mailUrl}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
      if (!found.ok) continue;
      const list = (await found.json()) as { messages?: Array<{ ID: string }> };
      const id = list.messages?.[0]?.ID;
      if (!id) continue;
      const msg = (await (await fetch(`${s.mailUrl}/api/v1/message/${id}`)).json()) as { Text?: string; HTML?: string };
      code = /\b(\d{6})\b/.exec(`${msg.Text ?? ""} ${msg.HTML ?? ""}`)?.[1] ?? null;
    }
    expect(code).not.toBeNull();
    const session = await client.verifyCode(email, code!);
    expect(session.user.email).toBe(email);
    expect((await client.me()).email).toBe(email);
    await expectCloudError(client.verifyCode(email, code!), "bad_request");
    await client.signOut();
  });
});
