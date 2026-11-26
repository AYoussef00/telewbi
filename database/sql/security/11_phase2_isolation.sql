-- =========================================================================
-- 11_phase2_isolation.sql — المرحلة 2: عزل البيانات حسب الدور داخل قاعدة البيانات
--
-- قبل هذا السكربت كان أي مستخدم مسجّل (شركة أو موظف) يستطيع، عبر المفتاح العام، قراءة
-- وتعديل بيانات كل الشركات والموظفين؛ التقييد كان في واجهة التطبيق فقط.
-- بعده تُفرض نفس قواعد التطبيق في قاعدة البيانات:
--   • موظفو النظام (أي دور غير الشركة والموظف): كما هم، بلا تغيير.
--   • مسؤول الشركة: شركاته فقط، وموظفو شركاته (الربط الحالي + الأرشيف)، ومهامها وفواتيرها وحضورها.
--   • الموظف: سجله ومهامه وحضوره وروابطه وتحصيله وشركاته المرتبطة فقط.
--
-- الآلية: سياسات RESTRICTIVE (تُدمج بـ AND مع أي سياسة قائمة)، فلا حاجة لحذف سياساتك
-- الحالية ولا لمعرفة أسمائها. إعادة التشغيل آمنة. للتراجع: 19_rollback_phase2.sql
-- المتطلب: تنفيذ المرحلة 1 أولاً (دوال is_staff / is_approved).
-- =========================================================================
begin;

-- ---------- 0) فحص الأعمدة المطلوبة: يوقف التنفيذ برسالة واضحة قبل أي تغيير ----------
do $$
declare missing text;
begin
  select string_agg(t.tbl || '.' || t.col, ', ') into missing
  from (values
    ('companies','id'),('companies','user_id'),('employees','id'),('employees','user_id'),
    ('employee_links','id'),('employee_links','employee_id'),('employee_links','company_id'),
    ('employee_link_history','employee_id'),('employee_link_history','company_id'),
    ('tasks','company_id'),('tasks','assigned_to'),('attendance','employee_id'),
    ('invoices','company_id'),('support_tickets','company_id'),('support_tickets','created_by'),
    ('employee_collections','employee_link_id'),('employee_salaries','employee_link_id'),
    ('task_documents','task_id'),('notification_preferences','user_id'),('login_logs','user_id')
  ) as t(tbl, col)
  where not exists (select 1 from information_schema.columns c
                    where c.table_schema = 'public' and c.table_name = t.tbl and c.column_name = t.col)
    and to_regclass('public.' || t.tbl) is not null;
  if missing is not null then
    raise exception 'أعمدة مفقودة، شغّل 10_phase2_preflight.sql وأخبرني بالنتيجة: %', missing;
  end if;
end $$;

-- ---------- 1) دوال النطاق (SECURITY DEFINER حتى لا تتأثر بالسياسات ولا تتكرر لانهائياً) ----------
create or replace function public.my_employee_id()
returns bigint language sql stable security definer set search_path = public as $$
  select e.id::bigint from public.employees e where e.user_id = auth.uid() order by e.id limit 1;
$$;

create or replace function public.my_company_ids()
returns setof bigint language sql stable security definer set search_path = public as $$
  select c.id::bigint from public.companies c where c.user_id = auth.uid();
$$;

-- موظفو شركات المستخدم: الربط الحالي + أرشيف الروابط المنتهية
create or replace function public.my_company_employee_ids()
returns setof bigint language sql stable security definer set search_path = public as $$
  select l.employee_id::bigint from public.employee_links l
   where l.company_id in (select public.my_company_ids()) and l.employee_id is not null
  union
  select h.employee_id::bigint from public.employee_link_history h
   where h.company_id in (select public.my_company_ids()) and h.employee_id is not null;
$$;

-- روابط (employee_links.id) شركات المستخدم، وروابط الموظف نفسه
create or replace function public.my_company_link_ids()
returns setof bigint language sql stable security definer set search_path = public as $$
  select l.id::bigint from public.employee_links l where l.company_id in (select public.my_company_ids());
$$;
create or replace function public.my_employee_link_ids()
returns setof bigint language sql stable security definer set search_path = public as $$
  select l.id::bigint from public.employee_links l where l.employee_id = public.my_employee_id();
$$;

-- الشركات المرتبط بها الموظف (حالياً أو سابقاً)
create or replace function public.my_linked_company_ids()
returns setof bigint language sql stable security definer set search_path = public as $$
  select l.company_id::bigint from public.employee_links l
   where l.employee_id = public.my_employee_id() and l.company_id is not null
  union
  select h.company_id::bigint from public.employee_link_history h
   where h.employee_id = public.my_employee_id() and h.company_id is not null;
$$;

-- حسابات (users.id) موظفي شركات المستخدم: لعرض دور/اسم الموظف بشاشات الشركة
create or replace function public.my_company_employee_user_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select e.user_id from public.employees e
   where e.user_id is not null and e.id in (select public.my_company_employee_ids());
$$;

do $$
declare f text;
begin
  foreach f in array array['my_company_employee_user_ids','my_employee_id','my_company_ids','my_company_employee_ids','my_company_link_ids',
                           'my_employee_link_ids','my_linked_company_ids'] loop
    execute format('revoke all on function public.%I() from public, anon', f);
    execute format('grant execute on function public.%I() to authenticated', f);
  end loop;
end $$;

-- ---------- 2) مولّد السياسات: p2(table, command, using_expr, check_expr) ----------
create or replace function public._p2(t text, cmd text, using_e text, check_e text default null)
returns void language plpgsql as $$
declare pname text := 'p2_' || t || '_' || lower(cmd);
begin
  if to_regclass('public.' || t) is null then
    raise notice 'تخطّي جدول غير موجود: %', t;
    return;
  end if;
  execute format('alter table public.%I enable row level security', t);
  execute format('drop policy if exists %I on public.%I', pname, t);
  execute format(
    'create policy %I on public.%I as restrictive for %s to authenticated %s %s',
    pname, t, cmd,
    case when cmd in ('SELECT','UPDATE','DELETE') then 'using (' || using_e || ')' else '' end,
    case when cmd in ('INSERT','UPDATE') then 'with check (' || coalesce(check_e, using_e) || ')' else '' end);
end $$;

-- اختصارات نصية للشروط
-- S = موظف نظام معتمد
-- ---------- 3) users: الشركة والموظف يريان صفّهما، والشركة أيضاً حسابات موظفي شركاتها ----------
drop policy if exists users_select on public.users;
create policy users_select on public.users for select to authenticated
  using (id = auth.uid()
         or (select public.is_staff())
         or id in (select public.my_company_employee_user_ids()));

-- ---------- 4) companies ----------
select public._p2('companies','SELECT',
  '(select public.is_staff()) or user_id = auth.uid() or id in (select public.my_linked_company_ids())');
select public._p2('companies','INSERT', '(select public.is_staff())');
select public._p2('companies','UPDATE', '(select public.is_staff())');
select public._p2('companies','DELETE', '(select public.is_staff())');

-- ---------- 5) employees ----------
select public._p2('employees','SELECT',
  '(select public.is_staff()) or user_id = auth.uid() or id in (select public.my_company_employee_ids())');
-- الإدخال: موظف نظام، أو تسجيل ذاتي لسجلّه هو (المتطلب الذي يستخدمه register-employee)
select public._p2('employees','INSERT', '(select public.is_staff()) or user_id = auth.uid()');
select public._p2('employees','UPDATE',
  '(select public.is_staff()) or user_id = auth.uid() or id in (select public.my_company_employee_ids())');
select public._p2('employees','DELETE', '(select public.is_staff())');

-- منع غير موظفي النظام من نقل سجل موظف لحساب آخر (user_id) أو تغيير معرّفه
create or replace function public.employees_protect_user_link()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_staff() then
    if new.id is distinct from old.id or new.user_id is distinct from old.user_id then
      raise exception 'غير مصرّح: لا يمكن تغيير ربط سجل الموظف بالحساب' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_employees_protect_user_link on public.employees;
create trigger trg_employees_protect_user_link before update on public.employees
  for each row execute function public.employees_protect_user_link();

-- ---------- 6) الروابط وأرشيفها (القراءة بالنطاق، الكتابة لموظفي النظام فقط) ----------
select public._p2('employee_links','SELECT',
  '(select public.is_staff()) or company_id in (select public.my_company_ids()) or employee_id = (select public.my_employee_id())');
select public._p2('employee_links','INSERT', '(select public.is_staff())');
select public._p2('employee_links','UPDATE', '(select public.is_staff())');
select public._p2('employee_links','DELETE', '(select public.is_staff())');

select public._p2('employee_link_history','SELECT',
  '(select public.is_staff()) or company_id in (select public.my_company_ids()) or employee_id = (select public.my_employee_id())');
select public._p2('employee_link_history','INSERT', '(select public.is_staff())');
select public._p2('employee_link_history','UPDATE', '(select public.is_staff())');
select public._p2('employee_link_history','DELETE', '(select public.is_staff())');

-- ---------- 7) المهام: الشركة مهام شركتها، الموظف المسندة إليه (قراءة وتحديث فقط) ----------
select public._p2('tasks','SELECT',
  '(select public.is_staff()) or company_id in (select public.my_company_ids()) or assigned_to = (select public.my_employee_id())');
select public._p2('tasks','INSERT',
  '(select public.is_staff()) or company_id in (select public.my_company_ids())');
select public._p2('tasks','UPDATE',
  '(select public.is_staff()) or company_id in (select public.my_company_ids()) or assigned_to = (select public.my_employee_id())',
  '(select public.is_staff()) or company_id in (select public.my_company_ids()) or assigned_to = (select public.my_employee_id())');
select public._p2('tasks','DELETE',
  '(select public.is_staff()) or company_id in (select public.my_company_ids())');

-- مستندات المهام: تتبع نطاق المهمة نفسها (الاستعلام الفرعي يمر عبر سياسات tasks أعلاه)
select public._p2('task_documents','SELECT',
  '(select public.is_staff()) or exists (select 1 from public.tasks t where t.id = task_id)');
select public._p2('task_documents','INSERT',
  '(select public.is_staff()) or exists (select 1 from public.tasks t where t.id = task_id)');
select public._p2('task_documents','UPDATE',
  '(select public.is_staff()) or exists (select 1 from public.tasks t where t.id = task_id)');
select public._p2('task_documents','DELETE',
  '(select public.is_staff()) or exists (select 1 from public.tasks t where t.id = task_id)');

-- ---------- 8) الحضور: الشركة لموظفيها (قراءة وكتابة)، الموظف لنفسه (قراءة فقط) ----------
select public._p2('attendance','SELECT',
  '(select public.is_staff()) or employee_id in (select public.my_company_employee_ids()) or employee_id = (select public.my_employee_id())');
select public._p2('attendance','INSERT',
  '(select public.is_staff()) or employee_id in (select public.my_company_employee_ids())');
select public._p2('attendance','UPDATE',
  '(select public.is_staff()) or employee_id in (select public.my_company_employee_ids())');
select public._p2('attendance','DELETE',
  '(select public.is_staff()) or employee_id in (select public.my_company_employee_ids())');

-- ---------- 9) الفواتير: الشركة تقرأ فواتيرها فقط، الكتابة لموظفي النظام ----------
select public._p2('invoices','SELECT', '(select public.is_staff()) or company_id in (select public.my_company_ids())');
select public._p2('invoices','INSERT', '(select public.is_staff())');
select public._p2('invoices','UPDATE', '(select public.is_staff())');
select public._p2('invoices','DELETE', '(select public.is_staff())');

-- ---------- 10) التحصيل والرواتب: القراءة حسب الروابط، الكتابة لموظفي النظام ----------
select public._p2('employee_collections','SELECT',
  '(select public.is_staff()) or employee_link_id in (select public.my_company_link_ids()) or employee_link_id in (select public.my_employee_link_ids())');
select public._p2('employee_collections','INSERT', '(select public.is_staff())');
select public._p2('employee_collections','UPDATE', '(select public.is_staff())');
select public._p2('employee_collections','DELETE', '(select public.is_staff())');

select public._p2('employee_salaries','SELECT',
  '(select public.is_staff()) or employee_link_id in (select public.my_company_link_ids()) or employee_link_id in (select public.my_employee_link_ids())');
select public._p2('employee_salaries','INSERT', '(select public.is_staff())');
select public._p2('employee_salaries','UPDATE', '(select public.is_staff())');
select public._p2('employee_salaries','DELETE', '(select public.is_staff())');

-- ---------- 11) الدعم الفني ----------
select public._p2('support_tickets','SELECT',
  '(select public.is_staff()) or created_by = auth.uid() or company_id in (select public.my_company_ids())');
select public._p2('support_tickets','INSERT', '(select public.is_staff()) or created_by = auth.uid()');
select public._p2('support_tickets','UPDATE', '(select public.is_staff()) or created_by = auth.uid()');
select public._p2('support_tickets','DELETE', '(select public.is_staff()) or created_by = auth.uid()');

-- ---------- 12) جداول إدارية: لا وصول لغير موظفي النظام ----------
select public._p2('employee_blacklist','SELECT', '(select public.is_staff())');
select public._p2('employee_blacklist','INSERT', '(select public.is_staff())');
select public._p2('employee_blacklist','UPDATE', '(select public.is_staff())');
select public._p2('employee_blacklist','DELETE', '(select public.is_staff())');

-- مرجعية: قراءة للجميع (تحتاجها الواجهات)، كتابة لموظفي النظام فقط
select public._p2('professions','INSERT', '(select public.is_staff())');
select public._p2('professions','UPDATE', '(select public.is_staff())');
select public._p2('professions','DELETE', '(select public.is_staff())');
select public._p2('collection_types','INSERT', '(select public.is_staff())');
select public._p2('collection_types','UPDATE', '(select public.is_staff())');
select public._p2('collection_types','DELETE', '(select public.is_staff())');
select public._p2('facility_documents','INSERT', '(select public.is_staff())');
select public._p2('facility_documents','UPDATE', '(select public.is_staff())');
select public._p2('facility_documents','DELETE', '(select public.is_staff())');
select public._p2('job_task_templates','INSERT', '(select public.is_staff())');
select public._p2('job_task_templates','UPDATE', '(select public.is_staff())');
select public._p2('job_task_templates','DELETE', '(select public.is_staff())');

-- ---------- 13) بيانات المستخدم الشخصية ----------
select public._p2('notification_preferences','SELECT', 'user_id = auth.uid()');
select public._p2('notification_preferences','INSERT', 'user_id = auth.uid()');
select public._p2('notification_preferences','UPDATE', 'user_id = auth.uid()');
select public._p2('notification_preferences','DELETE', 'user_id = auth.uid()');

select public._p2('login_logs','SELECT', 'user_id = auth.uid() or (select public.is_staff())');
select public._p2('login_logs','INSERT', 'user_id = auth.uid()');

-- حذف الدوال المساعدة المؤقتة (لا تبقى في قاعدتك)
drop function if exists public._p2(text,text,text,text);

commit;
