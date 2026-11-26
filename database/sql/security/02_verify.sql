-- =========================================================================
-- 02_verify.sql — فحص بعد التنفيذ (قراءة فقط)
-- =========================================================================

-- 1) لا يجب أن تبقى أي سياسة للمجهول (public/anon) إلا app_settings و report_snapshots
--    المتوقع: صفّان فقط (أو بعض الجداول المستثناة عمداً).
select tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public' and (roles && array['public','anon']::name[])
order by tablename, policyname;

-- 2) سياسات التخزين التي تخص المجهول أو public (تُراجَع يدوياً)
select policyname, cmd, roles, permissive
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
order by permissive desc, policyname;

-- 3) الحاويتان يجب أن تكونا public = false
select id, public from storage.buckets order by id;

-- 4) كل جداول public التي RLS فيها غير مفعّل (المتوقع: لا شيء)
select c.relname as table_without_rls
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

-- 5) بوابات الموافقة المفعّلة
select tablename, policyname, cmd from pg_policies
where schemaname = 'public' and permissive = 'RESTRICTIVE' order by 1, 2;

-- 6) تعريف handle_new_user الجديد: يجب أن يحتوي 'employee' و 'pending_review' ثابتتين
select pg_get_functiondef('public.handle_new_user'::regproc);

-- 7) أمثلة المستخدمين الحاليين وأدوارهم (للتأكد أن أحداً لم يتأثر)
select role, status, count(*) from public.users group by 1, 2 order by 1, 2;
