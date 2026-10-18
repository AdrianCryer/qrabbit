-- Devices can be renamed and removed from any computer of the account.
--
-- A device is one machine's sign-in. The row remembers the auth session the machine last signed in with, so
-- removing the device also ends that session: the machine cannot refresh its token, is signed out when the token
-- runs out (an hour at most), and registers as a new device when it signs in again. Renaming was already allowed
-- by the column grant on `name`; it stays a plain update.

alter table public.devices add column session_id uuid;

-- The session is read from the caller's token: at registration, and again whenever the machine checks in
-- (`last_seen_at` moves), since every sign-in is a new session. A rename from another machine leaves it alone.
-- A client cannot set the column itself: the insert and update grants name the other columns only.
create function public.devices_track_session() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.last_seen_at is distinct from old.last_seen_at then
    new.session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  end if;
  return new;
end $$;
revoke execute on function public.devices_track_session() from public, anon, authenticated;
create trigger devices_track_session before insert or update on public.devices
  for each row execute function public.devices_track_session();

-- Removing goes through the function below, so a device never goes without its session.
revoke delete on public.devices from authenticated;

-- Removes one of the account's devices and the session it last signed in with. `device_not_found` (404) when it
-- is not one of the caller's devices. A commit from the removed machine fails at `commit_changes` as an unknown
-- device, which the app reads as "this computer was removed" and signs itself out.
create function public.remove_device(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_session uuid;
begin
  if v_uid is null then raise sqlstate 'PT401' using message = 'unauthenticated'; end if;
  delete from public.devices where id = p_id and user_id = v_uid returning session_id into v_session;
  if not found then raise sqlstate 'PT404' using message = 'device_not_found'; end if;
  if v_session is not null then
    delete from auth.sessions where id = v_session and user_id = v_uid;
  end if;
end $$;
revoke execute on function public.remove_device(uuid) from public, anon;
grant execute on function public.remove_device(uuid) to authenticated;
