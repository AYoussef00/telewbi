// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================

// ملاحظة على بنية جدول attendance الفعلية بسوبابيس:
// id (int4) | employee_id (int4, FK -> employees.id, nullable) | date (date)
// check_in (time) | check_out (time) | hours (numeric) | status (text) | created_at
// لا يوجد عمود company_id مباشر ولا employee_name/company_name — كلاهما
// يُشتق هنا عبر الربط ببيانات جدولي employees و companies المحمَّلة محلياً.
//
// ⚠️ ملاحظة مهمة: شركة كل موظف لا تُقرأ من employees.company_id (هذا العمود لم
// يعد يُستخدم منذ فصل شاشة "إضافة موظف" عن شاشة "ربط الموظفين")، بل تُشتق من
// جدول employee_links (المصدر الفعلي الوحيد لعلاقة الموظف بالشركة الحالية).
//
// 🕰️ لكن بعد ميزة "إنهاء ربط موظف"، إنهاء ربط الموظف (تسجيل تاريخ انتهاء على
// سجله بجدول employee_links، بدل حذفه فعلياً) لا يعني أن سجلات حضوره القديمة
// يجب أن تفقد اسم الشركة! لهذا نجلب أيضاً أرشيف employee_link_history (الشركات
// السابقة + فترة العمل بكل منها)، ونطابق شركة كل سجل حضور حسب تاريخه: الشركة
// الحالية إن كان لا يزال مرتبطاً وقت هذا التاريخ، وإلا الشركة السابقة التي يقع
// هذا التاريخ ضمن فترة عملها.
//
// ⚠️ خريطة "الربط الحالي" (activeLinkByEmployeeId) تُجلب الآن مقيَّدة بالروابط
// النشطة فقط (بلا تاريخ انتهاء، أو لم يأتِ تاريخ انتهائها بعد): بعد أن أصبح
// "إنهاء ربط موظف" يُسجِّل تاريخ انتهاء بدل حذف السجل فعلياً، تبقى الروابط
// المُنهاة سابقاً محفوظة بنفس جدول employee_links، فبدون هذا الفلتر قد يحمل كل
// موظف أكثر من صف ربط (المُنهى + الجديد إن أُعيد ربطه لاحقاً)، فيختلط تحديد أي
// منهما هو "الربط الحالي" فعلياً.
// =========================================================================
// 🛡️ نطاق رؤية المستخدم الحالي — نفس المنطق المستخدم بتقرير الحضور والانصراف
// (attendance-report.js) والمهام وغيرها: مسؤول الشركة (role='company') يرى
// فقط سجلات موظفي شركته/شركاته المملوكة، والموظف (role='employee') يرى سجله
// الشخصي فقط، بينما super_admin/admin يريان كل السجلات بلا قيود.
//
// ⚠️ إصلاح أمني مهم: هذا الملف لم يكن يحتوي إطلاقاً على أي آلية تقييد بحسب
// الدور (خلافاً لبقية الشاشات المشابهة بالنظام) — كل الاستعلامات كانت تجلب كل
// الموظفين وكل الشركات وكل سجلات الحضور بلا أي تصفية، ما يعني أن أي دور غير
// super_admin/admin (بما فيه "موظف" أو "مسؤول شركة" لو مُنح صلاحية عرض هذا
// القسم) كان سيرى سجلات حضور/انصراف كل الموظفين بكل الشركات دون استثناء.
let currentUserScope = { role: null, companyIds: null, employeeId: null };
let scopedEmployeeIds = null; // null = بلا تقييد؛ مصفوفة = مُقيَّد بهذه المعرّفات فقط

async function loadCurrentUserScope() {
    try {
        const { data: { session } } = await dbClient.auth.getSession();
        if (!session) return;

        const { data: profileRow } = await dbClient.from('users').select('role').eq('id', session.user.id).maybeSingle();
        const role = profileRow?.role || null;

        if (role === 'company') {
            const { data: ownedCompanies } = await dbClient.from('companies').select('id').eq('user_id', session.user.id);
            currentUserScope = { role, companyIds: (ownedCompanies || []).map(c => c.id), employeeId: null };
        } else if (role === 'employee') {
            const { data: employeeRow } = await dbClient.from('employees').select('id').eq('user_id', session.user.id).maybeSingle();
            // employeeId = -1 لو تعذّر إيجاد سجل موظف مرتبط بهذا الحساب، حتى لا
            // يُفسَّر null كـ"بلا تقييد" فتُعرض كل السجلات بالخطأ
            currentUserScope = { role, companyIds: null, employeeId: employeeRow ? employeeRow.id : -1 };
        } else {
            currentUserScope = { role, companyIds: null, employeeId: null };
        }
    } catch (error) {
        console.error('تعذّر تحديد نطاق صلاحيات المستخدم الحالي:', error.message);
    }
}

// =========================================================================
// 💳 قيد "الأشهر المدفوعة فقط" لمسؤول الشركة: لا يرى مسؤول الشركة سجلات حضور
// أي شهر لم تُصدَر له فاتورة بحالة "مدفوعة" (paid) بعد — يشمل هذا الشهر
// الجاري لو لم تصدر فاتورته بعد (لا يوجد استثناء)، بلا أي فرق بين شهر بلا
// فاتورة إطلاقاً وشهر بفاتورة غير مدفوعة/متأخرة: كلاهما يُخفى بالكامل.
//
// ⚠️ جدول invoices لا يحتوي عمود فترة (period_from/period_to) صريحاً — حقلا
// "فترة الاشتراك" بشاشة إصدار فاتورة (add_invoice.js) يُستخدمان فقط لتوليد
// نص الوصف والسعر التناسبي تلقائياً، ولا يُحفظان كعمودين بقاعدة البيانات.
// لذا "شهر الفاتورة" هنا = شهر/سنة invoice_date نفسه (تاريخ إصدارها) — تأكد
// عند إصدار فاتورة شهر معيّن من أن invoice_date يقع فعلياً ضمن ذلك الشهر.
//
// تُبنى خريطة (معرّف الشركة ← مجموعة أشهر مدفوعة "YYYY-MM") بدل مجموعة واحدة
// مشتركة، لأن مسؤول شركة قد يملك أكثر من شركة بتواريخ سداد مختلفة تماماً.
// =========================================================================
async function getPaidMonthsMapForCompanies(companyIds) {
    const map = new Map(); // company_id (نصياً) ← Set('YYYY-MM')
    if (!companyIds || companyIds.length === 0) return map;
    try {
        const rows = await fetchAllRows((from, to) =>
            dbClient.from('invoices')
                .select('invoice_date, company_id, items')
                .eq('status', 'paid')
                .in('company_id', companyIds)
                .range(from, to)
        );
        // الأشهر المفتوحة = الأشهر التي تغطيها فترة الفاتورة (من وصف البنود)،
        // وإلا شهر invoice_date — انظر app/shared/invoice-periods.js
        InvoicePeriods.buildPaidMonthsMap(rows).forEach((set, key) => map.set(key, set));
    } catch (error) {
        console.error('تعذّر تحديد الأشهر المدفوعة لكل شركة:', error.message);
    }
    return map;
}

// سجل بلا شركة محدَّدة أو بلا تاريخ لا يمكن التحقق من دفع فاتورة شهره ⇒ يُخفى
// (الأكثر أماناً، اتساقاً مع سياسة "الإخفاء الافتراضي حتى يثبت السداد")
function isRecordDateInPaidMonth(paidMonthsMap, companyId, dateStr) {
    if (!dateStr || companyId == null) return false;
    const set = paidMonthsMap.get(String(companyId));
    if (!set) return false;
    return set.has(String(dateStr).slice(0, 7));
}

// =========================================================================
// 🙈 إخفاء زر "إضافة سجلات متعددة" عن دور "مسؤول شركة" تحديداً — نفس سبب
// tasks.js تماماً: هذا الزر يحمل data-perm="add:attendance"، وهو نفس المفتاح
// المستخدم لزر "إضافة سجل حضور" العادي المطلوب بقاء ظهوره لمسؤول الشركة، فلا
// يمكن إخفاء هذا الزر وحده عبر نظام الصلاحيات القابل للتخصيص، بل عبر الدور
// مباشرة. ⚠️ إخفاء واجهة فقط — الحماية من الوصول المباشر عبر الرابط موجودة
// أيضاً بأول attendance_bulk.js (انظر التعليق هناك).
//
// 🛡️ الزر مخفي افتراضياً بـ CSS (السمة data-hide-for-company بملف
// global-layout.css) منذ أول رسم للصفحة، بمعزل تماماً عن applyButtonGating()
// (المُستدعاة من داخل Permissions.guardPage() فور اكتمالها، والتي كانت تُظهر
// هذا الزر فوراً بمجرد منح الدور صلاحية "add:attendance" العامة — لأنها لا
// تعرف شيئاً عن هذا الاستثناء الخاص بمسؤول الشركة). كان هذا يسبق اكتمال هذا
// التحقق غير الفوري من الدور (استعلام Supabase منفصل بـ loadCurrentUserScope)
// بلحظات، فيظهر الزر ثم يختفي فجأة — وميض غير احترافي. الحل: لا نُظهر الزر
// الآن إلا صراحةً (بإزالة السمة) لغير مسؤول الشركة؛ يبقى مخفياً بلا أي تدخل
// إضافي لمسؤول الشركة تحديداً (وهو الحالة الافتراضية أصلاً).
// =========================================================================
function applyCompanyRoleAttendanceUiRestrictions() {
    if (currentUserScope.role === 'company') return; // يبقى مخفياً كما هو مضبوط افتراضياً بالـ HTML
    const btnMulti = document.getElementById('btnMultiRecords');
    if (btnMulti) btnMulti.removeAttribute('data-hide-for-company');
}

let employeesCache = [];
let companiesCache = [];
let employeeById = new Map();
let companyById = new Map();

// الربط الحالي لكل موظف (employee_id -> {company_id, link_date}) من جدول employee_links
let activeLinkByEmployeeId = new Map();

// أرشيف الروابط المنتهية لكل موظف (employee_id -> [{company_id, company_name, start_date, end_date}, ...])
// مرتّبة تنازلياً حسب end_date (الأحدث أولاً)
let historyPeriodsByEmployeeId = new Map();

let dateCompanyFilteredRows = []; // بعد فلترة النطاق الزمني + الشركة (تُستخدم لحساب العدادات)
let visibleRows = [];             // بعد إضافة فلتر بحث اسم الموظف فوقها (تُستخدم لعرض الجدول)

let currentAttPage = 1;
const attRowsPerPage = 10;

let selectedCompanyId = ''; // '' = جميع الشركات

// 📅 تاريخ اليوم بصيغة YYYY-MM-DD حسب توقيت جهاز المستخدم — يُستخدم لتقييد جلب
// "الربط الحالي" على الروابط النشطة فقط؛ انظر التعليق أعلى activeLinkByEmployeeId
function getTodayDateStringForLinks() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

// =========================================================================
// 1ب. جلب كامل صفوف جدول ما على دفعات (Pagination) — سوبابيس (PostgREST)
//     يفرض حداً افتراضياً 1000 صف كحد أقصى لكل طلب، وأي طلب select('*') بلا
//     .range() صريح كان يُقتطع صامتاً عند تجاوز هذا الحد فلا تظهر كل البيانات
//     بالجدول (نفس المشكلة التي أُصلحت سابقاً بتقارير الحضور/المهام/الموظفين/
//     الشركات). builderFactory(from, to) يجب أن يُعيد استعلام سوبابيس جاهزاً
//     (Promise) مع .range(from, to) مُطبّق عليه بالفعل.
// =========================================================================
const ATTENDANCE_FETCH_PAGE_SIZE = 1000;

async function fetchAllRows(builderFactory) {
    let allRows = [];
    let from = 0;

    while (true) {
        const { data, error } = await builderFactory(from, from + ATTENDANCE_FETCH_PAGE_SIZE - 1);
        if (error) throw error;

        allRows = allRows.concat(data || []);

        if (!data || data.length < ATTENDANCE_FETCH_PAGE_SIZE) break; // آخر صفحة
        from += ATTENDANCE_FETCH_PAGE_SIZE;
    }

    return allRows;
}

// =========================================================================
// 2. تشغيل الصفحة
//    🔒 التحكم بالوصول للصفحة بأكملها وبإظهار أزرار الإجراءات ("إضافة سجل
//    حضور" / "إضافة سجلات متعددة") أصبح الآن عبر محرك الصلاحيات الموحّد
//    (permissions.js — Permissions.guardPage / data-perm)، بدل الفحص الداخلي
//    القديم الخاص بهذه الصفحة وحدها (كان يعتمد على مفتاح
//    "action:attendance_bulk_add" ضمن عمود menus بجدول role_permissions —
//    انظر applyBulkAddActionPermission سابقاً، أُزيلت الآن لصالح
//    data-perm="add:attendance" على كلا الزرين بملف attendance.html).
// =========================================================================
document.addEventListener('DOMContentLoaded', async () => {
    const allowed = await Permissions.guardPage('attendance');
    if (!allowed) return;

    await loadCurrentUserScope();
    applyCompanyRoleAttendanceUiRestrictions();

    setDefaultMonthRange();
    initCompanyCombobox();
    wireEvents();
    loadEverything();
});

function setDefaultMonthRange() {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    document.getElementById('fromDateInput').value = toDateInputValue(firstDay);
    document.getElementById('toDateInput').value = toDateInputValue(lastDay);
}

function toDateInputValue(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function wireEvents() {
    const searchInput = document.getElementById('employeeSearchInput');
    if (searchInput) searchInput.addEventListener('input', () => {
        currentAttPage = 1;
        applyEmployeeSearchFilter();
    });

    const fromDate = document.getElementById('fromDateInput');
    const toDate = document.getElementById('toDateInput');
    if (fromDate) fromDate.addEventListener('change', loadAttendanceForCurrentRange);
    if (toDate) toDate.addEventListener('change', loadAttendanceForCurrentRange);

    const btnAdd = document.getElementById('btnAddAttendance');
    if (btnAdd) btnAdd.addEventListener('click', () => window.location.href = Routes.url('add_attendance'));

    const btnMulti = document.getElementById('btnMultiRecords');
    if (btnMulti) btnMulti.addEventListener('click', () => window.location.href = Routes.url('attendance_bulk'));

    const btnRefresh = document.getElementById('btnRefreshAttendance');
    if (btnRefresh) btnRefresh.addEventListener('click', () => {
        btnRefresh.classList.add('spinning');
        loadEverything().finally(() => setTimeout(() => btnRefresh.classList.remove('spinning'), 600));
    });
}

async function loadEverything() {
    await loadEmployeesAndCompanies();
    await loadAttendanceForCurrentRange();
}

// =========================================================================
// 3. تحميل الموظفين والشركات (لغرض الربط + قائمة فلتر الشركة)، وتحميل شركة
//    كل موظف (الحالية + الأرشيف السابق) لتغذية resolveCompanyForEmployeeAtDate
//
//    ⚠️ الجداول الثلاثة تُجلب الآن على دفعات (fetchAllRows) بدل طلب واحد،
//    لضمان تحميل كل السجلات مهما بلغ عددها (وليس أول 1000 صف فقط من كل جدول).
// =========================================================================
async function loadEmployeesAndCompanies() {
    let historyRows = [];

    try {
        // 🛡️ الشركات وروابط الموظفين النشطة: مُقيَّدة بشركات مسؤول الشركة
        // المملوكة فقط (currentUserScope.companyIds) إن وُجد تقييد — انظر تعليق
        // نطاق الرؤية أعلى الملف.
        const [companies, links] = await Promise.all([
            fetchAllRows((from, to) => {
                let q = dbClient.from('companies').select('id, name')
                    .order('id', { ascending: true })
                    .range(from, to);
                if (currentUserScope.companyIds !== null) q = q.in('id', currentUserScope.companyIds);
                return q;
            }),
            // ⚠️ روابط نشطة فقط (بلا تاريخ انتهاء، أو لم يأتِ تاريخ انتهائها بعد)
            // — انظر تعليق getTodayDateStringForLinks أعلى الملف.
            fetchAllRows((from, to) => {
                let q = dbClient.from('employee_links').select('employee_id, company_id, link_date')
                    .or(`link_end_date.is.null,link_end_date.gte.${getTodayDateStringForLinks()}`)
                    .order('employee_id', { ascending: true })
                    .order('company_id', { ascending: true })
                    .range(from, to);
                if (currentUserScope.companyIds !== null) q = q.in('company_id', currentUserScope.companyIds);
                return q;
            })
        ]);

        companiesCache = companies;
        companyById = new Map(companiesCache.map(c => [String(c.id), c]));
        activeLinkByEmployeeId = new Map(links.map(l => [String(l.employee_id), l]));

        populateCompanyComboboxOptions();
    } catch (error) {
        console.error('تعذّر تحميل بيانات الشركات/الربط:', error.message);
    }

    // أرشيف الروابط المنتهية — طلب منفصل غير معطِّل: لو الجدول غير موجود بعد
    // (لم يُشغَّل سكربت SQL الخاص به) نكتفي بتسجيل الخطأ بالكونسول ونُكمل
    // بخريطة فارغة، بدل إيقاف تحميل بيانات الموظفين/الشركات الأساسية بالكامل.
    // مُقيَّد أيضاً بنفس نطاق الشركات إن وُجد.
    try {
        historyRows = await fetchAllRows((from, to) => {
            let q = dbClient.from('employee_link_history')
                .select('employee_id, company_id, company_name, start_date, end_date')
                .order('employee_id', { ascending: true })
                .range(from, to);
            if (currentUserScope.companyIds !== null) q = q.in('company_id', currentUserScope.companyIds);
            return q;
        });

        historyPeriodsByEmployeeId = new Map();
        (historyRows || []).forEach(row => {
            const key = String(row.employee_id);
            if (!historyPeriodsByEmployeeId.has(key)) historyPeriodsByEmployeeId.set(key, []);
            historyPeriodsByEmployeeId.get(key).push(row);
        });
        historyPeriodsByEmployeeId.forEach(periods => {
            periods.sort((a, b) => String(b.end_date || '').localeCompare(String(a.end_date || '')));
        });
    } catch (error) {
        console.error('تعذّر تحميل أرشيف الروابط المنتهية (سيُعرض بدون شركات سابقة):', error.message);
        historyPeriodsByEmployeeId = new Map();
        historyRows = [];
    }

    // 🛡️ نطاق معرّفات الموظفين المسموح بها: لمسؤول الشركة = اتحاد موظفي شركاته
    // (من الربط النشط + الأرشيف المُقيَّدين أعلاه)، وللموظف = سجله الشخصي فقط.
    // يُستخدم أدناه لتقييد جلب بيانات الموظفين أنفسهم وسجلات الحضور معاً.
    if (currentUserScope.companyIds !== null) {
        const idSet = new Set();
        activeLinkByEmployeeId.forEach((link, key) => idSet.add(key));
        historyRows.forEach(row => { if (row.employee_id != null) idSet.add(String(row.employee_id)); });
        scopedEmployeeIds = Array.from(idSet);
    } else if (currentUserScope.employeeId !== null) {
        scopedEmployeeIds = [String(currentUserScope.employeeId)];
    } else {
        scopedEmployeeIds = null;
    }

    // تحميل بيانات الموظفين أنفسهم (الأسماء) — مُقيَّد بنفس نطاق المعرّفات أعلاه
    try {
        employeesCache = await fetchAllRows((from, to) => {
            let q = dbClient.from('employees').select('id, name')
                .order('id', { ascending: true })
                .range(from, to);
            if (scopedEmployeeIds !== null) q = q.in('id', scopedEmployeeIds);
            return q;
        });
        employeeById = new Map(employeesCache.map(e => [String(e.id), e]));
    } catch (error) {
        console.error('تعذّر تحميل بيانات الموظفين:', error.message);
    }
}

// 🏢 تحديد شركة الموظف وقت تاريخ سجل حضور مُعيّن: الشركة الحالية إن كان
// مرتبطاً وقت هذا التاريخ، وإلا الشركة السابقة (من الأرشيف) التي يقع هذا
// التاريخ ضمن فترة عمله بها، وإلا كحل أخير أقرب علاقة معروفة لهذا الموظف.
function resolveCompanyForEmployeeAtDate(employeeId, dateStr) {
    const empKey = String(employeeId);
    const active = activeLinkByEmployeeId.get(empKey);

    if (active) {
        const inRange = !active.link_date || !dateStr || dateStr >= active.link_date;
        if (inRange) {
            const company = companyById.get(String(active.company_id));
            if (company) return { id: String(active.company_id), name: company.name || '----' };
        }
    }

    const periods = historyPeriodsByEmployeeId.get(empKey) || [];
    const covering = periods.find(p =>
        (!p.start_date || !dateStr || dateStr >= p.start_date) &&
        (!p.end_date || !dateStr || dateStr <= p.end_date)
    );
    if (covering) {
        return { id: covering.company_id != null ? String(covering.company_id) : '', name: covering.company_name || '----' };
    }

    // احتياط: لا تطابق دقيق بالتاريخ — استخدم أقرب علاقة معروفة لهذا الموظف
    if (active) {
        const company = companyById.get(String(active.company_id));
        if (company) return { id: String(active.company_id), name: company.name || '----' };
    }
    if (periods.length > 0) {
        return { id: periods[0].company_id != null ? String(periods[0].company_id) : '', name: periods[0].company_name || '----' };
    }
    return { id: '', name: '—' };
}

// =========================================================================
// 4. قائمة الشركة القابلة للاختيار (Combobox) — اختيار حصري وليس بحث حر
// =========================================================================
let attCompanyOptions = [{ value: '', label: 'جميع الشركات' }];

function initCompanyCombobox() {
    const input = document.getElementById('attCompanySearch');
    const hidden = document.getElementById('attCompanyId');
    const dropdown = document.getElementById('attCompanyDropdown');
    if (!input || !hidden || !dropdown) return;

    function getSelectedLabel() {
        const match = attCompanyOptions.find(opt => String(opt.value) === String(hidden.value));
        return match ? match.label : '';
    }

    function renderOptions(filterText) {
        const normalized = (filterText || '').trim().toLowerCase();
        const filtered = normalized
            ? attCompanyOptions.filter(opt => opt.label.toLowerCase().includes(normalized))
            : attCompanyOptions;

        dropdown.innerHTML = '';

        if (filtered.length === 0) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'combo-empty';
            emptyEl.textContent = 'لا توجد شركات مطابقة';
            dropdown.appendChild(emptyEl);
            return;
        }

        filtered.forEach(opt => {
            const item = document.createElement('div');
            item.className = 'combo-item';
            if (String(hidden.value) === String(opt.value)) item.classList.add('selected');
            item.textContent = opt.label;
            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                hidden.value = opt.value;
                input.value = opt.value === '' ? '' : opt.label;
                input.placeholder = opt.value === '' ? 'جميع الشركات' : input.placeholder;
                closeDropdown();
                selectedCompanyId = opt.value;
                currentAttPage = 1;
                applyDateCompanyFilter();
            });
            dropdown.appendChild(item);
        });
    }

    function openDropdown() {
        renderOptions(input.value === getSelectedLabel() ? '' : input.value);
        dropdown.classList.add('open');
    }
    function closeDropdown() { dropdown.classList.remove('open'); }

    input.addEventListener('focus', () => { input.select(); openDropdown(); });
    input.addEventListener('input', () => { renderOptions(input.value); dropdown.classList.add('open'); });
    input.addEventListener('blur', () => {
        setTimeout(() => {
            input.value = getSelectedLabel();
            closeDropdown();
        }, 120);
    });
    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !dropdown.contains(e.target)) closeDropdown();
    });
}

function populateCompanyComboboxOptions() {
    attCompanyOptions = [{ value: '', label: 'جميع الشركات' }]
        .concat(companiesCache
            .slice()
            .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar'))
            .map(c => ({ value: String(c.id), label: c.name || '----' })));
}

// =========================================================================
// 5. جلب سجلات الحضور حسب النطاق الزمني المحدد وربطها بالموظف/الشركة
//
//    ⚠️ سوبابيس (PostgREST) يفرض حداً افتراضياً 1000 صف كحد أقصى لكل طلب —
//    أي طلب سجلات حضور يتجاوز هذا العدد ضمن نطاق التاريخ المحدد كان يُقتطع
//    صامتاً فلا تظهر كل السجلات بالجدول ولا بالعدادات. لذا تُجلب السجلات الآن
//    على دفعات (صفحات من 1000 صف) عبر fetchAllRows حتى تكتمل كل السجلات مهما
//    بلغ عددها، بدل طلب واحد قد يُقتطع.
// =========================================================================
async function loadAttendanceForCurrentRange() {
    const tableBody = document.getElementById('attendanceTableBody');
    const fromDate = document.getElementById('fromDateInput').value;
    const toDate = document.getElementById('toDateInput').value;

    try {
        const attendanceRows = await fetchAllRows((from, to) => {
            let query = dbClient
                .from('attendance')
                .select('*')
                .order('date', { ascending: false })
                .order('id', { ascending: false }) // ترتيب ثانوي حاسم لضمان تسلسل صفحات ثابت بلا تكرار أو نقص
                .range(from, to);

            if (fromDate) query = query.gte('date', fromDate);
            if (toDate) query = query.lte('date', toDate);
            // 🛡️ تقييد بنطاق الموظفين المسموح بهم (انظر تعليق نطاق الرؤية أعلى الملف)
            if (scopedEmployeeIds !== null) query = query.in('employee_id', scopedEmployeeIds);

            return query;
        });

        let joined = (attendanceRows || []).map(record => {
            const employee = record.employee_id != null ? employeeById.get(String(record.employee_id)) : null;
            const resolvedCompany = record.employee_id != null
                ? resolveCompanyForEmployeeAtDate(record.employee_id, record.date)
                : { id: '', name: '—' };

            return {
                id: record.id,
                employee_id: record.employee_id,
                employee_name: employee ? (employee.name || '----') : 'موظف محذوف',
                company_id: resolvedCompany.id,
                company_name: resolvedCompany.name,
                date: record.date,
                check_in: record.check_in,
                check_out: record.check_out,
                status: normalizeStatus(record.status)
            };
        });

        // 💳 مسؤول الشركة: إخفاء سجلات أي شهر لم تُصدَر له فاتورة مدفوعة بعد —
        // انظر تعليق getPaidMonthsMapForCompanies أعلى الملف
        if (currentUserScope.role === 'company') {
            const paidMonthsMap = await getPaidMonthsMapForCompanies(currentUserScope.companyIds);
            joined = joined.filter(record => isRecordDateInPaidMonth(paidMonthsMap, record.company_id, record.date));
        }

        window.__allJoinedAttendanceRows = joined;
        applyDateCompanyFilter();

    } catch (error) {
        console.error('فشل جلب سجلات الحضور:', error.message);
        if (tableBody) {
            tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#ef4444; padding:20px;">تعذّر تحميل سجلات الحضور: ${error.message}</td></tr>`;
        }
    }
}

function normalizeStatus(rawStatus) {
    if (!rawStatus) return 'حاضر'; // الافتراضي عند عدم تحديد حالة صراحة
    const val = String(rawStatus).toLowerCase();
    if (val === 'present' || rawStatus === 'حاضر') return 'حاضر';
    if (val === 'absent' || rawStatus === 'غائب') return 'غائب';
    if (val === 'late' || rawStatus === 'متأخر') return 'متأخر';
    if (val === 'annual_leave' || rawStatus === 'إجازة سنوية') return 'إجازة سنوية';
    return rawStatus;
}

// =========================================================================
// 6. الفلترة: (نطاق التاريخ مطبَّق مسبقاً بالجلب) + الشركة على مستوى العدادات
//    ثم بحث اسم الموظف فوقها فقط لعرض الجدول (بدون التأثير على العدادات)
// =========================================================================
function applyDateCompanyFilter() {
    const allRows = window.__allJoinedAttendanceRows || [];

    dateCompanyFilteredRows = !selectedCompanyId
        ? allRows
        : allRows.filter(r => r.company_id === selectedCompanyId);

    updateAttendanceCounters(dateCompanyFilteredRows);
    applyEmployeeSearchFilter();
}

function applyEmployeeSearchFilter() {
    const searchText = (document.getElementById('employeeSearchInput')?.value || '').toLowerCase().trim();

    visibleRows = !searchText
        ? dateCompanyFilteredRows
        : dateCompanyFilteredRows.filter(r => r.employee_name.toLowerCase().includes(searchText));

    renderAttendanceTable(visibleRows);
}

// =========================================================================
// 7. العدادات الأربعة العلوية
// =========================================================================
function updateAttendanceCounters(rows) {
    const total = rows.length;
    const present = rows.filter(r => r.status === 'حاضر').length;
    const absent = rows.filter(r => r.status === 'غائب').length;
    const late = rows.filter(r => r.status === 'متأخر').length;

    setText('totalRecordsCounter', total);
    setText('totalAttendanceCounter', present);
    setText('totalAbsenceCounter', absent);
    setText('totalDelayCounter', late);
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

// =========================================================================
// 8. بناء جدول الحضور (مع تقسيم صفحات)
//    🎨 الأيقونات المضمّنة (الموظف/الشركة/التاريخ ونقاط شارة الحالة) تُبنى
//    الآن عبر مكتبة الأيقونات الموحّدة (icons.js — data-icon) بدل رموز
//    الإيموجي القديمة (👤/🏢/📅/🔴🟠🔵🟢)، لضمان مظهر متطابق على كل الأجهزة
//    وأنظمة التشغيل. لهذا نستدعي applyIconPlaceholders(tableBody) يدوياً بعد
//    كل حقن HTML جديد بالجدول، لتعبئة عناصر [data-icon] المُضافة حديثاً.
//
//    🔒 أزرار "تعديل" و"حذف" لكل صف تحمل الآن data-perm="edit:attendance" /
//    data-perm="delete:attendance" (مخفية بالكامل عبر CSS إلى أن يؤكد محرك
//    الصلاحيات — permissions.js — امتلاك المستخدم الحالي لهذا الإجراء)، لذا
//    نستدعي Permissions.applyButtonGating(tableBody) يدوياً بعد كل حقن HTML
//    جديد بالجدول، ليغطي هذا الاستدعاء الواحد كل عمليات إعادة العرض (بحث/
//    فلترة/تغيير نطاق التاريخ/تقليب صفحات) بدل تكراره بكل نقطة استدعاء.
// =========================================================================
function renderAttendanceTable(data) {
    const tableBody = document.getElementById('attendanceTableBody');
    if (!tableBody) return;

    if (!data || data.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; color:#94a3b8;">لا توجد سجلات مطابقة لخيارات البحث الحالية.</td></tr>`;
        setupAttPaginationControls(0);
        return;
    }

    const startIndex = (currentAttPage - 1) * attRowsPerPage;
    const endIndex = startIndex + attRowsPerPage;
    const paginatedData = data.slice(startIndex, endIndex);

    tableBody.innerHTML = paginatedData.map(row => buildAttendanceRowHtml(row)).join('');
    if (window.applyIconPlaceholders) applyIconPlaceholders(tableBody);
    if (window.Permissions) Permissions.applyButtonGating(tableBody);
    setupAttPaginationControls(data.length);
}

function buildAttendanceRowHtml(row) {
    const badgeClass = row.status === 'غائب' ? 'badge-att-absent' : (row.status === 'متأخر' ? 'badge-att-late' : (row.status === 'إجازة سنوية' ? 'badge-att-leave' : 'badge-att-present'));
    const badgeDotIcon = row.status === 'غائب' ? 'dot-red' : (row.status === 'متأخر' ? 'dot-orange' : (row.status === 'إجازة سنوية' ? 'dot-blue' : 'dot-green'));

    // 🚫 زر "تسجيل غياب" السريع: يُخفى لو كان السجل مُسجَّلاً "غائب" بالفعل، فلا حاجة لتكراره
    const markAbsentBtn = row.status !== 'غائب'
        ? `<button class="action-icon-btn" style="color:#f97316;" title="تسجيل غياب لهذا اليوم" onclick="markAttendanceAbsent('${row.id}')">${ICONS.blocked}</button>`
        : '';

    return `
        <tr>
            <td><strong style="color:#1e293b;"><span class="row-inline-icon" data-icon="person"></span> ${row.employee_name}</strong></td>
            <td style="color:#334155;"><span class="row-inline-icon" data-icon="building"></span> ${row.company_name}</td>
            <td style="color:#475569;"><span class="row-inline-icon" data-icon="calendar"></span> ${row.date}</td>
            <td style="font-weight:600; color:#475569;">${row.check_in || '--:--:--'}</td>
            <td style="font-weight:600; color:#475569;">${row.check_out || '--:--:--'}</td>
            <td style="text-align:center;"><span class="badge-att-status ${badgeClass}"><span class="badge-dot-icon" data-icon="${badgeDotIcon}"></span> ${row.status}</span></td>
            <td style="text-align:center;">
                ${markAbsentBtn}
                <button class="action-icon-btn" data-perm="edit:attendance" title="تعديل السجل" onclick="editAttendanceRecord('${row.id}')">${ICONS.edit}</button>
                <button class="action-icon-btn" data-perm="delete:attendance" style="color:#ef4444;" title="حذف السجل" onclick="deleteAttendanceRecord('${row.id}')">${ICONS.trash}</button>
            </td>
        </tr>
    `;
}

function setupAttPaginationControls(totalItems) {
    const controlsContainer = document.getElementById('attendancePagination');
    if (!controlsContainer) return;
    controlsContainer.innerHTML = '';

    const totalPages = Math.ceil(totalItems / attRowsPerPage);
    if (totalPages <= 1) return;

    const prevBtn = document.createElement('button');
    prevBtn.innerHTML = '&rarr; السابقة';
    prevBtn.disabled = currentAttPage === 1;
    prevBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;';
    if (prevBtn.disabled) prevBtn.style.opacity = '0.5';
    prevBtn.onclick = () => { if (currentAttPage > 1) { currentAttPage--; renderAttendanceTable(visibleRows); } };
    controlsContainer.appendChild(prevBtn);

    const countLabel = document.createElement('span');
    countLabel.style.cssText = 'font-size: 0.9rem; color: #475569; font-weight: 600; margin: 0 10px;';
    countLabel.textContent = `صفحة ${currentAttPage} من ${totalPages}`;
    controlsContainer.appendChild(countLabel);

    const nextBtn = document.createElement('button');
    nextBtn.innerHTML = 'التالية &larr;';
    nextBtn.disabled = currentAttPage === totalPages;
    nextBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;';
    if (nextBtn.disabled) nextBtn.style.opacity = '0.5';
    nextBtn.onclick = () => { if (currentAttPage < totalPages) { currentAttPage++; renderAttendanceTable(visibleRows); } };
    controlsContainer.appendChild(nextBtn);
}

// =========================================================================
// 9. تعديل / حذف سجل حضور / تسجيل غياب سريع
// =========================================================================
function editAttendanceRecord(id) {
    window.location.href = (Routes.url('edit_attendance') + '?id=') + encodeURIComponent(id);
}

async function deleteAttendanceRecord(id) {
    if (!confirm('هل أنت متأكد من رغبتك في حذف سجل الحضور هذا نهائياً؟')) return;

    try {
        // ⚠️ نطلب .select() على الحذف حتى نعرف بالضبط هل تم حذف أي سجل فعلياً؛ فبعض
        // إعدادات RLS بسوبابيس تمنع الحذف بصمت (تُرجع نجاحاً بدون أي صف محذوف
        // فعلياً بدل رسالة خطأ صريحة)، وهذا بالضبط ما كان يجعل السجل يبقى ظاهراً
        // بالجدول بعد الضغط على "حذف" دون أي رسالة خطأ توضّح السبب.
        const { data: deletedRows, error } = await dbClient
            .from('attendance')
            .delete()
            .eq('id', id)
            .select();

        if (error) throw error;

        if (!deletedRows || deletedRows.length === 0) {
            alert("لم يتم حذف السجل فعلياً. غالباً السبب عدم وجود سياسة حذف (RLS DELETE Policy) على جدول 'attendance' في سوبابيس.");
            return;
        }

        // لا نعرض alert نجاح: اختفاء الصف من الجدول بعد إعادة التحميل كافٍ كتأكيد.
        await loadAttendanceForCurrentRange();
    } catch (error) {
        console.error('تعذّر حذف سجل الحضور:', error.message);
        alert('فشل حذف السجل: ' + error.message);
    }
}

// 🚫 تسجيل غياب سريع: يُحوّل حالة السجل الحالي إلى "غائب" مباشرة من الجدول
// دون الحاجة لفتح شاشة التعديل الكاملة، ويمسح وقتي الدخول/الخروج المسجَّلين
// (وعدد ساعات العمل المحسوبة منهما) لأنهما لا معنى لهما مع حالة "غائب".
async function markAttendanceAbsent(id) {
    if (!confirm('هل تريد تسجيل هذا السجل كـ "غائب"؟ سيتم مسح وقتي الدخول والخروج المسجَّلين لهذا اليوم.')) return;

    try {
        // نطلب .select() على التحديث حتى نعرف بالضبط هل تم تعديل السجل فعلياً؛ فبعض
        // إعدادات RLS بسوبابيس تمنع التحديث بصمت (تُرجع نجاحاً بدون أي صف مُعدَّل
        // فعلياً) بدل رسالة خطأ صريحة، فيبدو للمستخدم أن الزر "لا يعمل" رغم عدم ظهور أي خطأ.
        const { data: updatedRows, error } = await dbClient
            .from('attendance')
            .update({ status: 'غائب', check_in: null, check_out: null, hours: null })
            .eq('id', id)
            .select();

        if (error) throw error;

        if (!updatedRows || updatedRows.length === 0) {
            alert("لم يتم تسجيل الغياب فعلياً. غالباً السبب عدم وجود سياسة تحديث (RLS UPDATE Policy) على جدول 'attendance' في سوبابيس.");
            return;
        }

        await loadAttendanceForCurrentRange();
    } catch (error) {
        console.error('تعذّر تسجيل الغياب:', error.message);
        alert('فشلت العملية: ' + error.message);
    }
}
