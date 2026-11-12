-- =====================================================================
-- C.R.E.A.T.E. Revenue Calculator — Supabase database setup
--
-- HOW TO USE: Supabase dashboard → SQL Editor → New query → paste this
-- whole file → Run. Safe to run again (it only creates what is missing
-- and replaces the functions).
--
-- Security model
--   * Only people listed in public.app_members can read or change data.
--   * Nobody can write to the tables directly. All changes go through the
--     functions below, which check membership, check the record version
--     (so two people can't silently overwrite each other) and keep a full
--     change history.
--   * The anon (not logged in) role gets no access at all.
-- =====================================================================

-- ---------------------------------------------------------------- tables

create table if not exists public.app_members (
  email        text primary key check (email = lower(email)),
  display_name text not null default '',
  role         text not null default 'admin' check (role in ('admin')),
  added_at     timestamptz not null default now()
);

create table if not exists public.app_settings (
  id         smallint primary key default 1 check (id = 1),
  data       jsonb not null check (jsonb_typeof(data) = 'object'),
  version    integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.doc_counters (
  kind text primary key check (kind in ('quote', 'invoice', 'receipt')),
  next integer not null default 1 check (next >= 1)
);
insert into public.doc_counters (kind, next) values ('quote', 1), ('invoice', 1), ('receipt', 1)
  on conflict (kind) do nothing;

create table if not exists public.projects (
  id         text primary key check (length(id) between 1 and 100),
  data       jsonb not null check (jsonb_typeof(data) = 'object' and octet_length(data::text) < 2000000),
  version    integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.project_history (
  history_id bigint generated always as identity primary key,
  project_id text not null,
  action     text not null check (action in ('insert', 'update', 'delete')),
  data       jsonb,
  version    integer,
  changed_at timestamptz not null default now(),
  changed_by text
);
create index if not exists project_history_project_idx on public.project_history (project_id, changed_at desc);

-- --------------------------------------------------------------- helpers

create or replace function public.current_email() returns text
language sql stable set search_path = public as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_members m where m.email = public.current_email());
$$;

create or replace function public.assert_member() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_member() then
    raise exception 'not_authorized' using errcode = '42501', hint = 'This account is not on the C.R.E.A.T.E. team list.';
  end if;
end $$;

-- History trigger: every insert/update/delete of a project is recorded.
create or replace function public.log_project_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    insert into public.project_history (project_id, action, data, version, changed_by)
      values (old.id, 'delete', old.data, old.version, public.current_email());
    return old;
  end if;
  insert into public.project_history (project_id, action, data, version, changed_by)
    values (new.id, lower(tg_op), new.data, new.version, public.current_email());
  return new;
end $$;

drop trigger if exists projects_history on public.projects;
create trigger projects_history after insert or update or delete on public.projects
  for each row execute function public.log_project_change();

-- ------------------------------------------------------ row level security

alter table public.app_members     enable row level security;
alter table public.app_settings    enable row level security;
alter table public.doc_counters    enable row level security;
alter table public.projects        enable row level security;
alter table public.project_history enable row level security;

drop policy if exists members_read  on public.app_members;
drop policy if exists settings_read on public.app_settings;
drop policy if exists counters_read on public.doc_counters;
drop policy if exists projects_read on public.projects;
drop policy if exists history_read  on public.project_history;

create policy members_read  on public.app_members     for select to authenticated using (public.is_member());
create policy settings_read on public.app_settings    for select to authenticated using (public.is_member());
create policy counters_read on public.doc_counters    for select to authenticated using (public.is_member());
create policy projects_read on public.projects        for select to authenticated using (public.is_member());
create policy history_read  on public.project_history for select to authenticated using (public.is_member());
-- No insert/update/delete policies: writes only happen through the functions below.

revoke all on public.app_members, public.app_settings, public.doc_counters, public.projects, public.project_history from anon;
revoke insert, update, delete, truncate on public.app_members, public.app_settings, public.doc_counters, public.projects, public.project_history from authenticated;
grant select on public.app_members, public.app_settings, public.doc_counters, public.projects, public.project_history to authenticated;

-- ------------------------------------------------------------- functions

-- Save (create or update) one project. Pass the version you loaded; null for a new project.
-- Raises 'conflict' if someone else saved it in the meantime.
create or replace function public.save_project(p_id text, p_data jsonb, p_expected_version integer)
returns integer language plpgsql security definer set search_path = public as $$
declare v integer;
begin
  perform public.assert_member();
  if p_data is null or jsonb_typeof(p_data) <> 'object' or p_data ->> 'id' is distinct from p_id then
    raise exception 'invalid_project' using errcode = '22023';
  end if;
  if p_expected_version is null then
    insert into public.projects (id, data, version, updated_by) values (p_id, p_data, 1, public.current_email())
      on conflict (id) do nothing returning version into v;
  else
    update public.projects set data = p_data, version = version + 1, updated_at = now(), updated_by = public.current_email()
      where id = p_id and version = p_expected_version returning version into v;
  end if;
  if v is null then
    raise exception 'conflict' using errcode = 'P0001', hint = 'Someone else changed this project. Reload to see their changes.';
  end if;
  return v;
end $$;

create or replace function public.delete_project(p_id text, p_expected_version integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_member();
  delete from public.projects where id = p_id and version = p_expected_version;
  if not found then
    raise exception 'conflict' using errcode = 'P0001', hint = 'This project was changed or already deleted by someone else.';
  end if;
end $$;

-- Save settings. Document counters only ever move forward here (numbers already used are skipped anyway).
create or replace function public.save_settings(p_data jsonb, p_expected_version integer)
returns integer language plpgsql security definer set search_path = public as $$
declare v integer;
begin
  perform public.assert_member();
  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'invalid_settings' using errcode = '22023'; end if;
  if p_expected_version is null then
    insert into public.app_settings (id, data, version, updated_by) values (1, p_data, 1, public.current_email())
      on conflict (id) do nothing returning version into v;
  else
    update public.app_settings set data = p_data, version = version + 1, updated_at = now(), updated_by = public.current_email()
      where id = 1 and version = p_expected_version returning version into v;
  end if;
  if v is null then
    raise exception 'conflict' using errcode = 'P0001', hint = 'Someone else changed the settings. Reload to see their changes.';
  end if;
  update public.doc_counters c set next = greatest(c.next, coalesce((p_data #>> array['numbering', case c.kind when 'quote' then 'nextQuote' when 'invoice' then 'nextInvoice' else 'nextReceipt' end])::integer, 1));
  return v;
end $$;

-- Atomically reserve the next unused document number (e.g. CRQ-2026-0007).
create or replace function public.next_doc_number(p_kind text)
returns text language plpgsql security definer set search_path = public as $$
declare
  n integer;
  num text;
  prefix text;
  with_year boolean;
  s jsonb;
  yr text := to_char(now() at time zone 'Africa/Lagos', 'YYYY');
begin
  perform public.assert_member();
  if p_kind not in ('quote', 'invoice', 'receipt') then raise exception 'invalid_kind' using errcode = '22023'; end if;
  select data into s from public.app_settings where id = 1;
  prefix := coalesce(s #>> array['numbering', p_kind || 'Prefix'], case p_kind when 'quote' then 'CRQ' when 'invoice' then 'CRI' else 'CRR' end);
  with_year := coalesce((s #>> '{numbering,includeYear}')::boolean, true);
  select next into n from public.doc_counters where kind = p_kind for update;
  loop
    num := prefix || '-' || case when with_year then yr || '-' else '' end || lpad(n::text, 4, '0');
    exit when not exists (select 1 from public.projects p where p.data::text like '%"' || num || '"%');
    n := n + 1;
  end loop;
  update public.doc_counters set next = n + 1 where kind = p_kind;
  return num;
end $$;

-- Replace everything with a backup (used by "Import backup"). History keeps the old records.
create or replace function public.import_all(p_settings jsonb, p_projects jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare p jsonb;
begin
  perform public.assert_member();
  if jsonb_typeof(p_projects) <> 'array' or jsonb_typeof(p_settings) <> 'object' then raise exception 'invalid_backup' using errcode = '22023'; end if;
  delete from public.projects where true;
  for p in select * from jsonb_array_elements(p_projects) loop
    if p ->> 'id' is null then raise exception 'invalid_backup' using errcode = '22023'; end if;
    insert into public.projects (id, data, updated_by) values (p ->> 'id', p, public.current_email());
  end loop;
  insert into public.app_settings (id, data, updated_by) values (1, p_settings, public.current_email())
    on conflict (id) do update set data = excluded.data, version = public.app_settings.version + 1, updated_at = now(), updated_by = excluded.updated_by;
  update public.doc_counters c set next = greatest(c.next, coalesce((p_settings #>> array['numbering', case c.kind when 'quote' then 'nextQuote' when 'invoice' then 'nextInvoice' else 'nextReceipt' end])::integer, 1));
end $$;

create or replace function public.delete_demo_projects()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  perform public.assert_member();
  delete from public.projects where coalesce((data ->> 'isDemo')::boolean, false);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.save_project(text, jsonb, integer), public.delete_project(text, integer), public.save_settings(jsonb, integer),
  public.next_doc_number(text), public.import_all(jsonb, jsonb), public.delete_demo_projects(), public.is_member(), public.assert_member(),
  public.log_project_change(), public.current_email() from public, anon;
grant execute on function public.save_project(text, jsonb, integer), public.delete_project(text, integer), public.save_settings(jsonb, integer),
  public.next_doc_number(text), public.import_all(jsonb, jsonb), public.delete_demo_projects(), public.is_member(), public.current_email() to authenticated;

-- Undo: put a project back the way it was at one point in its history.
-- Only runs from the Supabase SQL Editor (not callable from the app):  select public.restore_project(123);
create or replace function public.restore_project(p_history_id bigint)
returns text language plpgsql security definer set search_path = public as $$
declare h record;
begin
  select * into h from public.project_history where history_id = p_history_id;
  if h is null or h.data is null then raise exception 'No history entry %', p_history_id; end if;
  insert into public.projects (id, data, updated_by) values (h.project_id, h.data, 'restore')
    on conflict (id) do update set data = excluded.data, version = public.projects.version + 1, updated_at = now(), updated_by = 'restore';
  return 'Restored ' || h.project_id || ' to its ' || h.action || ' of ' || to_char(h.changed_at, 'YYYY-MM-DD HH24:MI');
end $$;
revoke all on function public.restore_project(bigint) from public, anon, authenticated;

-- Live updates: let the app hear about changes made by teammates.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.projects; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.app_settings; exception when duplicate_object then null; end;
  end if;
end $$;

-- =====================================================================
-- TEAM LIST — edit the emails below, then run this part.
-- Each person must ALSO have a login: Authentication → Users → Add user
-- (use the same email, tick "Auto Confirm User").
-- =====================================================================
-- insert into public.app_members (email, display_name) values
--   ('merlin@createagency.io',   'Merlin'),
--   ('tyson@createagency.io',    'Tyson'),
--   ('jonathan@createagency.io', 'Jonathan')
-- on conflict (email) do update set display_name = excluded.display_name;
