-- Security and behaviour tests for schema.sql. Any failure raises an exception (psql stops with ON_ERROR_STOP).
\set ON_ERROR_STOP on
insert into public.app_members (email, display_name) values ('merlin@createagency.io', 'Merlin'), ('tyson@createagency.io', 'Tyson');

create or replace function pg_temp.expect_error(sql text, pattern text) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'EXPECTED ERROR matching % but statement succeeded: %', pattern, sql;
exception when others then
  if sqlerrm like 'EXPECTED ERROR%' then raise; end if;
  if sqlerrm !~* pattern then raise exception 'wrong error for %: got "%" expected /%/', sql, sqlerrm, pattern; end if;
  raise notice 'PASS (blocked as expected): % -> %', left(sql, 60), sqlerrm;
end $$;
grant execute on function pg_temp.expect_error(text, text) to anon, authenticated;

-- 1. Anonymous visitors get nothing
set role anon;
select pg_temp.expect_error('select * from public.projects', 'permission denied');
select pg_temp.expect_error('select public.save_project(''x'', ''{"id":"x"}'', null)', 'permission denied');
reset role;

-- 2. Logged-in but NOT on the team list
set role authenticated;
set request.jwt.claims = '{"email":"stranger@gmail.com"}';
do $$ begin if (select count(*) from public.projects) <> 0 then raise exception 'stranger can see projects'; end if; raise notice 'PASS stranger sees 0 rows'; end $$;
select pg_temp.expect_error('select public.save_project(''x'', ''{"id":"x"}'', null)', 'not_authorized');
select pg_temp.expect_error('select public.next_doc_number(''quote'')', 'not_authorized');
select pg_temp.expect_error('select public.import_all(''{}'', ''[]'')', 'not_authorized');

-- 3. Team member
set request.jwt.claims = '{"email":"Merlin@CreateAgency.io"}';
do $$
declare v int; v2 int; n1 text; n2 text; n3 text;
begin
  if not public.is_member() then raise exception 'merlin should be member (case-insensitive)'; end if;
  v := public.save_settings('{"numbering":{"quotePrefix":"CRQ","invoicePrefix":"CRI","receiptPrefix":"CRR","includeYear":true,"nextQuote":1,"nextInvoice":1,"nextReceipt":1}}', null);
  if v <> 1 then raise exception 'settings v1'; end if;
  v := public.save_project('p1', '{"id":"p1","title":"A","quoteNumber":"CRQ-2026-0001"}', null);
  if v <> 1 then raise exception 'new project version should be 1'; end if;
  v2 := public.save_project('p1', '{"id":"p1","title":"B","quoteNumber":"CRQ-2026-0001"}', 1);
  if v2 <> 2 then raise exception 'update should bump version'; end if;
  raise notice 'PASS create + versioned update';
  -- numbering skips the number already used by p1
  n1 := public.next_doc_number('quote');
  n2 := public.next_doc_number('quote');
  if n1 <> 'CRQ-' || to_char(now() at time zone 'Africa/Lagos','YYYY') || '-0002' and n1 not like 'CRQ-%-0002' then raise exception 'expected 0002 got %', n1; end if;
  if n2 not like 'CRQ-%-0003' then raise exception 'expected 0003 got %', n2; end if;
  n3 := public.next_doc_number('receipt');
  if n3 not like 'CRR-%-0001' then raise exception 'receipt %', n3; end if;
  raise notice 'PASS numbering % % %', n1, n2, n3;
  -- settings counter can only move forward
  perform public.save_settings('{"numbering":{"quotePrefix":"CRQ","invoicePrefix":"CRI","receiptPrefix":"CRR","includeYear":true,"nextQuote":1,"nextInvoice":10,"nextReceipt":1}}', 1);
  if (select next from public.doc_counters where kind='quote') <> 4 then raise exception 'quote counter moved backwards'; end if;
  if (select next from public.doc_counters where kind='invoice') <> 10 then raise exception 'invoice counter not moved forward'; end if;
  raise notice 'PASS counters only move forward';
end $$;
-- stale write / id mismatch / direct table writes are blocked
select pg_temp.expect_error($q$select public.save_project('p1', '{"id":"p1","title":"stale"}', 1)$q$, 'conflict');
select pg_temp.expect_error($q$select public.save_project('p1', '{"id":"p1","title":"dup"}', null)$q$, 'conflict');
select pg_temp.expect_error($q$select public.save_project('p2', '{"id":"OTHER"}', null)$q$, 'invalid_project');
select pg_temp.expect_error($q$insert into public.projects (id, data) values ('hack', '{}')$q$, 'permission denied');
select pg_temp.expect_error($q$update public.projects set data = '{}'$q$, 'permission denied');
select pg_temp.expect_error($q$delete from public.projects$q$, 'permission denied');
select pg_temp.expect_error($q$insert into public.app_members values ('evil@x.com')$q$, 'permission denied');
select pg_temp.expect_error($q$select public.delete_project('p1', 1)$q$, 'conflict');
select pg_temp.expect_error($q$select public.save_settings('{}', 1)$q$, 'conflict');

-- 4. Second member sees the same data (shared database)
set request.jwt.claims = '{"email":"tyson@createagency.io"}';
do $$
begin
  if (select data->>'title' from public.projects where id='p1') <> 'B' then raise exception 'tyson cannot see shared project'; end if;
  perform public.save_project('demo_1', '{"id":"demo_1","isDemo":true}', null);
  perform public.save_project('p3', '{"id":"p3"}', null);
  if public.delete_demo_projects() <> 1 then raise exception 'delete demo'; end if;
  perform public.delete_project('p3', 1);
  if exists (select 1 from public.projects where id in ('p3','demo_1')) then raise exception 'delete failed'; end if;
  -- history kept for every change, with who did it
  if (select count(*) from public.project_history where project_id='p1') <> 2 then raise exception 'history p1'; end if;
  if (select changed_by from public.project_history where project_id='p3' and action='delete') <> 'tyson@createagency.io' then raise exception 'history author'; end if;
  raise notice 'PASS shared access, deletes, history with author';
  perform public.import_all('{"numbering":{"nextQuote":50}}', '[{"id":"i1","title":"imported"},{"id":"i2"}]');
  if (select count(*) from public.projects) <> 2 or (select next from public.doc_counters where kind='quote') <> 50 then raise exception 'import'; end if;
  if not exists (select 1 from public.project_history where project_id='p1' and action='delete') then raise exception 'import should keep history of replaced projects'; end if;
  raise notice 'PASS import_all keeps history';
end $$;
select pg_temp.expect_error($q$select public.import_all('{}', '[{"title":"no id"}]')$q$, 'invalid_backup');
-- history cannot be edited
select pg_temp.expect_error($q$delete from public.project_history$q$, 'permission denied');
select pg_temp.expect_error($q$select public.restore_project(1)$q$, 'permission denied');
reset role;
-- restore works from the SQL editor (admin)
do $$ declare hid bigint; begin
  select history_id into hid from public.project_history where project_id = 'p1' and action = 'delete' limit 1;
  perform public.restore_project(hid);
  if not exists (select 1 from public.projects where id = 'p1') then raise exception 'restore failed'; end if;
  raise notice 'PASS restore_project brings back a deleted project (admin only)';
end $$;
\echo ALL RLS TESTS PASSED
