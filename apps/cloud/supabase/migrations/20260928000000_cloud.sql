-- QRabbit Cloud: schema, row-level security and the sync functions.
--
-- The user's disk holds the truth; the cloud keeps a copy of every synced file of every collection. Content is
-- stored once per user by SHA-256 in the `blobs` bucket (object name `<user id>/<sha256>`), and `files` holds the
-- latest state of each path with the collection revision it changed at. A client pulls `list_changes` since the
-- revision it last saw, reserves and uploads blobs, then calls `commit_changes` with that revision as its base;
-- anything the cloud changed after it on the same path comes back as a conflict for the client to merge, since
-- only the client knows the file formats.
--
-- Errors raised with SQLSTATE `PTxyz` reach the client as HTTP status xyz, with the message as the error code.
-- Tables are written only through the functions below; clients read them under row-level security.

-- ---------- profiles: one per auth user ----------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  plan text not null default 'cloud' check (plan in ('cloud', 'lapsed')),
  -- 5 GiB. Support raises it per account; billing will set `plan`.
  quota_bytes bigint not null default 5368709120 check (quota_bytes >= 0),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
create policy "profiles: read own" on public.profiles for select to authenticated using (id = (select auth.uid()));

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created after insert or update of email on auth.users
  for each row execute function public.handle_new_user();

-- ---------- devices: the machines an account syncs from ----------
create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  platform text not null check (platform in ('win32', 'darwin', 'linux', 'other')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
alter table public.devices enable row level security;
revoke all on public.devices from anon, authenticated;
grant select, delete on public.devices to authenticated;
grant insert (name, platform) on public.devices to authenticated;
grant update (name, last_seen_at) on public.devices to authenticated;
create policy "devices: own" on public.devices for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------- collections ----------
create table public.collections (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  -- The manifest's own id (col_…), so the same folder on two machines is one cloud collection.
  id text not null check (id ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  name text not null check (char_length(name) between 1 and 200),
  rev bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
alter table public.collections enable row level security;
revoke all on public.collections from anon, authenticated;
grant select, delete on public.collections to authenticated;
grant insert (id, name) on public.collections to authenticated;
grant update (id, name) on public.collections to authenticated;
create policy "collections: own" on public.collections for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- Other machines learn of a new revision through Realtime on this table.
alter table public.collections replica identity full;
alter publication supabase_realtime add table public.collections;

-- ---------- blobs: content, once per user ----------
create table public.blobs (
  user_id uuid not null references public.profiles (id) on delete cascade,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size bigint not null check (size >= 0),
  -- pending: reserved, upload expected. stored: the object is there. deleting: the collector is removing it.
  state text not null default 'pending' check (state in ('pending', 'stored', 'deleting')),
  refs integer not null default 0 check (refs >= 0),
  created_at timestamptz not null default now(),
  -- Null while a file references the blob. Set on reservation and when the last reference goes, so usage stops
  -- counting the blob after an hour and the collector removes it after a week.
  unreferenced_at timestamptz default now(),
  primary key (user_id, sha256)
);
create index blobs_unreferenced on public.blobs (unreferenced_at) where unreferenced_at is not null;
alter table public.blobs enable row level security;
revoke all on public.blobs from anon, authenticated;
grant select on public.blobs to authenticated;
create policy "blobs: read own" on public.blobs for select to authenticated using (user_id = (select auth.uid()));

-- ---------- files: the latest state of every path, tombstones included ----------
create table public.files (
  user_id uuid not null,
  collection_id text not null,
  path text not null,
  sha256 text,
  size bigint not null default 0 check (size >= 0),
  deleted boolean not null default false,
  rev bigint not null,
  device_id uuid references public.devices (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (user_id, collection_id, path),
  foreign key (user_id, collection_id) references public.collections (user_id, id) on delete cascade,
  foreign key (user_id, sha256) references public.blobs (user_id, sha256),
  check (deleted = (sha256 is null))
);
create index files_by_rev on public.files (user_id, collection_id, rev, path);
alter table public.files enable row level security;
revoke all on public.files from anon, authenticated;
grant select on public.files to authenticated;
create policy "files: read own" on public.files for select to authenticated using (user_id = (select auth.uid()));

-- Reference counts on blobs follow the live (not deleted) file rows, whatever writes them.
create function public.files_track_refs() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_old text := case when tg_op in ('UPDATE', 'DELETE') and not old.deleted then old.sha256 end;
  v_new text := case when tg_op in ('INSERT', 'UPDATE') and not new.deleted then new.sha256 end;
begin
  if v_old is distinct from v_new then
    if v_old is not null then
      update public.blobs set refs = refs - 1, unreferenced_at = case when refs <= 1 then now() end
      where user_id = old.user_id and sha256 = v_old;
    end if;
    if v_new is not null then
      update public.blobs set refs = refs + 1, unreferenced_at = null
      where user_id = new.user_id and sha256 = v_new;
    end if;
  end if;
  return null;
end $$;
revoke execute on function public.files_track_refs() from public, anon, authenticated;
create trigger files_track_refs after insert or update or delete on public.files
  for each row execute function public.files_track_refs();

-- ---------- paths ----------
-- Mirrors `syncPathProblem` in packages/cloud-api/src/paths.ts; PATH_FIXTURES there is checked against both.
create function public.is_valid_sync_path(p text) returns boolean
language plpgsql immutable as $$
declare
  v_segments text[];
  v_seg text;
  v_base text;
begin
  if p is null or p = '' or octet_length(p) > 1024 then return false; end if;
  -- Control characters, the backslash and the characters Windows forbids in names.
  if p ~ '[[:cntrl:]]' or p ~ '[\\<>:"|?*]' then return false; end if;
  if left(p, 1) = '/' or right(p, 1) = '/' or position('//' in p) > 0 then return false; end if;
  v_segments := string_to_array(p, '/');
  foreach v_seg in array v_segments loop
    if v_seg in ('.', '..', '.git', 'node_modules') then return false; end if;
    if right(v_seg, 1) in ('.', ' ') then return false; end if;
    if upper(split_part(v_seg, '.', 1)) ~ '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$' then return false; end if;
  end loop;
  v_base := v_segments[array_length(v_segments, 1)];
  if v_base in ('.DS_Store', 'Thumbs.db', 'desktop.ini') or v_base like '%.tmp' then return false; end if;
  -- App state stays local, except the reading positions.
  if (p = '.qrabbit' or p like '.qrabbit/%') and p <> '.qrabbit/reader-state.json' then return false; end if;
  return true;
end $$;
revoke execute on function public.is_valid_sync_path(text) from public, anon;
grant execute on function public.is_valid_sync_path(text) to authenticated;

-- ---------- usage and the account ----------
-- Bytes that count: everything referenced, plus reservations and recently unreferenced blobs for an hour.
create function public.blob_usage(p_user uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(size), 0)::bigint
  from public.blobs
  where user_id = p_user
    and state <> 'deleting'
    and (unreferenced_at is null or unreferenced_at > now() - interval '1 hour');
$$;
revoke execute on function public.blob_usage(uuid) from public, anon, authenticated;

create function public.me() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p.id,
    'email', p.email,
    'plan', p.plan,
    'quotaBytes', p.quota_bytes,
    'usedBytes', public.blob_usage(p.id),
    'createdAt', p.created_at
  )
  from public.profiles p
  where p.id = auth.uid();
$$;
revoke execute on function public.me() from public, anon;
grant execute on function public.me() to authenticated;

create function public.file_entry(f public.files) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'path', f.path, 'sha256', f.sha256, 'size', f.size, 'deleted', f.deleted,
    'rev', f.rev, 'deviceId', f.device_id, 'updatedAt', f.updated_at
  );
$$;
revoke execute on function public.file_entry(public.files) from public, anon, authenticated;

-- ---------- blobs: reserve, confirm ----------
-- Reserves room under the quota for each {sha256, size}. Per item: `stored` (already there, skip the upload),
-- `upload` (reserved, upload it) or `quota` (does not fit). Sizes are what the client declares; the real size
-- replaces them once the object is seen, so a client that lies gains at most one over-sized upload.
create function public.reserve_blobs(p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_quota bigint;
  v_used bigint;
  v_item jsonb;
  v_sha text;
  v_size bigint;
  v_row public.blobs%rowtype;
  v_delta bigint;
  v_status text;
  v_out jsonb := '[]'::jsonb;
begin
  if v_uid is null then raise sqlstate 'PT401' using message = 'unauthenticated'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 1000 then
    raise sqlstate 'PT400' using message = 'bad_request', detail = 'items must be an array of at most 1000 {sha256, size}';
  end if;
  select quota_bytes into v_quota from public.profiles where id = v_uid;
  if v_quota is null then raise sqlstate 'PT401' using message = 'unauthenticated'; end if;
  -- One reservation at a time per account, so parallel uploads cannot each squeeze under the quota.
  perform pg_advisory_xact_lock(hashtext('reserve_blobs'), hashtext(v_uid::text));
  v_used := public.blob_usage(v_uid);
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_sha := lower(v_item ->> 'sha256');
    if v_sha is null or v_sha !~ '^[0-9a-f]{64}$' or jsonb_typeof(v_item -> 'size') <> 'number' then
      raise sqlstate 'PT400' using message = 'bad_request', detail = 'each item needs a sha256 hex digest and a size in bytes';
    end if;
    v_size := (v_item ->> 'size')::numeric::bigint;
    if v_size < 0 then raise sqlstate 'PT400' using message = 'bad_request', detail = 'size must not be negative'; end if;
    select * into v_row from public.blobs where user_id = v_uid and sha256 = v_sha for update;
    if found and v_row.state = 'stored' then
      v_status := 'stored';
    else
      -- A reservation that still counts only adds the difference in size.
      v_delta := case
        when found and (v_row.unreferenced_at is null or v_row.unreferenced_at > now() - interval '1 hour') then v_size - v_row.size
        else v_size
      end;
      if v_used + v_delta > v_quota then
        v_status := 'quota';
      else
        if found then
          update public.blobs set state = 'pending', size = v_size, unreferenced_at = now()
          where user_id = v_uid and sha256 = v_sha;
        else
          insert into public.blobs (user_id, sha256, size, state, refs, unreferenced_at)
          values (v_uid, v_sha, v_size, 'pending', 0, now());
        end if;
        v_used := v_used + v_delta;
        v_status := 'upload';
      end if;
    end if;
    v_out := v_out || jsonb_build_object('sha256', v_sha, 'status', v_status);
  end loop;
  return jsonb_build_object('items', v_out, 'usedBytes', v_used, 'quotaBytes', v_quota);
end $$;
revoke execute on function public.reserve_blobs(jsonb) from public, anon;
grant execute on function public.reserve_blobs(jsonb) to authenticated;

-- True when the blob's object is in the bucket. A reservation is confirmed by the object's presence, and the
-- object's real size replaces the declared one.
create function public.blob_stored(p_user uuid, p_sha text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_state text;
  v_actual bigint;
begin
  select state into v_state from public.blobs where user_id = p_user and sha256 = p_sha for update;
  if not found or v_state = 'deleting' then return false; end if;
  if v_state = 'stored' then return true; end if;
  select (metadata ->> 'size')::bigint into v_actual
  from storage.objects
  where bucket_id = 'blobs' and name = p_user::text || '/' || p_sha;
  if v_actual is null then return false; end if;
  update public.blobs set state = 'stored', size = v_actual where user_id = p_user and sha256 = p_sha;
  return true;
end $$;
revoke execute on function public.blob_stored(uuid, text) from public, anon, authenticated;

-- ---------- sync ----------
-- The changes since a revision, latest state per path, oldest first, paged by (rev, path). With `p_since` 0 the
-- tombstones are left out: a first sync has nothing to delete.
create function public.list_changes(
  p_collection text,
  p_since bigint default 0,
  p_cursor_rev bigint default null,
  p_cursor_path text default null,
  p_limit int default 1000
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_since bigint := greatest(coalesce(p_since, 0), 0);
  v_limit int := least(greatest(coalesce(p_limit, 1000), 1), 2000);
  v_rev bigint;
  v_rows jsonb;
  v_count int;
  v_next jsonb := null;
begin
  if v_uid is null then raise sqlstate 'PT401' using message = 'unauthenticated'; end if;
  select rev into v_rev from public.collections where user_id = v_uid and id = p_collection;
  if v_rev is null then raise sqlstate 'PT404' using message = 'collection_not_found'; end if;
  -- The revision is read before the rows: a commit landing in between shows up in the rows now and again on the
  -- next call, which is harmless; the other order could lose it.
  with page as (
    select f.path, f.sha256, f.size, f.deleted, f.rev, f.device_id, f.updated_at
    from public.files f
    where f.user_id = v_uid and f.collection_id = p_collection
      and f.rev > v_since
      and (v_since > 0 or not f.deleted)
      and (p_cursor_rev is null or (f.rev, f.path) > (p_cursor_rev, coalesce(p_cursor_path, '')))
    order by f.rev, f.path
    limit v_limit + 1
  ), numbered as (
    select p.*, row_number() over (order by p.rev, p.path) as n from page p
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'path', path, 'sha256', sha256, 'size', size, 'deleted', deleted,
      'rev', rev, 'deviceId', device_id, 'updatedAt', updated_at
    ) order by rev, path) filter (where n <= v_limit), '[]'::jsonb),
    count(*)
  into v_rows, v_count
  from numbered;
  if v_count > v_limit then
    select jsonb_build_object('rev', rev, 'path', path) into v_next
    from public.files f
    where f.user_id = v_uid and f.collection_id = p_collection
      and f.rev > v_since
      and (v_since > 0 or not f.deleted)
      and (p_cursor_rev is null or (f.rev, f.path) > (p_cursor_rev, coalesce(p_cursor_path, '')))
    order by f.rev, f.path
    offset v_limit - 1 limit 1;
  end if;
  return jsonb_build_object('rev', v_rev, 'entries', v_rows, 'next', v_next);
end $$;
revoke execute on function public.list_changes(text, bigint, bigint, text, int) from public, anon;
grant execute on function public.list_changes(text, bigint, bigint, text, int) to authenticated;

-- Applies a batch of changes at one new revision. A change to a path the cloud changed after `p_base` is a
-- conflict and is returned with the cloud's current entry instead of being applied; everything else lands.
-- Every referenced blob must be uploaded first (`blobs_missing` lists the ones that are not).
create function public.commit_changes(
  p_collection text,
  p_base bigint,
  p_changes jsonb,
  p_device uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_col public.collections%rowtype;
  v_rev bigint;
  v_any boolean := false;
  v_change jsonb;
  v_path text;
  v_sha text;
  v_del boolean;
  v_cur public.files%rowtype;
  v_blob public.blobs%rowtype;
  v_applied jsonb := '[]'::jsonb;
  v_conflicts jsonb := '[]'::jsonb;
  v_missing text[] := '{}';
  v_invalid text[] := '{}';
  v_seen text[] := '{}';
  v_recounted boolean := false;
  v_used bigint;
  v_quota bigint;
begin
  if v_uid is null then raise sqlstate 'PT401' using message = 'unauthenticated'; end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) > 1000 then
    raise sqlstate 'PT400' using message = 'bad_request', detail = 'changes must be an array of at most 1000 items';
  end if;
  if p_base is null or p_base < 0 then
    raise sqlstate 'PT400' using message = 'bad_request', detail = 'base must be the revision the client last pulled';
  end if;
  if p_device is not null and not exists (select 1 from public.devices where id = p_device and user_id = v_uid) then
    raise sqlstate 'PT400' using message = 'bad_request', detail = 'unknown device';
  end if;
  select * into v_col from public.collections where user_id = v_uid and id = p_collection for update;
  if not found then raise sqlstate 'PT404' using message = 'collection_not_found'; end if;
  if p_base > v_col.rev then
    raise sqlstate 'PT400' using message = 'bad_request', detail = 'base is ahead of the collection';
  end if;

  -- First pass: nothing is written until every change is acceptable.
  for v_change in select * from jsonb_array_elements(p_changes) loop
    v_path := v_change ->> 'path';
    if not public.is_valid_sync_path(v_path) then
      v_invalid := array_append(v_invalid, coalesce(v_path, ''));
      continue;
    end if;
    if v_path = any (v_seen) then
      raise sqlstate 'PT400' using message = 'bad_request', detail = 'the same path appears twice: ' || v_path;
    end if;
    v_seen := array_append(v_seen, v_path);
    v_del := coalesce((v_change ->> 'deleted')::boolean, false);
    if not v_del then
      v_sha := lower(v_change ->> 'sha256');
      if v_sha is null or v_sha !~ '^[0-9a-f]{64}$' then
        v_invalid := array_append(v_invalid, v_path);
      elsif not public.blob_stored(v_uid, v_sha) then
        v_missing := array_append(v_missing, v_sha);
      end if;
    end if;
  end loop;
  if coalesce(array_length(v_invalid, 1), 0) > 0 then
    raise sqlstate 'PT400' using message = 'invalid_path', detail = to_jsonb(v_invalid)::text;
  end if;
  if coalesce(array_length(v_missing, 1), 0) > 0 then
    raise sqlstate 'PT422' using message = 'blobs_missing', detail = to_jsonb(v_missing)::text;
  end if;

  -- Second pass: apply.
  v_rev := v_col.rev + 1;
  for v_change in select * from jsonb_array_elements(p_changes) loop
    v_path := v_change ->> 'path';
    v_del := coalesce((v_change ->> 'deleted')::boolean, false);
    v_sha := case when v_del then null else lower(v_change ->> 'sha256') end;
    select * into v_cur from public.files
    where user_id = v_uid and collection_id = p_collection and path = v_path for update;
    if found then
      -- Already what the client wants: nothing to record.
      if v_cur.deleted = v_del and v_cur.sha256 is not distinct from v_sha then
        v_applied := v_applied || public.file_entry(v_cur);
        continue;
      end if;
      -- Changed in the cloud after the client last pulled: the client merges and tries again.
      if v_cur.rev > p_base then
        v_conflicts := v_conflicts || jsonb_build_object('path', v_path, 'current', public.file_entry(v_cur));
        continue;
      end if;
    elsif v_del then
      -- Deleting what the cloud never had: nothing to record either.
      v_applied := v_applied || jsonb_build_object(
        'path', v_path, 'sha256', null, 'size', 0, 'deleted', true,
        'rev', v_col.rev, 'deviceId', p_device, 'updatedAt', now());
      continue;
    end if;
    if v_sha is not null then
      -- A blob that had aged out of the usage count comes back into it; the quota is checked once at the end.
      select * into v_blob from public.blobs where user_id = v_uid and sha256 = v_sha;
      if v_blob.refs = 0 and v_blob.unreferenced_at is not null and v_blob.unreferenced_at <= now() - interval '1 hour' then
        v_recounted := true;
      end if;
    end if;
    insert into public.files (user_id, collection_id, path, sha256, size, deleted, rev, device_id, updated_at)
    values (v_uid, p_collection, v_path, v_sha, coalesce(v_blob.size, 0), v_del, v_rev, p_device, now())
    on conflict (user_id, collection_id, path) do update
      set sha256 = excluded.sha256, size = excluded.size, deleted = excluded.deleted,
          rev = excluded.rev, device_id = excluded.device_id, updated_at = excluded.updated_at
    returning * into v_cur;
    v_applied := v_applied || public.file_entry(v_cur);
    v_any := true;
    v_blob := null;
  end loop;

  if v_recounted then
    select quota_bytes into v_quota from public.profiles where id = v_uid;
    v_used := public.blob_usage(v_uid);
    if v_used > v_quota then
      raise sqlstate 'PT413' using message = 'quota_exceeded',
        detail = jsonb_build_object('usedBytes', v_used, 'quotaBytes', v_quota)::text;
    end if;
  end if;

  if v_any then
    update public.collections set rev = v_rev, updated_at = now() where user_id = v_uid and id = p_collection;
  end if;
  return jsonb_build_object(
    'rev', case when v_any then v_rev else v_col.rev end,
    'applied', v_applied,
    'conflicts', v_conflicts
  );
end $$;
revoke execute on function public.commit_changes(text, bigint, jsonb, uuid) from public, anon;
grant execute on function public.commit_changes(text, bigint, jsonb, uuid) to authenticated;

-- ---------- garbage collection (service role only; see supabase/functions/blob-gc) ----------
-- Marks blobs nothing has referenced for the grace period and returns them for the collector to remove.
create function public.gc_mark_blobs(p_grace interval default interval '7 days', p_limit int default 500)
returns table (user_id uuid, sha256 text)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with marked as (
    update public.blobs b set state = 'deleting'
    from (
      select x.user_id, x.sha256 from public.blobs x
      where x.refs = 0 and x.unreferenced_at is not null and x.unreferenced_at < now() - p_grace
      order by x.unreferenced_at
      limit greatest(1, least(coalesce(p_limit, 500), 1000))
      for update skip locked
    ) x
    where b.user_id = x.user_id and b.sha256 = x.sha256
    returning b.user_id, b.sha256
  )
  select m.user_id, m.sha256 from marked m;
end $$;
revoke execute on function public.gc_mark_blobs(interval, int) from public, anon, authenticated;
grant execute on function public.gc_mark_blobs(interval, int) to service_role;

-- Drops the rows of removed objects, unless something referenced them again in the meantime.
create function public.gc_finish_blobs(p_items jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  delete from public.blobs b
  using jsonb_to_recordset(p_items) as x(user_id uuid, sha256 text)
  where b.user_id = x.user_id and b.sha256 = x.sha256 and b.state = 'deleting' and b.refs = 0;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke execute on function public.gc_finish_blobs(jsonb) from public, anon, authenticated;
grant execute on function public.gc_finish_blobs(jsonb) to service_role;

-- ---------- storage: the blobs bucket ----------
-- Objects are named `<user id>/<sha256>`. A user can read their own folder and may only upload what they reserved.
insert into storage.buckets (id, name, public, file_size_limit)
values ('blobs', 'blobs', false, 2147483648)
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit;

create policy "blobs: read own" on storage.objects for select to authenticated
  using (bucket_id = 'blobs' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "blobs: upload what was reserved" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'blobs'
    and array_length(storage.foldername(name), 1) = 1
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.blobs b
      where b.user_id = (select auth.uid()) and b.sha256 = storage.filename(name) and b.state = 'pending'
    )
  );

create policy "blobs: replace what was reserved" on storage.objects for update to authenticated
  using (bucket_id = 'blobs' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (
    bucket_id = 'blobs'
    and array_length(storage.foldername(name), 1) = 1
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.blobs b
      where b.user_id = (select auth.uid()) and b.sha256 = storage.filename(name) and b.state = 'pending'
    )
  );
