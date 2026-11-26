-- =========================================================================
-- 19_rollback_phase2.sql — تراجع عن المرحلة 2 (يعيد الوضع إلى نهاية المرحلة 1)
-- =========================================================================
begin;

do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies
           where schemaname = 'public' and policyname like 'p2\_%' escape '\'
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

drop trigger if exists trg_employees_protect_user_link on public.employees;

-- users_select كما كانت بنهاية المرحلة 1
drop policy if exists users_select on public.users;
create policy users_select on public.users for select to authenticated
  using (id = auth.uid() or (select public.is_approved()));

commit;
