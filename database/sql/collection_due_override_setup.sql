-- تعديل "المستحق" يدوياً لكل موظف عن شهر محدد (شاشة تحصيل الموظفين ← إجراء "تعديل المستحق").
-- القيمة الفارغة (NULL) = يُحسب المستحق تلقائياً كالمعتاد. نفِّذ هذا السكربت مرة واحدة في Supabase SQL Editor.
alter table public.employee_collections
    add column if not exists due_override numeric;
