-- Banco de Artes - cleanup Supabase-only
-- Item 3: remove fila legado de Sheets.
-- Item 4: reduz avisos de seguranca/performance.
-- Item 6: apaga fisicamente a arte de teste #123.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create or replace function private.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select id
  from public.profiles
  where auth_user_id = (select auth.uid())
    and active = true
    and deleted_at is null
  limit 1
$$;

create or replace function private.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select role
  from public.profiles
  where auth_user_id = (select auth.uid())
    and active = true
    and deleted_at is null
  limit 1
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce((select private.current_profile_role()) = 'admin', false)
$$;

revoke all on function private.current_profile_id() from public, anon;
revoke all on function private.current_profile_role() from public, anon;
revoke all on function private.is_admin() from public, anon;
grant execute on function private.current_profile_id() to authenticated;
grant execute on function private.current_profile_role() to authenticated;
grant execute on function private.is_admin() to authenticated;

revoke all on function public.current_profile_id() from public, anon, authenticated;
revoke all on function public.current_profile_role() from public, anon, authenticated;
revoke all on function public.current_role() from public, anon, authenticated;
revoke all on function public.is_admin() from public, anon, authenticated;
revoke all on function public.rls_auto_enable() from public, anon, authenticated;

create index if not exists artwork_events_actor_id_idx on public.artwork_events(actor_id);
create index if not exists artworks_deleted_by_idx on public.artworks(deleted_by);
create index if not exists artworks_id_released_by_idx on public.artworks(id_released_by);
create index if not exists artworks_updated_by_idx on public.artworks(updated_by);
create index if not exists id_reservations_released_by_idx on public.id_reservations(released_by);
create index if not exists operation_locks_released_by_idx on public.operation_locks(released_by);
create index if not exists system_settings_updated_by_idx on public.system_settings(updated_by);
create index if not exists error_logs_user_id_idx on public.error_logs(user_id);

drop index if exists public.idx_artworks_client;
drop index if exists public.idx_artworks_created_by;
drop index if exists public.idx_artworks_product;
drop index if exists public.idx_artworks_status;
drop index if exists public.idx_artworks_theme;

grant delete on public.artworks to authenticated;
grant delete on public.artwork_events to authenticated;

drop policy if exists "Admins can read all artworks" on public.artworks;
drop policy if exists "Operators can read active artworks" on public.artworks;
drop policy if exists "Admins can read audit logs" on public.audit_logs;
drop policy if exists "Admins can read all reservations" on public.id_reservations;
drop policy if exists "Users can read own reservations" on public.id_reservations;
drop policy if exists "Admins can read all operation locks" on public.operation_locks;
drop policy if exists "Users can read own operation locks" on public.operation_locks;
drop policy if exists "Admins can read all profiles" on public.profiles;
drop policy if exists "profiles_select_self_claimable_or_admin" on public.profiles;
drop policy if exists "settings_admin_manage" on public.system_settings;

drop policy if exists "profiles_select_self_or_admin" on public.profiles;
create policy "profiles_select_self_or_admin"
on public.profiles
for select
to authenticated
using (
  (select private.is_admin())
  or id = (select private.current_profile_id())
  or (
    auth_user_id is null
    and lower(technical_email) = lower((auth.jwt() ->> 'email'::text))
  )
);

drop policy if exists "artworks_select_authenticated" on public.artworks;
create policy "artworks_select_authenticated"
on public.artworks
for select
to authenticated
using (status in ('active', 'trash') or (select private.is_admin()));

drop policy if exists "artworks_insert_admin" on public.artworks;
drop policy if exists "artworks_insert_authenticated" on public.artworks;
create policy "artworks_insert_authenticated"
on public.artworks
for insert
to authenticated
with check ((select private.is_admin()) or created_by = (select private.current_profile_id()));

drop policy if exists "artworks_update_admin_or_owner_window" on public.artworks;
create policy "artworks_update_admin_or_owner_window"
on public.artworks
for update
to authenticated
using (
  (select private.is_admin())
  or (
    created_by = (select private.current_profile_id())
    and status = 'active'
    and operator_edit_until >= now()
  )
)
with check (
  (select private.is_admin())
  or (
    created_by = (select private.current_profile_id())
    and status = 'active'
    and operator_edit_until >= now()
  )
);

drop policy if exists "artworks_delete_admin" on public.artworks;
create policy "artworks_delete_admin"
on public.artworks
for delete
to authenticated
using ((select private.is_admin()));

drop policy if exists "artwork_events_select_admin" on public.artwork_events;
create policy "artwork_events_select_admin"
on public.artwork_events
for select
to authenticated
using ((select private.is_admin()));

drop policy if exists "artwork_events_insert_authenticated" on public.artwork_events;
create policy "artwork_events_insert_authenticated"
on public.artwork_events
for insert
to authenticated
with check (actor_id = (select private.current_profile_id()) or (select private.is_admin()));

drop policy if exists "artwork_events_delete_admin" on public.artwork_events;
create policy "artwork_events_delete_admin"
on public.artwork_events
for delete
to authenticated
using ((select private.is_admin()));

drop policy if exists "reservations_select_authenticated" on public.id_reservations;
create policy "reservations_select_authenticated"
on public.id_reservations
for select
to authenticated
using (status = 'active' or owner_id = (select private.current_profile_id()) or (select private.is_admin()));

drop policy if exists "reservations_insert_authenticated" on public.id_reservations;
create policy "reservations_insert_authenticated"
on public.id_reservations
for insert
to authenticated
with check (owner_id = (select private.current_profile_id()) or (select private.is_admin()));

drop policy if exists "reservations_update_owner_or_admin" on public.id_reservations;
create policy "reservations_update_owner_or_admin"
on public.id_reservations
for update
to authenticated
using (owner_id = (select private.current_profile_id()) or (select private.is_admin()))
with check (owner_id = (select private.current_profile_id()) or (select private.is_admin()));

drop policy if exists "locks_select_authenticated" on public.operation_locks;
create policy "locks_select_authenticated"
on public.operation_locks
for select
to authenticated
using (status = 'active' or owner_id = (select private.current_profile_id()) or (select private.is_admin()));

drop policy if exists "locks_insert_authenticated" on public.operation_locks;
create policy "locks_insert_authenticated"
on public.operation_locks
for insert
to authenticated
with check (owner_id = (select private.current_profile_id()) or (select private.is_admin()));

drop policy if exists "locks_update_owner_or_admin" on public.operation_locks;
create policy "locks_update_owner_or_admin"
on public.operation_locks
for update
to authenticated
using (owner_id = (select private.current_profile_id()) or (select private.is_admin()))
with check (owner_id = (select private.current_profile_id()) or (select private.is_admin()));

drop policy if exists "audit_select_admin" on public.audit_logs;
create policy "audit_select_admin"
on public.audit_logs
for select
to authenticated
using ((select private.is_admin()));

drop policy if exists "audit_insert_authenticated" on public.audit_logs;
create policy "audit_insert_authenticated"
on public.audit_logs
for insert
to authenticated
with check (actor_id = (select private.current_profile_id()) or (select private.is_admin()));

drop policy if exists "presence_upsert_self" on public.presence;
drop policy if exists "presence_select_authenticated" on public.presence;
drop policy if exists "presence_insert_self" on public.presence;
drop policy if exists "presence_update_self" on public.presence;
drop policy if exists "presence_delete_self" on public.presence;

create policy "presence_select_authenticated"
on public.presence
for select
to authenticated
using (true);

create policy "presence_insert_self"
on public.presence
for insert
to authenticated
with check (user_id = (select private.current_profile_id()) or (select private.is_admin()));

create policy "presence_update_self"
on public.presence
for update
to authenticated
using (user_id = (select private.current_profile_id()) or (select private.is_admin()))
with check (user_id = (select private.current_profile_id()) or (select private.is_admin()));

create policy "presence_delete_self"
on public.presence
for delete
to authenticated
using (user_id = (select private.current_profile_id()) or (select private.is_admin()));

drop policy if exists "error_logs_select_admin" on public.error_logs;
create policy "error_logs_select_admin"
on public.error_logs
for select
to authenticated
using ((select private.is_admin()));

drop policy if exists "error_logs_insert_authenticated" on public.error_logs;
create policy "error_logs_insert_authenticated"
on public.error_logs
for insert
to authenticated
with check (user_id is null or user_id = (select private.current_profile_id()) or (select private.is_admin()));

create policy "settings_admin_manage"
on public.system_settings
for all
to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

drop policy if exists "sheets_queue_select_admin" on public.sheets_sync_queue;
drop table if exists public.sheets_sync_queue;

delete from public.system_settings
where key in ('sheets_report_mode');

insert into public.system_settings(key, value)
values ('official_data_source', '"supabase"'::jsonb)
on conflict (key) do update
set value = excluded.value,
    updated_at = now();

delete from public.artwork_events
where artwork_id = 123;

delete from public.artworks
where id = 123;
