-- =========================================================================
-- 01_phase1_hardening.sql — المرحلة 1 من تأمين قاعدة البيانات
--
-- ⚠️ قبل التنفيذ:
--   1) خذ نسخة احتياطية (Database → Backups) واقرأ README.md في هذا المجلد.
--   2) انشر أولاً ملفات التطبيق الجديدة (روابط المستندات الموقّعة) — وإلا ستتعطل
--      روابط المستندات بعد جعل الحاويتين خاصتين.
--   3) شغّل 00_preflight.sql وراجع نتائجه.
--
-- ما يفعله هذا السكربت (بالترتيب):
--   A. دوال مساعدة للأدوار والموافقة.
--   B. جدول users: إغلاق القراءة/الإدخال للمجهولين، منع تغيير الدور/الحالة إلا للمدير.
--   C. إصلاح handle_new_user: لا يثق بالدور القادم من المتصفح أبداً.
--   D. إزالة سياسات الوصول المجهول (public/anon) من الجداول الحساسة.
--   E. role_permissions: الكتابة للمدير فقط.
--   F. "بوابة موافقة" تمنع حسابات التسجيل الذاتي غير الموافق عليها من الجداول.
--   G. التخزين: جعل employee-documents وcompany-documents خاصتين وإغلاق الرفع المجهول.
--
-- السكربت داخل معاملة واحدة: أي خطأ يُلغي كل شيء ولا يترك حالة نصف مطبّقة.
-- يمكن إعادة تشغيله بأمان (idempotent). للتراجع: 99_rollback_phase1.sql
-- =========================================================================
begin;

-- =========================================================================
-- A. دوال مساعدة (SECURITY DEFINER لتفادي التكرار اللانهائي مع RLS على users)
-- =========================================================================
create or replace function public.is_approved()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.users
    where id = auth.uid()
      and coalesce(status, 'active') not in ('pending_review', 'rejected')
  );
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.users
    where id = auth.uid()
      and role in ('super_admin', 'admin')
      and coalesce(status, 'active') not in ('pending_review', 'rejected')
  );
$$;

-- من يملك حق إدارة المستخدمين وتغيير الأدوار. الافتراضي: المدير العام والمسؤول فقط.
-- لو لديك دور مخصّص يدير المستخدمين، عدّل هذه الدالة فقط (انظر README.md).
create or replace function public.can_manage_users()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin();
$$;

-- موظفو النظام (أي دور غير الشركة والموظف) المعتمدون
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.users
    where id = auth.uid()
      and role not in ('company', 'employee')
      and coalesce(status, 'active') not in ('pending_review', 'rejected')
  );
$$;

revoke all on function public.is_approved()      from public, anon;
revoke all on function public.is_admin()         from public, anon;
revoke all on function public.can_manage_users() from public, anon;
revoke all on function public.is_staff()         from public, anon;
grant execute on function public.is_approved()      to authenticated;
grant execute on function public.is_admin()         to authenticated;
grant execute on function public.can_manage_users() to authenticated;
grant execute on function public.is_staff()         to authenticated;

-- =========================================================================
-- B. جدول users
-- =========================================================================
alter table public.users enable row level security;

do $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'users' loop
    execute format('drop policy %I on public.users', r.policyname);
  end loop;
end $$;

-- قراءة: صفّك دائماً (لازم لشاشات الدخول)، وباقي الصفوف للمعتمدين فقط. لا وصول للمجهول.
create policy users_select on public.users for select to authenticated
  using (id = auth.uid() or (select public.is_approved()));

-- إدخال: المدير أي صف، أو المستخدم صفّه هو فقط كموظف قيد المراجعة (تسجيل ذاتي)
create policy users_insert on public.users for insert to authenticated
  with check (
    (select public.can_manage_users())
    or (id = auth.uid() and role = 'employee' and status = 'pending_review')
  );

-- تعديل: المدير أي صف، والمستخدم صفّه (الدور/الحالة محميان بالـ trigger أدناه)
create policy users_update on public.users for update to authenticated
  using (id = auth.uid() or (select public.can_manage_users()))
  with check (id = auth.uid() or (select public.can_manage_users()));

-- حذف: المدير فقط
create policy users_delete on public.users for delete to authenticated
  using ((select public.can_manage_users()));

-- منع غير المدير من تغيير id/role/status حتى على صفّه هو (RLS لا يقيّد الأعمدة).
-- auth.uid() = null يعني SQL Editor/المفتاح الخدمي (service_role) فيُسمح.
create or replace function public.users_protect_privileged_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.can_manage_users() then
    if new.id is distinct from old.id
       or new.role is distinct from old.role
       or new.status is distinct from old.status then
      raise exception 'غير مصرّح: لا يمكن تغيير الدور أو الحالة' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_users_protect_privileged on public.users;
create trigger trg_users_protect_privileged
  before update on public.users
  for each row execute function public.users_protect_privileged_columns();

-- =========================================================================
-- C. handle_new_user: الدور لا يُؤخذ من بيانات الطلب أبداً.
--    كل حساب جديد = employee بحالة pending_review. المدير يضبط الدور والحالة
--    بعد الإنشاء (upsert على users من جلسته — تسمح به سياسة users_insert/update).
--    الاسم والبريد ومتطلب تغيير كلمة المرور فقط يُؤخذان من البيانات.
-- =========================================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, name, email, role, status, must_change_password)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', 'مستخدم جديد'),
    new.email,
    'employee',
    'pending_review',
    coalesce((new.raw_user_meta_data->>'must_change_password')::boolean, true)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- =========================================================================
-- D. إزالة الوصول المجهول (anon) من كل سياسات جداول public
--    بدل حذف السياسات (وقد تكون الوحيدة التي تتيح للمسجّلين القراءة/الكتابة)،
--    نُحوّلها من "public/anon" إلى "authenticated" مع إبقاء شرطها وعمليتها كما هي:
--    سلوك المستخدمين المسجّلين لا يتغيّر إطلاقاً، والمجهول (بالمفتاح العام) يُحجَب.
--    المستثنى عمداً (يحتاجه التطبيق قبل تسجيل الدخول):
--      app_settings      → قراءة مفتاح تفعيل التسجيل الذاتي
--      report_snapshots  → رابط تقرير QR (يُفتح بمعرّف UUID غير قابل للتخمين)
-- =========================================================================
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename not in ('app_settings', 'report_snapshots')
      and (roles && array['public', 'anon']::name[])
  loop
    execute format('alter policy %I on %I.%I to authenticated', r.policyname, r.schemaname, r.tablename);
    raise notice 'policy % on % : anon -> authenticated', r.policyname, r.tablename;
  end loop;
end $$;

-- =========================================================================
-- E. role_permissions: القراءة للمسجّلين (تحتاجها كل الصفحات)، والكتابة للمدير فقط
-- =========================================================================
drop policy if exists "Allow authenticated update on role_permissions" on public.role_permissions;
drop policy if exists "Allow authenticated update role_permissions"    on public.role_permissions;
drop policy if exists "Allow authenticated upsert role_permissions"    on public.role_permissions;

drop policy if exists role_permissions_admin_insert on public.role_permissions;
create policy role_permissions_admin_insert on public.role_permissions for insert to authenticated
  with check ((select public.is_admin()));
drop policy if exists role_permissions_admin_update on public.role_permissions;
create policy role_permissions_admin_update on public.role_permissions for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists role_permissions_admin_delete on public.role_permissions;
create policy role_permissions_admin_delete on public.role_permissions for delete to authenticated
  using ((select public.is_admin()));

-- =========================================================================
-- F. بوابة الموافقة: سياسة RESTRICTIVE (تُدمج بـ AND مع كل السياسات الأخرى)
--    تمنع الحسابات غير المعتمدة (pending_review / rejected) من أي قراءة/كتابة
--    على الجداول التالية، مهما كانت السياسات الأخرى مفتوحة.
--    (شاشتا دخول المسؤول والشركة لا تفحصان الحالة بنفسيهما، فهذا هو الحاجز الفعلي)
-- =========================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'attendance','collection_types','companies','employee_blacklist','employee_collections',
    'employee_link_history','employee_links','employee_salaries','invoices','job_task_templates',
    'notification_preferences','professions','role_permissions','support_tickets','tasks'
  ] loop
    if to_regclass('public.' || t) is null then
      raise notice 'تخطّي جدول غير موجود: %', t;
      continue;
    end if;
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists gate_approved_users on public.%I', t);
    execute format(
      'create policy gate_approved_users on public.%I as restrictive for all to authenticated
         using ((select public.is_approved())) with check ((select public.is_approved()))', t);
  end loop;
end $$;

-- الموظفون: الحساب قيد المراجعة يدخل صفّه هو فقط (لازم لتسجيل الموظف الذاتي)، والإدخال غير مقيَّد هنا
drop policy if exists gate_approved_select on public.employees;
create policy gate_approved_select on public.employees as restrictive for select to authenticated
  using ((select public.is_approved()) or user_id = auth.uid());
drop policy if exists gate_approved_update on public.employees;
create policy gate_approved_update on public.employees as restrictive for update to authenticated
  using ((select public.is_approved())) with check ((select public.is_approved()));
drop policy if exists gate_approved_delete on public.employees;
create policy gate_approved_delete on public.employees as restrictive for delete to authenticated
  using ((select public.is_approved()));

-- =========================================================================
-- G. التخزين: الحاويتان خاصتان + سياسات جديدة بدل القديمة (أغلبها كان مفتوحاً للمجهول)
-- =========================================================================
update storage.buckets set public = false where id in ('employee-documents', 'company-documents');

do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ '(employee|company)-documents'
  loop
    execute format('drop policy %I on storage.objects', r.policyname);
  end loop;
end $$;

-- حاجز مطلق: المجهول (anon) لا يلمس هاتين الحاويتين مهما وُجدت سياسات أخرى مفتوحة
drop policy if exists docs_block_anon on storage.objects;
create policy docs_block_anon on storage.objects as restrictive for all to anon
  using (bucket_id not in ('employee-documents', 'company-documents'))
  with check (bucket_id not in ('employee-documents', 'company-documents'));

-- حواجز مطلقة للمسجّلين أيضاً (RESTRICTIVE = تُدمج بـ AND مع أي سياسة أخرى قديمة/مجهولة):
--   قراءة:  المعتمدون فقط (يُحجَب الحساب قيد المراجعة وأي سياسة قديمة مفتوحة)
--   رفع:    مستندات الموظفين لأي مسجّل (التسجيل الذاتي)، ومستندات الشركات لموظفي النظام
--   تعديل/حذف: موظفو النظام فقط
drop policy if exists docs_guard_select on storage.objects;
create policy docs_guard_select on storage.objects as restrictive for select to authenticated
  using (bucket_id not in ('employee-documents', 'company-documents') or (select public.is_approved()));
drop policy if exists docs_guard_insert on storage.objects;
create policy docs_guard_insert on storage.objects as restrictive for insert to authenticated
  with check (bucket_id not in ('employee-documents', 'company-documents')
              or bucket_id = 'employee-documents' or (select public.is_staff()));
drop policy if exists docs_guard_update on storage.objects;
create policy docs_guard_update on storage.objects as restrictive for update to authenticated
  using (bucket_id not in ('employee-documents', 'company-documents') or (select public.is_staff()))
  with check (bucket_id not in ('employee-documents', 'company-documents') or (select public.is_staff()));
drop policy if exists docs_guard_delete on storage.objects;
create policy docs_guard_delete on storage.objects as restrictive for delete to authenticated
  using (bucket_id not in ('employee-documents', 'company-documents') or (select public.is_staff()));

-- قراءة (للرابط الموقّع): المعتمدون فقط
create policy docs_select on storage.objects for select to authenticated
  using (bucket_id in ('employee-documents', 'company-documents') and (select public.is_approved()));

-- رفع مستندات الموظفين: أي مسجّل (يشمل التسجيل الذاتي قيد المراجعة)
create policy docs_insert_employee on storage.objects for insert to authenticated
  with check (bucket_id = 'employee-documents');

-- رفع مستندات الشركات: موظفو النظام فقط
create policy docs_insert_company on storage.objects for insert to authenticated
  with check (bucket_id = 'company-documents' and (select public.is_staff()));

-- تعديل/حذف: موظفو النظام فقط
create policy docs_update on storage.objects for update to authenticated
  using (bucket_id in ('employee-documents', 'company-documents') and (select public.is_staff()))
  with check (bucket_id in ('employee-documents', 'company-documents') and (select public.is_staff()));
create policy docs_delete on storage.objects for delete to authenticated
  using (bucket_id in ('employee-documents', 'company-documents') and (select public.is_staff()));

commit;
