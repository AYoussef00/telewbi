// =========================================================================
// 📅 InvoicePeriods — تحديد "الأشهر المغطّاة بفواتير مدفوعة" لمسؤول الشركة.
//
// جدول invoices لا يحتوي أعمدة فترة صريحة؛ الفترة محفوظة داخل وصف بنود الفاتورة
// بالشكل: "رسوم خدمة عمل عن بعد (DD/MM/YYYY - DD/MM/YYYY)". هذا الملف يستخرج
// تلك الفترة ويحوّلها إلى مجموعة أشهر "YYYY-MM" (من شهر البداية إلى شهر النهاية
// شاملاً). إن لم توجد فترة في أي بند، يُعتمد شهر تاريخ الفاتورة (invoice_date)
// كما كان سابقاً.
//
// مثال: فاتورة بتاريخ 2026-10-01 للفترة 01/09/2026 - 30/09/2026
//   ⇒ تفتح شهر 2026-09 فقط (وليس 2026-10).
// =========================================================================
(function () {
    const PERIOD_RE = /(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})\s*[-–—إلى]+\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})/g;

    function normalizeDigits(str) {
        // تحويل الأرقام العربية/الهندية إلى لاتينية قبل المطابقة
        return String(str || '').replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
                               .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0));
    }

    function parseItems(items) {
        if (Array.isArray(items)) return items;
        if (typeof items === 'string') {
            try { const parsed = JSON.parse(items); return Array.isArray(parsed) ? parsed : []; }
            catch (e) { return []; }
        }
        return [];
    }

    function monthsBetween(y1, m1, y2, m2) {
        const out = [];
        let y = y1, m = m1;
        let guard = 0;
        while ((y < y2 || (y === y2 && m <= m2)) && guard++ < 120) {
            out.push(`${y}-${String(m).padStart(2, '0')}`);
            m++; if (m > 12) { m = 1; y++; }
        }
        return out;
    }

    // يعيد مصفوفة أشهر "YYYY-MM" التي تغطيها فاتورة واحدة
    function getInvoiceMonths(invoice) {
        const months = new Set();
        parseItems(invoice && invoice.items).forEach(item => {
            const text = normalizeDigits(item && item.description);
            PERIOD_RE.lastIndex = 0;
            let m;
            while ((m = PERIOD_RE.exec(text)) !== null) {
                const [, , mo1, y1, , mo2, y2] = m;
                const a = [Number(y1), Number(mo1)], b = [Number(y2), Number(mo2)];
                if (mo1 < 1 || mo1 > 12 || mo2 < 1 || mo2 > 12) continue;
                monthsBetween(a[0], a[1], b[0], b[1]).forEach(k => months.add(k));
            }
        });
        if (months.size === 0 && invoice && invoice.invoice_date) {
            months.add(String(invoice.invoice_date).slice(0, 7));
        }
        return Array.from(months);
    }

    // rows: فواتير مدفوعة {invoice_date, company_id, items} ← Map(company_id ← Set('YYYY-MM'))
    function buildPaidMonthsMap(rows) {
        const map = new Map();
        (rows || []).forEach(row => {
            if (row.company_id == null) return;
            const key = String(row.company_id);
            getInvoiceMonths(row).forEach(month => {
                if (!map.has(key)) map.set(key, new Set());
                map.get(key).add(month);
            });
        });
        return map;
    }

    window.InvoicePeriods = { getInvoiceMonths, buildPaidMonthsMap };
})();
