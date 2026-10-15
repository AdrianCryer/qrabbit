# QRabbit Cloud

The service behind the Cloud plan on the site: collections, threads and marks synced between a reader's computers, with the full PDFs, and everything kept off the machine as a copy. It is a Supabase project: Postgres holds the sync state, Supabase Auth signs people in with an emailed code, and Supabase Storage holds the file content. There is no server of our own to run.

Every account gets 5 GiB. The app talks to it through [`@qrabbit/cloud-api`](../../packages/cloud-api), and the design is written up in [planning/plan-cloud.md](../../planning/plan-cloud.md).

## Layout

```
supabase/
  config.toml                       local stack and hosted project alike: ten-minute codes, both sign-in emails carry the code, 50 MiB per object
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
pnpm cloud:status       # the local URL, keys, mail catcher and Studio
pnpm cloud:stop
```

Emails go to the local mail catcher, which is also where the sign-in test reads the code from. To point `pnpm desktop:dev` at the local stack, put its `API_URL` and `PUBLISHABLE_KEY` in `apps/desktop/.env.development.local` as `QRABBIT_CLOUD_URL` and `QRABBIT_CLOUD_PUBLISHABLE_KEY` (see `apps/desktop/.env.example`).

One thing to know about the local stack: when the storage service refuses a large upload (a path nobody reserved), it answers before the body has arrived, and the gateway in front of it can then hand the next upload to a connection that is still swallowing the old body. That next request sits until the gateway's 60-second timeout. The client never uploads without reserving first, so it only happens when a refusal is forced, which the tests do with a tiny body.

## Deploying to a hosted project

1. Create a project at supabase.com and link it: `pnpm --filter @qrabbit/cloud exec supabase link --project-ref <ref>`.
2. Push the schema: `pnpm --filter @qrabbit/cloud exec supabase db push`.
3. Push the auth and storage settings from `config.toml`: `pnpm --filter @qrabbit/cloud exec supabase config diff` to review, then `… supabase config push`. That sets both sign-in emails to `supabase/templates/code.html`, six-digit codes valid for ten minutes, one code per address a minute, "Confirm email" off (a code proves the address), and the 50 MB upload limit. The file names no project: what it leaves undeclared, such as the site URL and the pooler's sizes, each project keeps.
4. Add a real SMTP provider under Authentication → SMTP; the built-in sender only reaches the project's team. Its credentials stay in the dashboard, not the repo.
5. Deploy the collector: `pnpm --filter @qrabbit/cloud exec supabase functions deploy blob-gc`. `config.toml` turns off JWT verification for it, because its caller presents a secret key, which is not a JWT; the function accepts any of the project's secret keys and refuses everyone else.
6. Under Project Settings → API Keys, create a secret key named `blob-gc` for the scheduler, so it can be rotated on its own. Then schedule the collector hourly with pg_cron and pg_net (Database → Extensions, then in the SQL editor, with the key kept in Vault):

   ```sql
   select vault.create_secret('<the blob-gc secret key>', 'blob_gc_key');
   select cron.schedule('blob-gc', '17 * * * *', $$
     select net.http_post(
       url := 'https://<ref>.supabase.co/functions/v1/blob-gc',
       headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'blob_gc_key'))
     );
   $$);
   ```

   To rotate it: create a new secret key, `select vault.update_secret((select id from vault.secrets where name = 'blob_gc_key'), '<new key>')`, then delete the old key.
7. Nothing uses the legacy `anon` and `service_role` keys; turn them off under Project Settings → API Keys.
8. The app needs the project URL and the publishable key (`sb_publishable_…`); nothing else leaves the project. Neither is in the source: the release build reads them from its environment, as variables or from `apps/desktop/.env.production.local` (see `apps/desktop/.env.example`). Setting the same two names where the app runs points any build elsewhere.

To raise one account's allowance: `update public.profiles set quota_bytes = … where email = …`.

## Not here yet

- Billing. The $5 a month on the site will be Stripe: a checkout from the app, a webhook that sets `profiles.plan`, and the functions refusing writes on a lapsed plan. Everything else is in place for it.
- Pruning old tombstones. They are small rows and are kept, so any machine can catch up from any revision.
