-- تراجع عن المرحلة 2ب: يعيد الوضع إلى نهاية المرحلة 2
begin;
do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies
           where schemaname = 'public' and policyname like 'p2b\_%' escape '\'
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;
drop trigger if exists trg_users_protect_super_admin on public.users;

-- role_permissions: كتابة المسؤول (كما كانت بالمرحلة 1)
drop policy if exists role_permissions_super_insert on public.role_permissions;
drop policy if exists role_permissions_super_update on public.role_permissions;
drop policy if exists role_permissions_super_delete on public.role_permissions;
create policy role_permissions_admin_insert on public.role_permissions for insert to authenticated with check ((select public.is_admin()));
create policy role_permissions_admin_update on public.role_permissions for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy role_permissions_admin_delete on public.role_permissions for delete to authenticated using ((select public.is_admin()));
commit;
