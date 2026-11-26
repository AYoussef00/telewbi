// =========================================================================
// 👁️ CompanyTaskVisibility — قاعدة رؤية المهام لمسؤول الشركة.
//
// • مهام أي شهر فاتورته "مدفوعة" تظهر كاملة.
// • أي شهر لم تُسدَّد فاتورته (أو لم تُصدَر له فاتورة أصلاً): لا تظهر مهامه،
//   عدا كل المهام التي أُضيفت خلال آخر 7 أيام (بحسب created_at، اليوم + 6 أيام
//   قبله) فتظهر كمعاينة — أي شهر استحقاقها، وتشمل المهام بلا تاريخ استحقاق.
//
// يعتمد على InvoicePeriods (invoice-periods.js) — حمِّله قبل هذا الملف.
// =========================================================================
(function () {
    const PREVIEW_DAYS = 7;
    const PAGE = 1000;

    // الأشهر المفتوحة (فواتير مدفوعة) لكل شركة: Map(companyId نصاً → Set('YYYY-MM'))
    async function loadPaidMonthsMap(companyIds) {
        if (!companyIds || companyIds.length === 0) return new Map();
        let all = [];
        let from = 0;
        while (true) {
            const { data, error } = await dbClient.from('invoices')
                .select('invoice_date, company_id, items')
                .eq('status', 'paid')
                .in('company_id', companyIds)
                .range(from, from + PAGE - 1);
            if (error) throw error;
            all = all.concat(data || []);
            if (!data || data.length < PAGE) break;
            from += PAGE;
        }
        return window.InvoicePeriods.buildPaidMonthsMap(all);
    }

    function currentMonthKey() {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    function isMonthPaid(paidMonthsMap, companyId, monthKey) {
        const set = paidMonthsMap.get(String(companyId));
        return !!(set && set.has(monthKey));
    }

    function isTaskInPaidMonth(paidMonthsMap, task) {
        if (!task || !task.due_date || task.company_id == null) return false;
        return isMonthPaid(paidMonthsMap, task.company_id, String(task.due_date).slice(0, 7));
    }

    function newestFirst(a, b) {
        const c = String(b.created_at || '').localeCompare(String(a.created_at || ''));
        return c !== 0 ? c : (Number(b.id) || 0) - (Number(a.id) || 0);
    }

    // بداية أول يوم ضمن آخر 7 أيام (اليوم + 6 أيام قبله) — لمقارنة tasks.created_at
    function recentCutoffDate() {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() - (PREVIEW_DAYS - 1));
        return d;
    }
    function recentCutoffISO() { return recentCutoffDate().toISOString(); }

    function isTaskRecent(task) {
        if (!task || !task.created_at) return false;
        const t = new Date(task.created_at).getTime();
        return !isNaN(t) && t >= recentCutoffDate().getTime();
    }

    // يقسم المهام إلى: visible (أشهر مدفوعة) و preview (مهام آخر 7 أيام غير المفتوحة بالسداد)
    function partitionTasks(tasks, paidMonthsMap) {
        const visible = [];
        const preview = [];
        (tasks || []).forEach(task => {
            if (isTaskInPaidMonth(paidMonthsMap, task)) { visible.push(task); return; }
            if (isTaskRecent(task)) preview.push(Object.assign({}, task, { is_unpaid_preview: true }));
        });
        return { visible, preview };
    }

    window.CompanyTaskVisibility = { PREVIEW_DAYS, loadPaidMonthsMap, currentMonthKey, isMonthPaid, isTaskInPaidMonth, isTaskRecent, recentCutoffISO, partitionTasks, newestFirst };
})();
