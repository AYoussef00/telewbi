-- =========================================================================
-- 10_phase2_preflight.sql — فحص قبل المرحلة 2 (قراءة فقط)
-- =========================================================================

-- 1) الأعمدة التي تعتمد عليها السياسات: يجب أن يظهر كل صف present = true
select t.table_name, t.column_name,
       exists (select 1 from information_schema.columns c
               where c.table_schema = 'public' and c.table_name = t.table_name and c.column_name = t.column_name) as present
from (values
  ('companies','id'),('companies','user_id'),
  ('employees','id'),('employees','user_id'),
  ('employee_links','id'),('employee_links','employee_id'),('employee_links','company_id'),
  ('employee_link_history','employee_id'),('employee_link_history','company_id'),
  ('tasks','company_id'),('tasks','assigned_to'),
  ('attendance','employee_id'),
  ('invoices','company_id'),
  ('support_tickets','company_id'),('support_tickets','created_by'),
  ('employee_collections','employee_link_id'),
  ('employee_salaries','employee_link_id'),
  ('task_documents','task_id'),
  ('notification_preferences','user_id'),
  ('login_logs','user_id')
) as t(table_name, column_name)
order by present, 1, 2;

-- 2) جداول لم يغطّها السكربت (اطّلع عليها): كل جداول public وهل عليها سياسات
select c.relname as table_name,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by 1;

-- 3) مستخدمو الشركات بلا شركة، والموظفون بلا سجل موظف (سيرون بيانات فارغة بعد التطبيق)
select u.id, u.email, u.role, 'لا توجد شركة مرتبطة' as problem
from public.users u
where u.role = 'company' and not exists (select 1 from public.companies c where c.user_id = u.id)
union all
select u.id, u.email, u.role, 'لا يوجد سجل موظف مرتبط'
from public.users u
where u.role = 'employee' and not exists (select 1 from public.employees e where e.user_id = u.id);

-- 4) شركات مرتبطة بأكثر من حساب أو حسابات تملك أكثر من شركة (للعلم)
select user_id, count(*) as companies_count from public.companies
where user_id is not null group by user_id having count(*) > 1;
