/* =========================================================================
 * company-finance.js — حساب مسترد الشركة والعمولة وصافي الدخل (مصدر واحد مشترك)
 *
 * المسترد والعمولة وصافي الدخل لكل منها قيمة + نوع: 'fixed' (مبلغ ثابت) أو 'percent'
 * (نسبة % من "الصافي" المسجَّل في ربط كل موظف). المعادلة لكل ربط:
 *     صافي الدخل = الصافي (من بيانات الربط) − المسترد − العمولة
 * وللشركة طريقتان (income_mode):
 *   refund_input (الافتراضي): يُدخَل المسترد ويُحسب صافي الدخل بالمعادلة أعلاه.
 *   income_input            : يُدخَل صافي الدخل ويُحسب المسترد = الصافي − صافي الدخل − العمولة.
 * النسبة تُطبَّق على صافي كل ربط على حدة، والمبلغ الثابت يُخصم كما هو من كل ربط.
 * ========================================================================= */
(function () {
    function num(v) {
        const n = parseFloat(v);
        return isNaN(n) ? null : n;
    }
    function round2(n) { return Math.round(n * 100) / 100; }

    // مبلغ الخصم الفعلي لربط واحد؛ null إن تعذّر حسابه (نسبة بدون صافي)
    function amountFor(net, value, type) {
        const v = num(value) || 0;
        if (type === 'percent') {
            return net === null ? null : round2(net * v / 100);
        }
        return round2(v);
    }

    // company: { company_refund, company_refund_type, company_commission, company_commission_type }
    function compute(netValue, company) {
        const net = num(netValue);
        const c = company || {};
        const commission = amountFor(net, c.company_commission, c.company_commission_type);
        if (c.income_mode === 'income_input') {
            const income = amountFor(net, c.company_net_income, c.company_net_income_type);
            const refund = (net === null || income === null || commission === null)
                ? null
                : round2(net - income - commission);
            return { net, refund, commission, income };
        }
        const refund = amountFor(net, c.company_refund, c.company_refund_type);
        const income = (net === null || refund === null || commission === null)
            ? null
            : round2(net - refund - commission);
        return { net, refund, commission, income };
    }

    function formatMoney(n, emptyText) {
        if (n === null || n === undefined || isNaN(n)) return emptyText;
        return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
    }

    // وصف القيمة المحفوظة على الشركة: "10%" أو "5.00"
    function describe(value, type) {
        const v = num(value) || 0;
        return type === 'percent'
            ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(v) + '%'
            : formatMoney(v, '0.00');
    }

    window.CompanyFinance = { amountFor, compute, formatMoney, describe };
})();