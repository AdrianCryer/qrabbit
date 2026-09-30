# QRabbit Cloud

The service behind the Cloud plan on the site: collections, threads and marks synced between a reader's computers, with the full PDFs, and everything kept off the machine as a copy. It is a Supabase project: Postgres holds the sync state, Supabase Auth signs people in with an emailed code, and Supabase Storage holds the file content. There is no server of our own to run.

Every account gets 5 GiB. The app talks to it through [`@qrabbit/cloud-api`](../../packages/cloud-api), and the design is written up in [planning/plan-cloud.md](../../planning/plan-cloud.md).

## Layout

```
supabase/
  config.toml                       local stack: ten-minute codes, both sign-in emails carry the code, 2 GiB per object
  migrations/20260928000000_cloud.sql  tables, row-level security, the sync functions, the blobs bucket and its policies
  functions/blob-gc/                edge function that removes content nothing references any more (service role only)
  templates/code.html               the sign-in email
src/
  cloud.test.ts                     end-to-end tests against the local stack, through the client
  sync.test.ts                      two folders kept in step by packages/cloud-sync: merges, removals, positions, the quota
  stack.ts                          finds the running stack and makes test accounts
```

## How sync works, in short

- A collection in the cloud is the latest state of each of its paths: content hash, size, and the collection revision it changed at. Deleting leaves a tombstone at a new revision.
- Content is stored once per account by SHA-256 in the private `blobs` bucket as `<user id>/<sha256>`. The same PDF in two collections is one upload and counts once.
- A client pulls `list_changes(collection, since)`, downloads what it lacks, then reserves room (`reserve_blobs`), uploads, and calls `commit_changes(collection, base, changes)`. Anything the cloud changed after `base` on the same path comes back as a conflict; the client merges (it knows the file formats) and commits again.
- `collections.rev` is on the Realtime publication, so an open app learns of another machine's commit within a second or two.
- Usage is what is referenced, plus reservations and recently unreferenced content for an hour. Content nothing references for seven days is removed by the collector.

Only the functions write the tables; clients read them under row-level security. Errors come back as `PTxyz` SQL states, which PostgREST turns into HTTP status `xyz` with the code as the message: `quota_exceeded` (413), `blobs_missing` (422), `invalid_path` and `bad_request` (400), `collection_not_found` (404), `unauthenticated` (401).

## Running it locally

Docker must be running. From the repo root:

```bash
pnpm cloud:start        # first run pulls the images; prints the local URL, keys and the mail catcher's address
pnpm cloud:test         # end-to-end tests through the client, against the running stack
pnpm cloud:reset        # drop and re-apply the migrations after editing them
pnpm cloud:types        # the CLI's view of the schema, to diff against packages/cloud-api/src/database.types.ts
pnpm cloud:stop
```

Emails go to the local mail catcher (its URL is in `supabase status`), which is also where the sign-in test reads the code from. Studio is at the URL `supabase status` prints.

One thing to know about the local stack: when the storage service refuses a large upload (a path nobody reserved), it answers before the body has arrived, and the gateway in front of it can then hand the next upload to a connection that is still swallowing the old body. That next request sits until the gateway's 60-second timeout. The client never uploads without reserving first, so it only happens when a refusal is forced, which the tests do with a tiny body.

## Deploying to a hosted project

1. Create a project at supabase.com and link it: `pnpm --filter @qrabbit/cloud exec supabase link --project-ref <ref>`.
2. Push the schema: `pnpm --filter @qrabbit/cloud exec supabase db push`.
3. Under Authentication → Emails, set both the "Confirm signup" and "Magic Link" templates to `supabase/templates/code.html` with the subject "Your QRabbit Cloud code", set the OTP expiry to 600 seconds, and turn off "Confirm email" (a code proves the address). Add a real SMTP provider under Authentication → SMTP; the built-in sender is for testing only.
4. Under Storage → Settings, set the global upload limit to 2 GiB (the bucket's own limit is in the migration). Uploads over about 6 MB should move to resumable uploads once the app grows large libraries.
5. Deploy the collector: `pnpm --filter @qrabbit/cloud exec supabase functions deploy blob-gc`. It runs with the service key and refuses any other caller.
6. Schedule it hourly with pg_cron and pg_net (Database → Extensions, then in the SQL editor, with the project URL and the service key from Project Settings → API kept in Vault):

   ```sql
   select vault.create_secret('<service role key>', 'service_role_key');
   select cron.schedule('blob-gc', '17 * * * *', $$
     select net.http_post(
       url := 'https://<ref>.supabase.co/functions/v1/blob-gc',
       headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'))
     );
   $$);
   ```

7. The app needs the project URL and the anon (publishable) key; nothing else leaves the project.

To raise one account's allowance: `update public.profiles set quota_bytes = … where email = …`.

## Not here yet

- Billing. The $5 a month on the site will be Stripe: a checkout from the app, a webhook that sets `profiles.plan`, and the functions refusing writes on a lapsed plan. Everything else is in place for it.
- Resumable uploads for very large PDFs (TUS, `tus-js-client`), which the bucket already supports.
- Pruning old tombstones. They are small rows and are kept, so any machine can catch up from any revision.
