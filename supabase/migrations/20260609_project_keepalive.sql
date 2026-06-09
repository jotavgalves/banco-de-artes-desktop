-- Banco de Artes - Supabase project keepalive
-- Public, limited heartbeat endpoint for external schedulers.

create table if not exists public.project_heartbeats (
  id text primary key,
  source text not null default 'unknown',
  last_seen_at timestamptz not null default now(),
  ping_count bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.project_heartbeats enable row level security;

revoke all on public.project_heartbeats from public, anon, authenticated;
grant select on public.project_heartbeats to authenticated;

drop policy if exists "project_heartbeats_select_admin" on public.project_heartbeats;
create policy "project_heartbeats_select_admin"
on public.project_heartbeats
for select
to authenticated
using ((select private.is_admin()));

create or replace function public.record_project_heartbeat(p_source text default 'external-scheduler')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_last_seen_at timestamptz;
  v_ping_count bigint;
  v_source text := left(regexp_replace(coalesce(nullif(p_source, ''), 'external-scheduler'), '[^a-zA-Z0-9._:-]', '-', 'g'), 80);
begin
  insert into public.project_heartbeats (id, source, last_seen_at, ping_count, updated_at)
  values ('default', v_source, v_now, 1, v_now)
  on conflict (id) do update
  set
    source = excluded.source,
    last_seen_at = case
      when public.project_heartbeats.last_seen_at <= v_now - interval '10 minutes' then excluded.last_seen_at
      else public.project_heartbeats.last_seen_at
    end,
    ping_count = case
      when public.project_heartbeats.last_seen_at <= v_now - interval '10 minutes' then public.project_heartbeats.ping_count + 1
      else public.project_heartbeats.ping_count
    end,
    updated_at = v_now
  returning last_seen_at, ping_count
  into v_last_seen_at, v_ping_count;

  return jsonb_build_object(
    'ok', true,
    'source', v_source,
    'last_seen_at', v_last_seen_at,
    'ping_count', v_ping_count
  );
end;
$$;

revoke all on function public.record_project_heartbeat(text) from public, anon, authenticated;
grant execute on function public.record_project_heartbeat(text) to anon, authenticated;
