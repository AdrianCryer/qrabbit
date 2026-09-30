# QRabbit Cloud: sync and backup

*2026-09-28. The service behind the Cloud plan on the site. Backend and client library built; the app's sync loop is next.*

## 1. What the site promises

- Collections, threads and marks synced between your computers.
- Everything saved off your machine, so a lost laptop isn't lost work.
- Still plain files locally: the cloud keeps a copy, never the only one.
- AI still runs on your own subscription; Cloud doesn't resell it.
- $5 a month. About 5 GB of room per account.

So: the whole collection folder, PDFs included, kept in step across machines and recoverable from nothing. Not collaboration, not a web reader, not a place the agent runs.

## 2. Shape

**Supabase, not a server of our own.** Postgres holds the sync state, Supabase Auth signs people in with an emailed code, Supabase Storage holds file content, Realtime tells open apps when something moved. The whole backend is one migration, one edge function and a client library. Nothing to host, patch or back up ourselves, and row-level security keeps accounts apart at the database.

What that costs: the quota is enforced against declared sizes at reservation time and corrected to real sizes once the object is seen, rather than byte-exact at ingest; the content hash is computed by the client. Both only let an account mislead itself, since content is per account. If either ever matters, an edge function can proxy uploads.

**Files stay the unit.** The cloud does not know what a thread or a mark is. It knows paths, hashes and revisions, and the client, which has `@qrabbit/workspace`, does the merging. That keeps the server dumb, small and format-proof: a new file in the folder layout syncs with no server change.

Where it lives:

```
apps/cloud/            the Supabase project: migration, RLS, sync functions, GC edge function, e2e tests
packages/cloud-api/    protocol types, the path rules (shared with SQL), the client over supabase-js
```

## 3. Data model

| Table | Holds | Written by |
|---|---|---|
| `profiles` | one per auth user: plan, `quota_bytes` (5 GiB default) | trigger on `auth.users` |
| `devices` | the machines an account syncs from, for "changed by" | the client (own rows) |
| `collections` | `(user_id, id)` with `rev`, the manifest's `col_…` id so a folder is the same collection on every machine | the client (own rows, `name` only); `rev` by `commit_changes` |
| `files` | the latest state per path: `sha256`, `size`, `deleted`, `rev`, `device_id` | `commit_changes` only |
| `blobs` | content per account by SHA-256: `size`, `state` (pending, stored, deleting), `refs`, `unreferenced_at` | `reserve_blobs`, `commit_changes`, triggers, the collector |

Storage: private bucket `blobs`, objects named `<user id>/<sha256>`. A user may read their folder and may only insert or replace an object whose hash they reserved. Nobody deletes objects but the collector, with the service role.

Reference counts follow the live `files` rows by trigger, so deleting a collection, a file or a tombstone all keep `blobs.refs` right without the functions caring.

## 4. Protocol

Revisions are per collection, one per commit. `files` is its own compacted change log: "changes since R" is `rev > R`, latest state per path, tombstones included.

1. **Pull.** `list_changes(collection, since, cursor, limit)` → `{rev, entries, next}`, paged by `(rev, path)`. The revision is read before the rows, so a commit landing in between shows up now and again next time, never lost. With `since = 0` tombstones are left out.
2. **Download** what the entries name and the client lacks: `getBlob(sha256)`.
3. **Reserve.** `reserve_blobs([{sha256, size}])` → per item `stored` (skip), `upload`, or `quota` (does not fit; the rest still go).
4. **Upload** the `upload` ones to `<uid>/<sha256>`; content is immutable so repeats are harmless.
5. **Commit.** `commit_changes(collection, base, changes, device)` where `base` is the revision the client has fully applied and each change is `{path, sha256}` or `{path, deleted: true}`. Nothing is written unless every path is valid and every hash is uploaded (`invalid_path`, `blobs_missing`). Then, per change: already identical → reported as applied, no new revision; cloud's `rev > base` and different → **conflict**, returned with the cloud's current entry; otherwise written at the new revision. The revision moves only if something was written.
6. **Merge** conflicts locally and commit again with the newer base.
7. **Watch.** `collections` is on the Realtime publication; `watch(collection, cb, onStatus)` fires with the new `rev` and says whether the live channel is up. While it is not, the app polls `list_changes`.

Path rules are one function in two languages, `syncPathProblem` (TypeScript) and `is_valid_sync_path` (SQL), with one fixture list checked against both. Everything in the folder syncs except `.qrabbit/` (only `reader-state.json` inside it goes, so positions follow you), `*.tmp`, `.git`, `node_modules` and OS clutter, and anything Windows could not write (`<>:"|?*\`, trailing dots or spaces, device names).

## 5. Quota and collection

Usage counts blobs that are referenced, plus reservations and recently unreferenced blobs for one hour. So deleting a file frees its room after an hour; adding back a file whose content aged out of the count needs the room again, which `commit_changes` checks. Reservations are serialised per account, so parallel uploads cannot each squeeze under the limit.

The collector (edge function `blob-gc`, hourly by pg_cron) marks blobs unreferenced for seven days as `deleting`, removes the objects, then drops the rows unless something referenced them again meanwhile. A reservation never uploaded goes the same way. It is idempotent and safe to interrupt.

## 6. Sign-in

Email plus a six-digit code that expires in ten minutes: `signInWithOtp` then `verifyOtp`. No passwords anywhere. Both the "confirm signup" and "magic link" templates carry `{{ .Token }}`, because a new address gets the first and a known one the second. The desktop app keeps the session (a refresh token) in the OS keychain through Electron's `safeStorage`, handed to the client as its `sessionStore`. "Sign out other machines" is `signOut("others")`.

## 7. The app's side (built 2026-09-28)

`packages/cloud-sync` is the engine, Node only and tested without Electron; `apps/desktop/src/main/cloud.ts` runs one of it per open cloud collection.

- State in `.qrabbit/cloud.json`, never synced itself: the cloud collection id, the revision fully applied, and the tree as last synced (`path → {sha256, size, mtimeMs}`), so unchanged files are recognised by size and modification time and only changed ones are read. A merged file is recorded with `mtimeMs: -1` so it is hashed afresh.
- A run: scan, then pull since the last revision (removals first with a source's json before its files, then writes with the json last, so nobody sees a source without its file), then push what differs from the last-synced tree: reserve, upload, commit in batches. The revision advances through pulls only, so a commit another machine made between our pull and our push is never skipped. Runs never overlap; a request during a run queues one more.
- Each cloud entry is settled against the local file: only the cloud changed, take it; the same change on both sides, record it; removed in the cloud but changed here, the change stays and goes back up; removed here but changed in the cloud, the change is worth more than the removal; changed on both sides, merge by format against the last synced version, which the cloud still has for a week.
- Merges (`merge.ts`): `qrabbit.json` field by field with the local order first and the cloud's additions after; `source.json` field by field, the later rename winning and a read mark sticking when there is no base; `annotations.json` by id with the later edit winning and removals standing unless the other machine edited the mark; thread files by message id in time order with frontmatter field by field; reading positions per source. Three-way where the base is known: what this machine changed wins, everything else follows the cloud. Anything else keeps both, the cloud's copy as `name (from cloud).ext`.
- Triggers: the folder watcher (`fs.watch`, recursive, two-second debounce, so the app's own writes and edits in Obsidian both count), the live channel, every five minutes, and on open. After a pull the renderer refreshes only what changed (sources, marks, threads, the manifest, positions) and drops the open source if it went away.
- The session lives in `cloud-session.bin` under the app's data folder, encrypted with the OS keychain through `safeStorage`; the device id per account in `cloud-devices.json`. A development build talks to the local stack; a packaged build needs `QRABBIT_CLOUD_URL` and `QRABBIT_CLOUD_ANON_KEY`, and shows no cloud at all without them.
- Interface: a cloud pill in the header with a dot (grey, green, pulsing, red) and a menu holding the one-line state, "Keep … in the cloud", "Sync now", "Stop syncing on this computer" and "Remove from the cloud" with an in-menu confirmation; the home screen marks synced collections and lists the account's other collections to download; Settings has the emailed-code sign-in, the room used, the computers and the collections in the cloud. Sync is a background fact, never a step.

## 8. Deploying

Link, `db push`, set the two email templates and OTP expiry, the 2 GiB storage limit, an SMTP provider, deploy `blob-gc`, schedule it. Step by step in `apps/cloud/README.md`. The app needs only the project URL and the anon key.

## 9. Deferred

- **Billing.** Stripe checkout from the app, a webhook edge function setting `profiles.plan`, and the write functions refusing a lapsed plan. Reads keep working so nobody loses access to their own copy.
- **Resumable uploads** (TUS) for very large PDFs; the bucket supports them, the client would use `tus-js-client`.
- **Tombstone pruning** with a floor revision that forces a full resync below it. Rows are small; not needed yet.
- **Hosted read-only viewer** and sharing: explicitly not part of Cloud.
