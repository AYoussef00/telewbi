-- =========================================================================
-- 99_rollback_phase1.sql — تراجع طارئ عن المرحلة 1 (استخدمه فقط إن تعطّل التطبيق
-- ولم تستطع إصلاح السبب فوراً).
--
-- يفعل: يُعيد الحاويتين عامّتين، يزيل بوابات الموافقة (restrictive) وحواجز التخزين،
--       ويفتح سياسات users/role_permissions/التخزين للمسجّلين كما كانت عملياً.
-- لا يفعل: لا يُعيد سياسات المجهول (anon) — بقاؤها مغلقة آمن ولا يكسر التطبيق لأن كل
--          الصفحات تعمل بعد تسجيل الدخول — ولا يُعيد trigger handle_new_user القديم
--          (الجديد متوافق مع كل مسارات التطبيق ولا ينبغي العودة لنسخة تثق بدور المتصفح).
-- ⚠️ هذا يعيد الثغرات في users/role_permissions/التخزين. اعتبره حلاً مؤقتاً فقط.
-- =========================================================================
begin;

-- بوابات الموافقة
do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies
           where schemaname = 'public' and policyname in
             ('gate_approved_users','gate_approved_select','gate_approved_update','gate_approved_delete')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- users: مفتوح للمسجّلين
do $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'users' loop
    execute format('drop policy %I on public.users', r.policyname);
  end loop;
end $$;
create policy users_all_authenticated on public.users for all to authenticated using (true) with check (true);
drop trigger if exists trg_users_protect_privileged on public.users;

-- role_permissions: كتابة للمسجّلين
drop policy if exists role_permissions_rollback_write on public.role_permissions;
create policy role_permissions_rollback_write on public.role_permissions for all to authenticated
  using (true) with check (true);

-- التخزين
update storage.buckets set public = true where id in ('employee-documents', 'company-documents');
drop policy if exists docs_block_anon   on storage.objects;
drop policy if exists docs_guard_select on storage.objects;
drop policy if exists docs_guard_insert on storage.objects;
drop policy if exists docs_guard_update on storage.objects;
drop policy if exists docs_guard_delete on storage.objects;
drop policy if exists docs_select on storage.objects;
drop policy if exists docs_insert_employee on storage.objects;
drop policy if exists docs_insert_company on storage.objects;
drop policy if exists docs_update on storage.objects;
drop policy if exists docs_delete on storage.objects;
drop policy if exists docs_rollback_all on storage.objects;
create policy docs_rollback_all on storage.objects for all to authenticated
  using (bucket_id in ('employee-documents', 'company-documents'))
  with check (bucket_id in ('employee-documents', 'company-documents'));

commit;
