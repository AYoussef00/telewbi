-- =============================================================================
-- ميزة "حالة إجراءات إنهاء الربط" (مكتمل / غير مكتمل + السبب) على أرشيف
-- "الموظفين الذين تم إنهاء ربطهم" (جدول employee_link_history)
-- =============================================================================
-- نفّذ هذا السكربت كاملاً مرة واحدة من لوحة تحكم Supabase:
--   SQL Editor → New Query → الصق هذا الملف بالكامل → Run
-- آمن لإعادة التنفيذ أكثر من مرة (idempotent).
--
-- التغييرات:
--   1) procedure_status: 'complete' (مكتمل — يظهر بنقطة خضراء) أو
--      'incomplete' (غير مكتمل — يظهر بنقطة صفراء). السجلات القديمة الموجودة
--      مسبقاً تُعتبر "مكتمل" افتراضياً (يمكنك تغيير أي منها لاحقاً من الشاشة).
--   2) procedure_incomplete_reason: سبب عدم اكتمال الإجراءات (إلزامي عند
--      الحالة 'incomplete'، ويُفرَّغ تلقائياً من الشاشة عند التحويل إلى مكتمل).
--   3) procedure_updated_at: وقت آخر تغيير لحالة الإجراءات.
--   4) سياسة تعديل (UPDATE) على الجدول لتمكين تغيير الحالة لاحقاً من الشاشة.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) الأعمدة الجديدة
-- -----------------------------------------------------------------------------
alter table public.employee_link_history
    add column if not exists procedure_status text not null default 'complete';

alter table public.employee_link_history
    add column if not exists procedure_incomplete_reason text;

alter table public.employee_link_history
    add column if not exists procedure_updated_at timestamptz;

-- قيد القيم المسموحة للحالة
alter table public.employee_link_history
    drop constraint if exists employee_link_history_procedure_status_check;
alter table public.employee_link_history
    add constraint employee_link_history_procedure_status_check
    check (procedure_status in ('complete', 'incomplete'));

-- قيد: الحالة "غير مكتمل" تتطلب سبباً غير فارغ
alter table public.employee_link_history
    drop constraint if exists employee_link_history_procedure_reason_check;
alter table public.employee_link_history
    add constraint employee_link_history_procedure_reason_check
    check (
        procedure_status = 'complete'
        or length(btrim(coalesce(procedure_incomplete_reason, ''))) > 0
    );

-- -----------------------------------------------------------------------------
-- 2) سياسة التعديل (RLS UPDATE) — لازمة لتغيير الحالة لاحقاً من الشاشة.
--    نفس نهج بقية جداول المشروع (صلاحية كاملة للمستخدم الموثّق؛ وتبقى
--    صلاحية "تعديل إنهاء ربط موظف" في شاشة الأدوار هي التي تتحكم بظهور الزر).
-- -----------------------------------------------------------------------------
alter table public.employee_link_history enable row level security;

drop policy if exists "employee_link_history_authenticated_update" on public.employee_link_history;
create policy "employee_link_history_authenticated_update"
    on public.employee_link_history for update
    to authenticated
    using (true) with check (true);

-- -----------------------------------------------------------------------------
-- تم ✅
-- -----------------------------------------------------------------------------
