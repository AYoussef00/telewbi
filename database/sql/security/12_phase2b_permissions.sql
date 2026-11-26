-- =========================================================================
-- 12_phase2b_permissions.sql — المرحلة 2ب: فرض صلاحيات «الأقسام» داخل قاعدة البيانات
--
-- المشكلة: صلاحيات (عرض/إضافة/تعديل/حذف) لكل دور تُحفَظ في role_permissions وتُطبَّق في الواجهة
-- فقط. أي موظف نظام بدور محدود (مثلاً «محاسب» لا يملك حذف الفواتير) يستطيع تجاوزها بالمفتاح
-- العام وإرسال طلب مباشر. هذا السكربت يجعل قاعدة البيانات تتحقق من نفس الصلاحيات.
--
-- مبادئ التصميم (لعدم تعطيل أي شاشة):
--   • الدالة has_perm تطابق منطق Permissions.can في permissions.js حرفياً: المدير العام = كل شيء،
--     لا صف صلاحيات للدور = كل شيء، الصيغ القديمة (قسم مجرّد، action:attendance_bulk_add،
--     add:finance_invoices، صلاحية القسم الأب) تُترجَم بنفس القواعد.
--   • تُطبَّق على موظفي النظام فقط (الشركة والموظف يحكمهما عزل المرحلة 2 بالنطاق).
--   • الكتابة: كل جدول مربوط بكل (عمل:قسم) تستخدمه شاشاته فعلاً (اتحاد، لا تقاطع).
--   • القراءة: تُقيَّد فقط الجداول التي لا تقرؤها لوحة التحكم (المفتوحة لكل الأدوار): الفواتير،
--     التحصيل، الرواتب، القائمة السوداء، التذاكر، قوالب المهام، طلبات التسجيل.
--   • إضافة: المدير العام وحده يعدّل role_permissions ويمنح/يسحب دور super_admin.
--
-- المتطلب: المرحلتان 1 و2. إعادة التشغيل آمنة. للتراجع: 12_rollback_phase2b.sql
-- =========================================================================
begin;

-- ---------- 1) دوال ----------
create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and role = 'super_admin'
      and coalesce(status, 'active') not in ('pending_review', 'rejected')
  );
$$;

-- هل القائمة lst (محتوى role_permissions.menus) تمنح (action:section)؟ — مطابقة لـ normalizeRawMenus
create or replace function public.perm_list_grants(lst text[], p_action text, p_section text)
returns boolean language plpgsql immutable as $$
declare
  actions text[] := array['view','add','edit','delete'];
  a text; has_explicit boolean := false; parent text;
begin
  -- قسم فرعي -> أبوه (للتوافق مع الإعدادات القديمة قبل تفكيك المالية/الرواتب/التقارير)
  parent := case
    when p_section in ('finance_invoices','invoice_issuing','finance_collections','collection_types') then 'finance'
    when p_section in ('salaries_export','salaries_import') then 'salaries'
    when p_section like 'reports\_%' escape '\' then 'reports'
    else null end;

  foreach a in array actions loop
    if (a || ':' || p_section) = any(lst) then has_explicit := true; end if;
  end loop;

  if (p_action || ':' || p_section) = any(lst) then return true; end if;
  if not has_explicit and p_section = any(lst) then return true; end if;            -- قسم مجرّد قديم
  if p_section = 'attendance' and p_action = 'add' and 'action:attendance_bulk_add' = any(lst) then return true; end if;
  if p_section = 'invoice_issuing' and p_action = 'add' and 'add:finance_invoices' = any(lst) then return true; end if;
  if parent is not null and ((p_action || ':' || parent) = any(lst) or parent = any(lst)) then return true; end if;
  return false;
end $$;

-- صلاحية المستخدم الحالي (موظف نظام معتمد) على (عمل، قسم)
create or replace function public.has_perm(p_action text, p_section text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare r text; m jsonb; lst text[];
begin
  select u.role into r from public.users u
   where u.id = auth.uid() and coalesce(u.status, 'active') not in ('pending_review', 'rejected');
  if r is null then return false; end if;
  if r = 'super_admin' then return true; end if;
  if r in ('company', 'employee') then return false; end if;      -- يحكمهما نطاق المرحلة 2
  if p_section = 'dashboard' then return true; end if;

  select to_jsonb(rp.menus) into m from public.role_permissions rp where rp.role = r limit 1;
  if m is null or jsonb_typeof(m) <> 'array' then return true; end if;   -- لا إعداد محفوظ = مسموح (كالواجهة)

  select coalesce(array_agg(x), '{}') into lst from jsonb_array_elements_text(m) as t(x);
  return public.perm_list_grants(lst, p_action, p_section);
end $$;

-- أي من القائمة (صيغة 'action:section')
create or replace function public.has_any_perm(pairs text[])
returns boolean language plpgsql stable security definer set search_path = public as $$
declare p text;
begin
  foreach p in array pairs loop
    if public.has_perm(split_part(p, ':', 1), split_part(p, ':', 2)) then return true; end if;
  end loop;
  return false;
end $$;

do $$
declare f text;
begin
  foreach f in array array['is_super_admin()','perm_list_grants(text[],text,text)','has_perm(text,text)','has_any_perm(text[])'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------- 2) مولّد السياسات ----------
-- p2b(table, command, pairs): غير موظفي النظام يمرّون (يحكمهم نطاق المرحلة 2)،
-- وموظف النظام يحتاج أحد الصلاحيات في pairs.
create or replace function public._p2b(t text, cmd text, pairs text[])
returns void language plpgsql as $$
declare pname text := 'p2b_' || t || '_' || lower(cmd);
        cond text := format('(not (select public.is_staff())) or (select public.has_any_perm(%L::text[]))', pairs);
begin
  if to_regclass('public.' || t) is null then raise notice 'تخطّي جدول غير موجود: %', t; return; end if;
  execute format('alter table public.%I enable row level security', t);
  execute format('drop policy if exists %I on public.%I', pname, t);
  execute format('create policy %I on public.%I as restrictive for %s to authenticated %s %s',
    pname, t, cmd,
    case when cmd in ('SELECT','UPDATE','DELETE') then 'using (' || cond || ')' else '' end,
    case when cmd in ('INSERT','UPDATE') then 'with check (' || cond || ')' else '' end);
end $$;

-- حاجز المدير العام فقط على جدول
create or replace function public._p2b_super(t text, cmd text)
returns void language plpgsql as $$
declare pname text := 'p2b_' || t || '_' || lower(cmd) || '_super';
begin
  execute format('drop policy if exists %I on public.%I', pname, t);
  execute format('create policy %I on public.%I as restrictive for %s to authenticated %s %s',
    pname, t, cmd,
    case when cmd in ('UPDATE','DELETE') then 'using ((select public.is_super_admin()))' else '' end,
    case when cmd in ('INSERT','UPDATE') then 'with check ((select public.is_super_admin()))' else '' end);
end $$;

-- ---------- 3) الكتابة: لكل جدول، كل (عمل:قسم) يستخدمه فعلاً ----------
select public._p2b('employees','INSERT', array['add:employees']);
select public._p2b('employees','UPDATE', array['edit:employees','delete:employees','edit:employee_links','add:employee_links','edit:end_employee_link','edit:employee_signup_requests']);
select public._p2b('employees','DELETE', array['delete:employees']);

select public._p2b('companies','INSERT', array['add:companies']);
select public._p2b('companies','UPDATE', array['edit:companies']);
select public._p2b('companies','DELETE', array['delete:companies']);

select public._p2b('employee_links','INSERT', array['add:employee_links','edit:end_employee_link']);
select public._p2b('employee_links','UPDATE', array['edit:employee_links','add:employee_links','edit:end_employee_link']);
select public._p2b('employee_links','DELETE', array['delete:employee_links','delete:end_employee_link','edit:end_employee_link']);

select public._p2b('employee_link_history','INSERT', array['edit:end_employee_link','delete:end_employee_link']);
select public._p2b('employee_link_history','UPDATE', array['edit:end_employee_link','delete:end_employee_link']);
select public._p2b('employee_link_history','DELETE', array['edit:end_employee_link','delete:end_employee_link']);

select public._p2b('employee_collections','INSERT', array['edit:finance_collections','edit:end_employee_link']);
select public._p2b('employee_collections','UPDATE', array['edit:finance_collections','edit:end_employee_link']);
select public._p2b('employee_collections','DELETE', array['edit:finance_collections','edit:end_employee_link','delete:end_employee_link']);

select public._p2b('employee_salaries','INSERT', array['add:salaries_import']);
select public._p2b('employee_salaries','UPDATE', array['add:salaries_import']);
select public._p2b('employee_salaries','DELETE', array['add:salaries_import']);

select public._p2b('invoices','INSERT', array['add:invoice_issuing']);
select public._p2b('invoices','UPDATE', array['edit:finance_invoices']);
select public._p2b('invoices','DELETE', array['delete:finance_invoices']);

select public._p2b('tasks','INSERT', array['add:tasks']);
select public._p2b('tasks','UPDATE', array['edit:tasks']);
select public._p2b('tasks','DELETE', array['delete:tasks']);

-- مستندات المهام وقوالبها: شاشاتها محروسة بصلاحية «عرض المهام» فقط في الواجهة
select public._p2b('task_documents','INSERT', array['view:tasks']);
select public._p2b('task_documents','UPDATE', array['view:tasks']);
select public._p2b('task_documents','DELETE', array['view:tasks']);
select public._p2b('job_task_templates','INSERT', array['view:tasks']);
select public._p2b('job_task_templates','UPDATE', array['view:tasks']);
select public._p2b('job_task_templates','DELETE', array['view:tasks']);

select public._p2b('attendance','INSERT', array['add:attendance']);
select public._p2b('attendance','UPDATE', array['edit:attendance']);
select public._p2b('attendance','DELETE', array['delete:attendance']);

select public._p2b('professions','INSERT', array['add:job_titles']);
select public._p2b('professions','UPDATE', array['edit:job_titles']);
select public._p2b('professions','DELETE', array['delete:job_titles']);

select public._p2b('collection_types','INSERT', array['add:collection_types']);
select public._p2b('collection_types','UPDATE', array['edit:collection_types']);
select public._p2b('collection_types','DELETE', array['delete:collection_types']);

select public._p2b('employee_blacklist','INSERT', array['add:blacklist','delete:employees']);
select public._p2b('employee_blacklist','UPDATE', array['edit:blacklist']);
select public._p2b('employee_blacklist','DELETE', array['delete:blacklist']);

select public._p2b('support_tickets','INSERT', array['add:support']);
select public._p2b('support_tickets','UPDATE', array['edit:support']);
select public._p2b('support_tickets','DELETE', array['delete:support']);

-- users: كتابة صف شخص آخر تتطلب أحد الأقسام التي تنشئ/تعدّل الحسابات (صفّك أنت دائماً مسموح)
-- صفّ المستخدم نفسه (الملف الشخصي، تغيير كلمة المرور، التسجيل الذاتي) يجب ألا يتأثر
drop policy if exists p2b_users_insert on public.users;
create policy p2b_users_insert on public.users as restrictive for insert to authenticated
  with check (id = auth.uid() or (not (select public.is_staff()))
              or (select public.has_any_perm(array['add:users','add:employees','add:companies'])));
drop policy if exists p2b_users_update on public.users;
create policy p2b_users_update on public.users as restrictive for update to authenticated
  using (id = auth.uid() or (not (select public.is_staff()))
         or (select public.has_any_perm(array['edit:users','edit:employees','edit:companies','edit:employee_signup_requests'])))
  with check (id = auth.uid() or (not (select public.is_staff()))
         or (select public.has_any_perm(array['edit:users','edit:employees','edit:companies','edit:employee_signup_requests'])));

-- ---------- 4) القراءة: الجداول التي لا تقرؤها لوحة التحكم ----------
select public._p2b('employee_blacklist','SELECT', array['view:blacklist','view:employees']);
select public._p2b('employee_salaries','SELECT', array['view:finance_collections','view:reports_collections','view:salaries_export','view:salaries_import']);
select public._p2b('employee_collections','SELECT', array['view:finance_collections','view:reports_collections','view:reports_company_links','view:end_employee_link']);
select public._p2b('invoices','SELECT', array['view:finance_invoices','add:invoice_issuing','view:attendance','view:tasks','view:reports_attendance','view:reports_tasks','view:reports_companies_collections']);
select public._p2b('support_tickets','SELECT', array['view:support']);
select public._p2b('job_task_templates','SELECT', array['view:tasks']);
select public._p2b('employee_signup_requests','SELECT', array['view:employee_signup_requests']);
select public._p2b('employee_signup_requests','UPDATE', array['edit:employee_signup_requests']);

-- ---------- 5) role_permissions: المدير العام وحده يعدّلها (كشاشة «الأدوار والصلاحيات») ----------
drop policy if exists role_permissions_admin_insert on public.role_permissions;
drop policy if exists role_permissions_admin_update on public.role_permissions;
drop policy if exists role_permissions_admin_delete on public.role_permissions;
drop policy if exists role_permissions_super_insert on public.role_permissions;
create policy role_permissions_super_insert on public.role_permissions for insert to authenticated
  with check ((select public.is_super_admin()));
drop policy if exists role_permissions_super_update on public.role_permissions;
create policy role_permissions_super_update on public.role_permissions for update to authenticated
  using ((select public.is_super_admin())) with check ((select public.is_super_admin()));
drop policy if exists role_permissions_super_delete on public.role_permissions;
create policy role_permissions_super_delete on public.role_permissions for delete to authenticated
  using ((select public.is_super_admin()));

-- حاجز مطلق (RESTRICTIVE) حتى لو بقيت أي سياسة قديمة تسمح للمسجّلين بالكتابة:
select public._p2b_super('role_permissions','INSERT');
select public._p2b_super('role_permissions','UPDATE');
select public._p2b_super('role_permissions','DELETE');

-- ---------- 6) منع ترقية النفس: الأدمن العادي لا يمنح ولا يعدّل دور super_admin ----------
create or replace function public.users_protect_super_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_super_admin() then
    if tg_op = 'INSERT' and new.role = 'super_admin' then
      raise exception 'غير مصرّح: إنشاء مدير عام للنظام يتطلب مديراً عاماً' using errcode = '42501';
    end if;
    if tg_op = 'DELETE' and old.role = 'super_admin' then
      raise exception 'غير مصرّح: حذف حساب المدير العام يتطلب مديراً عاماً' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and (new.role = 'super_admin' or old.role = 'super_admin')
       and (new.role is distinct from old.role or new.status is distinct from old.status
            or new.email is distinct from old.email) then
      raise exception 'غير مصرّح: تعديل حساب المدير العام يتطلب مديراً عاماً' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists trg_users_protect_super_admin on public.users;
create trigger trg_users_protect_super_admin before insert or update or delete on public.users
  for each row execute function public.users_protect_super_admin();

-- حذف الدوال المساعدة المؤقتة (لا تبقى في قاعدتك)
drop function if exists public._p2b(text,text,text[]);
drop function if exists public._p2b_super(text,text);

commit;
