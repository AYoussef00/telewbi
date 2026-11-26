-- =========================================================================
-- 00_preflight.sql — فحص قبل التنفيذ (قراءة فقط، لا يغيّر شيئاً)
-- شغّله في Supabase SQL Editor قبل 01_phase1_hardening.sql وراجع النتائج.
-- =========================================================================

-- 1) الأدوار الموجودة فعلاً بين المستخدمين.
--    المتوقع: super_admin, admin, company, employee فقط.
--    لو ظهر دور آخر (مثل accountant) وكان يدير المستخدمين/الصلاحيات، اقرأ ملاحظة
--    "الأدوار المخصّصة" في README.md قبل المتابعة.
select role, status, count(*) as users_count
from public.users
group by role, status
order by role, status;

-- 2) مستخدمون بلا صف في users (حسابات Auth بلا ملف): سيُحجَبون بعد التطبيق
select a.id, a.email, a.created_at
from auth.users a
left join public.users u on u.id = a.id
where u.id is null;

-- 3) مستخدمون حالتهم pending_review/rejected حالياً (سيُحجَبون عن الجداول حتى تتم الموافقة)
select id, name, email, role, status from public.users
where status in ('pending_review', 'rejected');

-- 4) الـ trigger الحالي الذي ينشئ المستخدمين (للمقارنة بعد التطبيق)
select tgname, tgrelid::regclass as on_table, pg_get_triggerdef(oid) as definition
from pg_trigger
where not tgisinternal and tgrelid in ('auth.users'::regclass, 'public.users'::regclass);

-- 5) تأكد من وجود الجداول التي يمسّها السكربت (كل صف يجب أن يظهر)
select t as table_name, to_regclass('public.' || t) is not null as exists_
from unnest(array[
  'users','employees','companies','employee_links','professions','attendance',
  'role_permissions','collection_types','employee_blacklist','employee_collections',
  'employee_link_history','employee_salaries','invoices','job_task_templates',
  'notification_preferences','support_tickets','tasks'
]) as t;
