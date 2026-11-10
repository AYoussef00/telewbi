// =========================================================================
// 💵 EmployeeSalaries — الرواتب الشهرية المستوردة (جدول employee_salaries)
// المستخدمة لعمود "الرصيد" بشاشة "تحصيل الموظفين" وتقريرها.
//
// الرصيد لموظف/شهر = الراتب المستورد لذلك الشهر إن وُجد، وإلا الراتب الأساسي
// المسجَّل بالربط (employee_links.basic_salary_value).
//
// ⚠️ لو لم يُنفَّذ سكربت قاعدة البيانات بعد (employee_salaries_setup.sql) لا تنكسر
// الشاشة: تُعاد خريطة فارغة فيُعرض الراتب الأساسي لكل الموظفين.
// =========================================================================
(function () {
    const PAGE = 1000;

    // monthDateStr: "YYYY-MM-01" ← Map(String(employee_link_id) ← number)
    async function fetchImportedMap(monthDateStr) {
        const map = new Map();
        try {
            for (let from = 0; ; from += PAGE) {
                const { data, error } = await dbClient.from('employee_salaries')
                    .select('employee_link_id, salary_amount')
                    .eq('salary_month', monthDateStr)
                    .order('id', { ascending: true })
                    .range(from, from + PAGE - 1);
                if (error) throw error;
                (data || []).forEach(r => map.set(String(r.employee_link_id), parseFloat(r.salary_amount) || 0));
                if (!data || data.length < PAGE) break;
            }
        } catch (error) {
            console.warn('تعذّر جلب الرواتب المستوردة (هل نُفِّذ employee_salaries_setup.sql؟):', error.message);
        }
        return map;
    }

    function resolveBalance(importedMap, linkId, basicSalaryValue) {
        const key = String(linkId);
        if (importedMap && importedMap.has(key)) return importedMap.get(key);
        const basic = parseFloat(basicSalaryValue);
        return isNaN(basic) ? 0 : basic;
    }

    // ------------------------------------------------------------------
    // أدوات مشتركة لصفحتي "تصدير الرواتب" و"استيراد الرواتب"
    // ------------------------------------------------------------------
    async function fetchAllPages(buildQuery) {
        const all = [];
        for (let from = 0; ; from += PAGE) {
            const { data, error } = await buildQuery(from, from + PAGE - 1);
            if (error) throw new Error(error.message);
            all.push(...(data || []));
            if (!data || data.length < PAGE) break;
        }
        return all;
    }

    async function fetchCompanies() {
        return fetchAllPages((from, to) => dbClient.from('companies')
            .select('id, name').order('name', { ascending: true }).order('id', { ascending: true }).range(from, to));
    }

    function dateOnly(value) { return value ? String(value).split('T')[0] : ''; }

    // روابط "اضافة" للشركة التي تتقاطع مع الشهر المختار (YYYY-MM) — نفس مجموعة موظفي شاشة التحصيل
    //
    // 🗃️ includeArchived=true (لتصدير الرواتب): يضيف أيضاً موظفي الشركة الذين أُنهي ربطهم
    // خلال الشهر ولا يوجد لهم سجل بجدول employee_links (روابط أُنهيت قديماً بالحذف وبقي
    // لها سجل بأرشيف employee_link_history فقط). هؤلاء بلا id ربط (id=null) و archived=true؛
    // أما من أُنهي ربطه وبقي سجل ربطه (link_end_date داخل الشهر) فيأتي من الجدول الأصلي دائماً.
    async function fetchCompanyLinksForMonth(companyId, monthValue, options) {
        const includeArchived = !!(options && options.includeArchived);
        const [y, m] = monthValue.split('-').map(Number);
        const monthStart = `${monthValue}-01`;
        const lastDay = new Date(y, m, 0).getDate();
        const monthEnd = `${monthValue}-${String(lastDay).padStart(2, '0')}`;
        const links = await fetchAllPages((from, to) => dbClient.from('employee_links')
            .select('id, employee_id, link_date, link_end_date, employees(name, national_id)')
            .eq('company_id', companyId)
            .eq('link_type', 'اضافة')
            .order('id', { ascending: true })
            .range(from, to));
        const inMonth = links.filter(l => {
            const start = dateOnly(l.link_date);
            const end = dateOnly(l.link_end_date);
            if (start && start > monthEnd) return false;
            if (end && end < monthStart) return false;
            return true;
        });
        if (!includeArchived) return inMonth;

        try {
            const history = await fetchAllPages((from, to) => dbClient.from('employee_link_history')
                .select('employee_id, employee_name, national_id, start_date, end_date, link_type')
                .eq('company_id', companyId)
                .order('id', { ascending: true })
                .range(from, to));
            // موظف له ربط (أي ربط بالشركة) بالجدول الأصلي لا يُكرَّر من الأرشيف
            const knownEmployeeIds = new Set(links.map(l => String(l.employee_id)));
            const knownNationalIds = new Set(links.map(l => normalizeNationalId(l.employees && l.employees.national_id)).filter(Boolean));
            const seen = new Set();
            history.forEach(h => {
                if (h.link_type && h.link_type !== 'اضافة') return;
                const start = dateOnly(h.start_date);
                const end = dateOnly(h.end_date);
                if (start && start > monthEnd) return;
                if (end && end < monthStart) return;
                const nid = normalizeNationalId(h.national_id);
                const dedupeKey = nid || `e${h.employee_id}`;
                if (knownEmployeeIds.has(String(h.employee_id)) || (nid && knownNationalIds.has(nid)) || seen.has(dedupeKey)) return;
                seen.add(dedupeKey);
                inMonth.push({
                    id: null, archived: true, employee_id: h.employee_id,
                    link_date: h.start_date, link_end_date: h.end_date,
                    employees: { name: h.employee_name, national_id: h.national_id }
                });
            });
        } catch (error) {
            console.warn('تعذّر جلب أرشيف الروابط المنتهية لتصدير الرواتب:', error.message);
        }
        return inMonth;
    }

    // توحيد رقم الهوية: أرقام لاتينية فقط وبلا مسافات
    function normalizeNationalId(value) {
        return String(value == null ? '' : value)
            .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
            .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0))
            .replace(/\s+/g, '').trim();
    }

    // يعيد { empty:true } لخلية فارغة، { invalid:true } لنص غير رقمي، وإلا { value:number }
    function parseSalaryCell(raw) {
        if (raw === null || raw === undefined || String(raw).trim() === '') return { empty: true };
        if (typeof raw === 'number') return isFinite(raw) && raw >= 0 ? { value: Math.round(raw * 100) / 100 } : { invalid: true };
        const cleaned = String(raw)
            .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
            .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0))
            .replace(/[٫]/g, '.').replace(/[,٬،\s]/g, '');
        if (!/^\d+(\.\d+)?$/.test(cleaned)) return { invalid: true };
        return { value: Math.round(parseFloat(cleaned) * 100) / 100 };
    }

    function formatDateDMY(value) {
        const d = dateOnly(value);
        if (!d) return '';
        const [y, m, day] = d.split('-');
        return `${day}/${m}/${y}`;
    }

    function currentMonthValue() {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    // توحيد النص العربي للبحث: يتجاهل أ/إ/آ/ا و ة/ه و ى/ي والتشكيل والتطويل
    function normalizeSearchText(value) {
        return String(value == null ? '' : value)
            .toLowerCase()
            .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
            .replace(/[أإآٱ]/g, 'ا')
            .replace(/ى/g, 'ي')
            .replace(/ة/g, 'ه')
            .replace(/\s+/g, ' ')
            .trim();
    }

    // قائمة شركات قابلة للبحث بالكتابة (بدل <select>): حقل نص + حقل مخفي يحمل معرّف الشركة
    // options: [{ value, label }]؛ onChange(value) عند تغيّر الاختيار
    function createSearchableCombobox({ inputId, hiddenId, dropdownId, emptyText, onChange }) {
        const input = document.getElementById(inputId);
        const hidden = document.getElementById(hiddenId);
        const dropdown = document.getElementById(dropdownId);
        let options = [];
        let activeIndex = -1;
        let visible = [];

        const selectedLabel = () => {
            const m = options.find(o => String(o.value) === String(hidden.value));
            return m ? m.label : '';
        };

        function select(opt) {
            hidden.value = String(opt.value);
            input.value = opt.label;
            close();
            if (onChange) onChange(hidden.value);
        }

        function render(filterText) {
            const q = normalizeSearchText(filterText);
            visible = q ? options.filter(o => normalizeSearchText(o.label).includes(q)) : options;
            activeIndex = visible.length ? 0 : -1;
            dropdown.innerHTML = '';
            if (visible.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'sal-combo-empty';
                empty.textContent = emptyText || 'لا توجد نتائج مطابقة';
                dropdown.appendChild(empty);
                return;
            }
            visible.forEach((opt, i) => {
                const item = document.createElement('div');
                item.className = 'sal-combo-item' + (String(hidden.value) === String(opt.value) ? ' selected' : '') + (i === activeIndex ? ' active' : '');
                item.textContent = opt.label;
                item.addEventListener('mousedown', (e) => { e.preventDefault(); select(opt); });
                dropdown.appendChild(item);
            });
        }

        function open() { render(input.value === selectedLabel() ? '' : input.value); dropdown.classList.add('open'); }
        function close() { dropdown.classList.remove('open'); }
        function highlight(delta) {
            if (!visible.length) return;
            activeIndex = (activeIndex + delta + visible.length) % visible.length;
            dropdown.querySelectorAll('.sal-combo-item').forEach((el, i) => el.classList.toggle('active', i === activeIndex));
            const el = dropdown.querySelectorAll('.sal-combo-item')[activeIndex];
            if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
        }

        input.addEventListener('focus', () => { input.select(); open(); });
        input.addEventListener('input', () => { render(input.value); dropdown.classList.add('open'); });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); if (!dropdown.classList.contains('open')) open(); else highlight(1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(-1); }
            else if (e.key === 'Enter') { e.preventDefault(); if (activeIndex >= 0 && visible[activeIndex]) select(visible[activeIndex]); }
            else if (e.key === 'Escape') { close(); input.blur(); }
        });
        input.addEventListener('blur', () => {
            setTimeout(() => {
                // نص لا يطابق اختياراً فعلياً ⇐ نعيد اسم الشركة المختارة (أو نُفرغ الحقل لو لا اختيار)
                input.value = selectedLabel();
                close();
            }, 120);
        });
        document.addEventListener('click', (e) => {
            if (!input.contains(e.target) && !dropdown.contains(e.target)) close();
        });

        return {
            setOptions(list) { options = list; },
            enable(placeholder) { input.disabled = false; input.placeholder = placeholder || 'اكتب للبحث أو اختر الشركة...'; },
            getValue() { return hidden.value; },
            getLabel() { return selectedLabel(); }
        };
    }

    window.EmployeeSalaries = {
        createSearchableCombobox, normalizeSearchText,
        fetchImportedMap, resolveBalance,
        fetchCompanies, fetchCompanyLinksForMonth,
        normalizeNationalId, parseSalaryCell, formatDateDMY, currentMonthValue
    };
})();
