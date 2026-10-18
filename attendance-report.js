// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================
const SUPABASE_URL = "https://mcdhxdfkuokhmhtfvjev.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_yt9V8lsNU1zN3Ix2CvovbQ_QCA2VDdM";
const dbClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 🛡️ نفس منطق نطاق الرؤية المستخدم بتقارير الموظفين/الشركات/المهام: مسؤول
// الشركة (role='company') يرى فقط سجلات حضور موظفي شركته/شركاته المملوكة،
// بينما super_admin/admin يريان كل السجلات بلا قيود.
//
// ⚠️ إصلاح أمني مهم: دور "موظف" (role='employee') كان يقع ضمن نفس الفرع
// else العام (companyIds: null ⇐ بلا أي تقييد)، ما يعني أنه لو مُنح صلاحية
// عرض هذا التقرير مستقبلاً، كان سيرى سجلات حضور/انصراف كل موظفي كل الشركات
// — وليس سجلّه هو فقط. الآن يُقيَّد صراحة بسجله الشخصي فقط عبر employeeId
// (يُستخدم أدناه بدالة loadEmployeesAndCompanies لتحديد scopedEmployeeIds).
let currentUserScope = { role: null, companyIds: null, employeeId: null };

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
            // يُفسَّر null كـ"بلا تقييد" فتُعرض كل السجلات بالخطأ (انظر استخدامها أدناه)
            currentUserScope = { role, companyIds: null, employeeId: employeeRow ? employeeRow.id : -1 };
        } else {
            currentUserScope = { role, companyIds: null, employeeId: null };
        }
    } catch (error) {
        console.error('تعذّر تحديد نطاق صلاحيات المستخدم الحالي:', error.message);
    }
}

// =========================================================================
// 💳 قيد "الأشهر المدفوعة فقط" لمسؤول الشركة: لا يرى مسؤول الشركة سجلات
// حضور أي شهر لم تُصدَر له فاتورة بحالة "مدفوعة" (paid) بعد — يشمل هذا
// الشهر الجاري لو لم تصدر فاتورته بعد (بلا استثناء)، وأي سجل بلا شركة
// محدَّدة أيضاً (لا يمكن التحقق من دفع شهره). "شهر الفاتورة" = شهر/سنة
// invoice_date نفسه (لا يوجد عمود فترة صريح بجدول invoices — انظر التعليق
// المطابق بـ attendance.js).
// =========================================================================
async function getPaidMonthsMapForCompanies(companyIds) {
    const map = new Map(); // company_id (نصياً) ← Set('YYYY-MM')
    if (!companyIds || companyIds.length === 0) return map;
    try {
        let from = 0;
        while (true) {
            const { data, error } = await dbClient
                .from('invoices')
                .select('invoice_date, company_id')
                .eq('status', 'paid')
                .in('company_id', companyIds)
                .range(from, from + SUPABASE_FETCH_PAGE_SIZE - 1);
            if (error) throw error;
            (data || []).forEach(row => {
                if (!row.invoice_date || row.company_id == null) return;
                const key = String(row.company_id);
                if (!map.has(key)) map.set(key, new Set());
                map.get(key).add(String(row.invoice_date).slice(0, 7));
            });
            if (!data || data.length < SUPABASE_FETCH_PAGE_SIZE) break;
            from += SUPABASE_FETCH_PAGE_SIZE;
        }
    } catch (error) {
        console.error('تعذّر تحديد الأشهر المدفوعة لكل شركة:', error.message);
    }
    return map;
}

function isRecordDateInPaidMonth(paidMonthsMap, companyId, dateStr) {
    if (!dateStr || companyId == null || companyId === '') return false;
    const set = paidMonthsMap.get(String(companyId));
    if (!set) return false;
    return set.has(String(dateStr).slice(0, 7));
}

// 📅 تاريخ اليوم بصيغة YYYY-MM-DD — لتقييد استعلام الربط الحالي (employee_links)
// بالروابط النشطة فقط. بعد تحويل "إنهاء الربط" ليصبح تعليماً بتاريخ انتهاء
// (link_end_date) بدل حذف صف الربط فعلياً، تبقى صفوف الروابط المُنهاة موجودة
// بالجدول؛ بلا هذا التقييد قد يحتوي activeLinkByEmployeeId (وهو خريطة تفترض
// اسمياً وبتعليقاتها أنها "الربط الحالي" فقط) على أكثر من صف لنفس الموظف
// (ربط قديم منتهٍ + ربط جديد نشط)، فيُبنى الخريطة من صف عشوائي غير مضمون
// كونه الربط النشط فعلياً — بدل الاعتماد فقط على الأرشيف (employee_link_history)
// لتحديد شركة الموظف بالفترات المنتهية كما هي مصمَّمة للعمل.
function getTodayDateStringForLinks() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

// ملاحظة على بنية جدول attendance الفعلية بسوبابيس:
// id (int4) | employee_id (int4, FK -> employees.id, nullable) | date (date)
// check_in (time) | check_out (time) | hours (numeric) | status (text) | created_at
// لا يوجد عمود company_id مباشر ولا employee_name/company_name — كلاهما
// يُشتق هنا عبر الربط ببيانات جدولي employees و companies المحمَّلة محلياً
// (نفس منطق شاشة إدارة الحضور والانصراف attendance.js).
//
// ⚠️ ملاحظة مهمة: شركة كل موظف لا تُقرأ من employees.company_id (هذا العمود لم
// يعد يُستخدم منذ فصل شاشة "إضافة موظف" عن شاشة "ربط الموظفين")، بل تُشتق من
// جدول employee_links (المصدر الفعلي الوحيد لعلاقة الموظف بالشركة الحالية).
//
// 🕰️ لكن بعد ميزة "إنهاء ربط موظف"، حذف ربط الموظف من employee_links (ليصبح
// غير نشط) لا يعني أن سجلات حضوره القديمة يجب أن تفقد اسم الشركة! لهذا نجلب
// أيضاً أرشيف employee_link_history (الشركات السابقة + فترة العمل بكل منها)،
// ونطابق شركة كل سجل حضور حسب تاريخه: الشركة الحالية إن كان لا يزال مرتبطاً
// وقت هذا التاريخ، وإلا الشركة السابقة التي يقع هذا التاريخ ضمن فترة عملها.
let employeeById = new Map();
let companyById = new Map();

// الربط الحالي لكل موظف (employee_id -> {company_id, link_date}) من جدول employee_links
let activeLinkByEmployeeId = new Map();

// أرشيف الروابط المنتهية لكل موظف (employee_id -> [{company_id, company_name, start_date, end_date}, ...])
// مرتّبة تنازلياً حسب end_date (الأحدث أولاً)
let historyPeriodsByEmployeeId = new Map();

// 🛡️ نطاق معرّفات الموظفين المسموح بعرض سجلات حضورهم لمسؤول الشركة — null
// تعني بلا قيود (لبقية الأدوار)، وإلا مصفوفة معرّفات الموظفين المرتبطين
// (حالياً أو سابقاً وفق الأرشيف) بشركة/شركات هذا المستخدم فقط.
let scopedEmployeeIds = null;

// مخزن بيانات التقرير الكامل (ضمن نطاق التاريخ المحدد) ونسخة الفلترة الحالية
let fullAttendanceReportDataset = [];
let filteredAttendanceReportDataset = [];

// قوائم القيم المميزة (Distinct) لتغذية اقتراحات قوائم البحث
let allEmployeeNameOptions = [];
let allCompanyNameOptions = [];

// إعدادات تقسيم الصفحات
let currentAttReportPage = 1;
const attReportRowsPerPage = 10;

// =========================================================================
// 🆕 إصلاح "الفترة تظهر صحيحة ثم تُحمَّل باقي الشهور":
//
// السبب: كل تغيير بحقلي "من تاريخ" / "إلى تاريخ" يُطلق طلب جلب مستقل
// (loadAttendanceReportData). عند تعديل التاريخين تباعاً (مثلاً تغيير "من"
// أولاً فيُجلب نطاق واسع مؤقتاً: من التاريخ الجديد حتى "إلى" القديم، ثم تغيير
// "إلى" فيُجلب النطاق الصحيح الضيّق)، قد ينتهي الطلب الأضيق أولاً فتظهر الفترة
// الصحيحة، ثم ينتهي الطلب الأقدم الأوسع (الذي يضم أشهراً أكثر ويحتاج صفحات
// أكثر) متأخراً فيكتب فوق النتيجة الصحيحة ببيانات أشهر لم يطلبها المستخدم.
//
// الحل بطبقتين:
//   1) رقم تسلسلي لكل طلب (attLoadSequence): أي طلب انتهى وهو ليس الأحدث
//      يُهمَل نتيجته تماماً ولا يكتب أي شيء بالشاشة.
//   2) تأجيل قصير (debounce) لتغييرات حقلي التاريخ، فلا يُطلَق جلب لكل لمسة
//      متتابعة، بل جلب واحد بعد استقرار اختيار المستخدم.
// =========================================================================
let attLoadSequence = 0;
let attLoadDebounceTimer = null;
const ATT_DATE_CHANGE_DEBOUNCE_MS = 300;

function scheduleAttendanceReportLoad() {
    if (attLoadDebounceTimer) clearTimeout(attLoadDebounceTimer);
    attLoadDebounceTimer = setTimeout(() => {
        attLoadDebounceTimer = null;
        loadAttendanceReportData();
    }, ATT_DATE_CHANGE_DEBOUNCE_MS);
}

document.addEventListener('DOMContentLoaded', async () => {
    const allowed = await Permissions.guardPage('reports_attendance');
    if (!allowed) return;

    setDefaultMonthRange();

    setupSearchCombo({
        inputId: 'reportAttEmployeeSearchInput',
        dropdownId: 'reportAttEmployeeDropdown',
        clearLabel: 'كل الموظفين',
        emptyText: 'لا يوجد موظفون مطابقون',
        getOptions: () => allEmployeeNameOptions,
        onQueryChange: applyAttendanceReportFilters
    });

    setupSearchCombo({
        inputId: 'reportAttCompanySearchInput',
        dropdownId: 'reportAttCompanyDropdown',
        clearLabel: 'كل الشركات',
        emptyText: 'لا توجد شركات مطابقة',
        getOptions: () => allCompanyNameOptions,
        onQueryChange: applyAttendanceReportFilters
    });

    const statusFilter = document.getElementById('reportAttStatusFilter');
    if (statusFilter) statusFilter.addEventListener('change', applyAttendanceReportFilters);

    const fromDate = document.getElementById('reportFromDateInput');
    const toDate = document.getElementById('reportToDateInput');
    if (fromDate) fromDate.addEventListener('change', scheduleAttendanceReportLoad);
    if (toDate) toDate.addEventListener('change', scheduleAttendanceReportLoad);

    const btnExport = document.getElementById('btnExportExcel');
    if (btnExport) btnExport.addEventListener('click', exportAttendanceReportToExcel);

    const btnPrint = document.getElementById('btnPrintReport');
    if (btnPrint) btnPrint.addEventListener('click', printAttendanceReport);

    await loadCurrentUserScope();
    await loadEmployeesAndCompanies();
    await loadAttendanceReportData();
});

function setDefaultMonthRange() {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    document.getElementById('reportFromDateInput').value = toDateInputValue(firstDay);
    document.getElementById('reportToDateInput').value = toDateInputValue(lastDay);
}

function toDateInputValue(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// =========================================================================
// 1ب. مكوّن قائمة بحث قابلة للكتابة فيها (Searchable Filter Combobox)
//     أداة تصفية حرة للتقرير: كتابة حرة للبحث الفوري أو اختيار اقتراح جاهز
//     من القائمة المنسدلة أسفل الحقل (نفس منطق تقرير الموظفين/الشركات).
// =========================================================================
function setupSearchCombo({ inputId, dropdownId, clearLabel, emptyText, getOptions, onQueryChange }) {
    const input = document.getElementById(inputId);
    const dropdown = document.getElementById(dropdownId);
    if (!input || !dropdown) return;

    function renderSuggestions(query) {
        const normalized = (query || '').trim().toLowerCase();
        const options = getOptions() || [];
        const matches = normalized
            ? options.filter(opt => opt.toLowerCase().includes(normalized))
            : options;

        dropdown.innerHTML = '';

        const clearItem = document.createElement('div');
        clearItem.className = 'combo-item combo-item-clear';
        clearItem.textContent = `✕ ${clearLabel}`;
        clearItem.addEventListener('mousedown', (e) => {
            e.preventDefault();
            input.value = '';
            closeDropdown();
            onQueryChange();
        });
        dropdown.appendChild(clearItem);

        if (matches.length === 0) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'combo-empty';
            emptyEl.textContent = emptyText || 'لا توجد نتائج مطابقة';
            dropdown.appendChild(emptyEl);
            return;
        }

        matches.slice(0, 30).forEach(label => {
            const item = document.createElement('div');
            item.className = 'combo-item';
            if (input.value.trim() === label) item.classList.add('selected');
            item.textContent = label;
            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                input.value = label;
                closeDropdown();
                onQueryChange();
            });
            dropdown.appendChild(item);
        });
    }

    function openDropdown() {
        renderSuggestions(input.value);
        dropdown.classList.add('open');
    }
    function closeDropdown() { dropdown.classList.remove('open'); }

    input.addEventListener('focus', () => openDropdown());
    input.addEventListener('input', () => {
        renderSuggestions(input.value);
        dropdown.classList.add('open');
        onQueryChange();
    });
    input.addEventListener('blur', () => { setTimeout(closeDropdown, 150); });

    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !dropdown.contains(e.target)) closeDropdown();
    });
}

// =========================================================================
// 2. تحميل الموظفين والشركات (لغرض الربط فقط، لا تتأثر بنطاق التاريخ)، وتحميل
//    شركة كل موظف (الحالية + الأرشيف السابق) لتغذية resolveCompanyForEmployeeAtDate
//
//    🛡️ نطاق الرؤية: لمسؤول الشركة (currentUserScope.companyIds مصفوفة محددة)،
//    تُقيَّد استعلامات الشركات (.in('id', ...)) والربط النشط والأرشيف
//    (.in('company_id', ...)) بشركاته المملوكة فقط. جدول employees نفسه يبقى
//    غير مُقيَّد هنا (يُستخدم فقط كمعجم أسماء)؛ التقييد الفعلي لسجلات الحضور
//    يتم لاحقاً عبر scopedEmployeeIds (مشتقة من الربط/الأرشيف المُقيَّدين هنا).
//
//    ⚠️ linksQuery مُقيَّد أيضاً بالروابط النشطة فقط (getTodayDateStringForLinks)
//    حتى تبقى activeLinkByEmployeeId ممثّلة فعلياً لـ"الربط الحالي" فقط كما
//    تفترض resolveCompanyForEmployeeAtDate أدناه (وإلا فقد يحتوي الاستعلام
//    على أكثر من صف لنفس الموظف بعد تحويل "إنهاء الربط" لتعليم بتاريخ بدل
//    حذف، فيُختار صف عشوائي غير مضمون كونه الربط النشط الفعلي).
// =========================================================================
async function loadEmployeesAndCompanies() {
    try {
        let companiesQuery = dbClient.from('companies').select('id, name');
        let linksQuery = dbClient
            .from('employee_links')
            .select('employee_id, company_id, link_date')
            .or(`link_end_date.is.null,link_end_date.gte.${getTodayDateStringForLinks()}`);
        if (currentUserScope.companyIds !== null) {
            companiesQuery = companiesQuery.in('id', currentUserScope.companyIds);
            linksQuery = linksQuery.in('company_id', currentUserScope.companyIds);
        }

        const [employeesResult, companiesResult, linksResult] = await Promise.all([
            dbClient.from('employees').select('id, name'),
            companiesQuery,
            linksQuery
        ]);

        if (employeesResult.error) throw employeesResult.error;
        if (companiesResult.error) throw companiesResult.error;
        if (linksResult.error) throw linksResult.error;

        employeeById = new Map((employeesResult.data || []).map(e => [String(e.id), e]));
        companyById = new Map((companiesResult.data || []).map(c => [String(c.id), c]));
        activeLinkByEmployeeId = new Map((linksResult.data || []).map(l => [String(l.employee_id), l]));
    } catch (error) {
        console.error('تعذّر تحميل بيانات الموظفين/الشركات:', error.message);
    }

    // أرشيف الروابط المنتهية — طلب منفصل غير معطِّل: لو الجدول غير موجود بعد
    // (لم يُشغَّل سكربت SQL الخاص به) نكتفي بتسجيل الخطأ بالكونسول ونُكمل
    // بخريطة فارغة، بدل إيقاف تحميل بيانات الموظفين/الشركات الأساسية بالكامل.
    let historyRows = [];
    try {
        let historyQuery = dbClient
            .from('employee_link_history')
            .select('employee_id, company_id, company_name, start_date, end_date');
        if (currentUserScope.companyIds !== null) historyQuery = historyQuery.in('company_id', currentUserScope.companyIds);

        const { data, error: historyError } = await historyQuery;
        if (historyError) throw historyError;
        historyRows = data || [];

        historyPeriodsByEmployeeId = new Map();
        historyRows.forEach(row => {
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

    // 🛡️ بناء نطاق معرّفات الموظفين المسموح بها لمسؤول الشركة: اتحاد الموظفين
    // الظاهرين بالربط النشط المُقيَّد + الموظفين الظاهرين بأرشيف الروابط
    // المُقيَّد أعلاه (كلاهما مُقيَّدان بالفعل بشركاته المملوكة فقط).
    if (currentUserScope.companyIds !== null) {
        const idSet = new Set();
        activeLinkByEmployeeId.forEach((link, key) => idSet.add(key));
        historyRows.forEach(row => { if (row.employee_id != null) idSet.add(String(row.employee_id)); });
        scopedEmployeeIds = Array.from(idSet);
    } else if (currentUserScope.employeeId !== null) {
        // 🛡️ دور "موظف": تقييد صريح بسجله الشخصي فقط (انظر تعليق loadCurrentUserScope أعلاه)
        scopedEmployeeIds = [String(currentUserScope.employeeId)];
    } else {
        scopedEmployeeIds = null;
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
// 3. جلب سجلات الحضور ضمن نطاق التاريخ المحدد وربطها بالموظف/الشركة
//
//    ⚠️ سوبابيس (PostgREST) يفرض حداً افتراضياً على عدد الصفوف المُعادة بكل
//    طلب (1000 صف عادةً)، وهذا الحد لا علاقة له بعدد سجلات الحضور الفعلي —
//    فإن تجاوزت السجلات ضمن نطاق التاريخ هذا الحد كانت تُقتطع صامتة ولا تظهر
//    كل البيانات بالجدول (وهو سبب المشكلة). لذا تُجلب السجلات الآن على دفعات
//    (صفحات من 1000 صف) عبر fetchAllAttendanceRows حتى تكتمل كل السجلات مهما
//    بلغ عددها، بدل طلب واحد قد يُقتطع.
//
//    🛡️ نطاق الرؤية: لمسؤول الشركة (scopedEmployeeIds مصفوفة محددة)، تُقيَّد
//    سجلات الحضور المجلوبة بـ .in('employee_id', scopedEmployeeIds) فقط.
// =========================================================================
const SUPABASE_FETCH_PAGE_SIZE = 1000;

async function fetchAllAttendanceRows(fromDate, toDate) {
    let allRows = [];
    let from = 0;

    while (true) {
        let query = dbClient
            .from('attendance')
            .select('*')
            .order('date', { ascending: true })
            .order('id', { ascending: true }) // ترتيب ثانوي حاسم لضمان تسلسل صفحات ثابت بلا تكرار أو نقص
            .range(from, from + SUPABASE_FETCH_PAGE_SIZE - 1);

        if (fromDate) query = query.gte('date', fromDate);
        if (toDate) query = query.lte('date', toDate);
        if (scopedEmployeeIds !== null) query = query.in('employee_id', scopedEmployeeIds);

        const { data, error } = await query;
        if (error) throw error;

        allRows = allRows.concat(data || []);

        if (!data || data.length < SUPABASE_FETCH_PAGE_SIZE) break; // آخر صفحة
        from += SUPABASE_FETCH_PAGE_SIZE;
    }

    return allRows;
}

async function loadAttendanceReportData() {
    const tableBody = document.getElementById('reportTableBody');
    const fromDate = document.getElementById('reportFromDateInput').value;
    const toDate = document.getElementById('reportToDateInput').value;

    // 🆕 رقم هذا الطلب — أي طلب أحدث يبطل نتيجة هذا الطلب (انظر الشرح أعلاه)
    const requestId = ++attLoadSequence;
    const isStale = () => requestId !== attLoadSequence;

    try {
        // 🛡️ مسؤول الشركة بلا أي موظف مرتبط (حالياً أو سابقاً) بشركاته المملوكة
        // — لا داعي لأي طلب شبكة، التقرير فارغ
        if (scopedEmployeeIds !== null && scopedEmployeeIds.length === 0) {
            fullAttendanceReportDataset = [];
            allEmployeeNameOptions = [];
            allCompanyNameOptions = [];
            applyAttendanceReportFilters();
            return;
        }

        // 🆕 مؤشر تحميل واضح أثناء الجلب بدل إبقاء بيانات الفترة السابقة ظاهرة
        // (تُلغي الالتباس بين نتيجة قديمة ونتيجة الفترة المطلوبة)
        if (tableBody) {
            tableBody.innerHTML = `<tr><td colspan="7" class="table-loading-state">جاري جلب بيانات التقرير...</td></tr>`;
        }

        const attendanceRows = await fetchAllAttendanceRows(fromDate, toDate);
        if (isStale()) return; // طلب أحدث (نطاق تاريخ مختلف) بدأ بعد هذا — أهمل نتيجته

        let mappedDataset = (attendanceRows || []).map(record => {
            const employee = record.employee_id != null ? employeeById.get(String(record.employee_id)) : null;
            const resolvedCompany = record.employee_id != null
                ? resolveCompanyForEmployeeAtDate(record.employee_id, record.date)
                : { id: '', name: '—' };

            return {
                id: record.id,
                employee_name: employee ? (employee.name || '----') : 'موظف محذوف',
                company_id: resolvedCompany.id,
                company_name: resolvedCompany.name,
                date: record.date,
                check_in: record.check_in,
                check_out: record.check_out,
                hours: record.hours,
                status: normalizeStatus(record.status)
            };
        });

        // 💳 مسؤول الشركة: إخفاء سجلات أي شهر لم تُصدَر له فاتورة مدفوعة بعد —
        // انظر تعليق getPaidMonthsMapForCompanies أعلى الملف
        if (currentUserScope.role === 'company') {
            const paidMonthsMap = await getPaidMonthsMapForCompanies(currentUserScope.companyIds);
            if (isStale()) return;
            mappedDataset = mappedDataset.filter(record => isRecordDateInPaidMonth(paidMonthsMap, record.company_id, record.date));
        }

        // ✅ لا تُكتب أي نتيجة بالمتغيرات العامة إلا بعد التأكد أن هذا هو أحدث طلب
        fullAttendanceReportDataset = mappedDataset;

        allEmployeeNameOptions = distinctSorted(fullAttendanceReportDataset.map(r => r.employee_name).filter(n => n !== 'موظف محذوف'));
        allCompanyNameOptions = distinctSorted(fullAttendanceReportDataset.map(r => r.company_name).filter(n => n !== '—'));

        applyAttendanceReportFilters();

    } catch (error) {
        if (isStale()) return;
        console.error('فشل جلب بيانات تقرير الحضور:', error.message);
        if (tableBody) {
            tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#ef4444; padding:20px;">تعذّر تحميل بيانات التقرير: ${error.message}</td></tr>`;
        }
    }
}

function normalizeStatus(rawStatus) {
    if (!rawStatus) return 'حاضر';
    const val = String(rawStatus).toLowerCase();
    if (val === 'present' || rawStatus === 'حاضر') return 'حاضر';
    if (val === 'absent' || rawStatus === 'غائب') return 'غائب';
    if (val === 'late' || rawStatus === 'متأخر') return 'متأخر';
    if (val === 'annual_leave' || rawStatus === 'إجازة سنوية') return 'إجازة سنوية';
    return rawStatus;
}

function distinctSorted(values) {
    return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ar'));
}

// =========================================================================
// 4. تطبيق الفلاتر: اسم الموظف + اسم الشركة + الحالة (نطاق التاريخ مطبَّق
//    مسبقاً عبر الجلب من قاعدة البيانات)
// =========================================================================
function applyAttendanceReportFilters() {
    const nameQuery = (document.getElementById('reportAttEmployeeSearchInput')?.value || '').toLowerCase().trim();
    const companyQuery = (document.getElementById('reportAttCompanySearchInput')?.value || '').toLowerCase().trim();
    const statusValue = document.getElementById('reportAttStatusFilter')?.value || 'all';

    filteredAttendanceReportDataset = fullAttendanceReportDataset.filter(row => {
        const matchesName = !nameQuery || row.employee_name.toLowerCase().includes(nameQuery);
        const matchesCompany = !companyQuery || row.company_name.toLowerCase().includes(companyQuery);
        const matchesStatus = statusValue === 'all' || row.status === statusValue;

        return matchesName && matchesCompany && matchesStatus;
    });

    currentAttReportPage = 1;
    renderAttendanceReportTable(filteredAttendanceReportDataset);
}

// =========================================================================
// 5. بناء جدول التقرير (وضع الشاشة: مع تقسيم صفحات)
// =========================================================================
function renderAttendanceReportTable(data) {
    const tableBody = document.getElementById('reportTableBody');
    const resultsCountEl = document.getElementById('reportResultsCount');
    if (!tableBody) return;

    if (resultsCountEl) {
        resultsCountEl.textContent = `عدد النتائج المطابقة: ${data.length}`;
    }

    if (!data || data.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; color:#94a3b8;">لا توجد سجلات مطابقة لخيارات البحث الحالية.</td></tr>`;
        setupAttReportPaginationControls(0);
        return;
    }

    const startIndex = (currentAttReportPage - 1) * attReportRowsPerPage;
    const endIndex = startIndex + attReportRowsPerPage;
    const paginatedData = data.slice(startIndex, endIndex);

    tableBody.innerHTML = paginatedData.map(row => buildAttendanceReportRowHtml(row)).join('');
    if (window.applyIconPlaceholders) applyIconPlaceholders(tableBody); // تعبئة أيقونات SVG بالاستايل الجديد بدل الإيموجي

    setupAttReportPaginationControls(data.length);
}

// 🎨 أيقونات SVG موحّدة بدل الإيموجي (نفس أيقونات تقرير المهام): "person"
// للموظف، "building" للشركة، "calendar" للتاريخ. نقطة الحالة الملوّنة تستخدم
// أيقونات "dot-*" الجاهزة بمكتبة الأيقونات (نفس دلالة ألوان شارة الحالة
// badge-att-* أدناه: أخضر=حاضر، أحمر=غائب، برتقالي=متأخر، أزرق=إجازة سنوية).
const STATUS_DOT_ICON = {
    'غائب': 'dot-red',
    'متأخر': 'dot-orange',
    'إجازة سنوية': 'dot-blue',
    'حاضر': 'dot-green'
};

function buildAttendanceReportRowHtml(row) {
    const badgeClass = row.status === 'غائب' ? 'badge-att-absent' : (row.status === 'متأخر' ? 'badge-att-late' : (row.status === 'إجازة سنوية' ? 'badge-att-leave' : 'badge-att-present'));
    const badgeIconName = STATUS_DOT_ICON[row.status] || 'dot-green';
    const hoursDisplay = (row.hours === null || row.hours === undefined || row.hours === '') ? '—' : Number(row.hours).toFixed(2);

    return `
        <tr>
            <td><strong style="color:#1e293b;"><span data-icon="person"></span> ${row.employee_name}</strong></td>
            <td style="color:#334155;"><span data-icon="building"></span> ${row.company_name}</td>
            <td style="color:#475569;"><span data-icon="calendar"></span> ${row.date}</td>
            <td style="font-weight:600; color:#475569;">${row.check_in || '--:--:--'}</td>
            <td style="font-weight:600; color:#475569;">${row.check_out || '--:--:--'}</td>
            <td style="text-align:center; font-weight:600; color:#64748b;">${hoursDisplay}</td>
            <td style="text-align:center;"><span class="badge-att-status ${badgeClass}"><span data-icon="${badgeIconName}"></span> ${row.status}</span></td>
        </tr>
    `;
}

// =========================================================================
// 6. أزرار التنقل بين صفحات التقرير
// =========================================================================
function setupAttReportPaginationControls(totalItems) {
    const controlsContainer = document.getElementById('reportPagination');
    if (!controlsContainer) return;
    controlsContainer.innerHTML = '';

    const totalPages = Math.ceil(totalItems / attReportRowsPerPage);
    if (totalPages <= 1) return;

    const prevBtn = document.createElement('button');
    prevBtn.innerHTML = '&rarr; السابقة';
    prevBtn.disabled = currentAttReportPage === 1;
    prevBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;';
    if (prevBtn.disabled) prevBtn.style.opacity = '0.5';
    prevBtn.onclick = () => {
        if (currentAttReportPage > 1) {
            currentAttReportPage--;
            renderAttendanceReportTable(filteredAttendanceReportDataset);
        }
    };
    controlsContainer.appendChild(prevBtn);

    const countLabel = document.createElement('span');
    countLabel.style.cssText = 'font-size: 0.9rem; color: #475569; font-weight: 600; margin: 0 10px;';
    countLabel.textContent = `صفحة ${currentAttReportPage} من ${totalPages}`;
    controlsContainer.appendChild(countLabel);

    const nextBtn = document.createElement('button');
    nextBtn.innerHTML = 'التالية &larr;';
    nextBtn.disabled = currentAttReportPage === totalPages;
    nextBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;';
    if (nextBtn.disabled) nextBtn.style.opacity = '0.5';
    nextBtn.onclick = () => {
        if (currentAttReportPage < totalPages) {
            currentAttReportPage++;
            renderAttendanceReportTable(filteredAttendanceReportDataset);
        }
    };
    controlsContainer.appendChild(nextBtn);
}

// =========================================================================
// 7. تصدير التقرير الكامل (بعد الفلترة) إلى ملف Excel عبر مكتبة SheetJS
// =========================================================================
function exportAttendanceReportToExcel() {
    if (!filteredAttendanceReportDataset || filteredAttendanceReportDataset.length === 0) {
        alert('لا توجد بيانات لتصديرها بناءً على خيارات البحث الحالية.');
        return;
    }

    const headers = ['موظف', 'الشركة', 'التاريخ', 'دخول', 'خروج', 'ساعات العمل', 'الحالة'];

    const rows = filteredAttendanceReportDataset.map(row => [
        row.employee_name,
        row.company_name,
        row.date,
        row.check_in || '--:--:--',
        row.check_out || '--:--:--',
        (row.hours === null || row.hours === undefined || row.hours === '') ? '—' : Number(row.hours).toFixed(2),
        row.status
    ]);

    const worksheetData = [headers, ...rows];
    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

    worksheet['!cols'] = [
        { wch: 22 }, { wch: 22 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 12 }
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'تقرير الحضور والانصراف');

    const now = new Date();
    const dateSuffix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    XLSX.writeFile(workbook, `تقرير_الحضور_والانصراف_${dateSuffix}.xlsx`);
}

// =========================================================================
// 8. طباعة التقرير: تصميم احترافي كامل (ترويسة بالشركة + رمز QR + رقم مستند
//    + جدول بترويسة زرقاء + علامة مائية متكررة + تذييل برقم الصفحة)، يُبنى
//    ديناميكياً داخل #printPagesRoot عبر الوحدة المشتركة print-report.js
//    ثم يُستدعى window.print(). رمز QR يشير لصفحة عرض عامة (view_report.html)
//    تعرض نفس التقرير لأي شخص يمسحه دون تسجيل دخول — عبر لقطة تُحفظ بجدول
//    report_snapshots (يتطلب تنفيذ سكربت SQL المرفق مرة واحدة بسوبابيس؛
//    وإن لم يُنفَّذ بعد، تستمر الطباعة بشكل طبيعي لكن بدون رمز QR فعّال).
// =========================================================================
async function printAttendanceReport() {
    if (!filteredAttendanceReportDataset || filteredAttendanceReportDataset.length === 0) {
        alert('لا توجد بيانات لطباعتها بناءً على خيارات البحث الحالية.');
        return;
    }

    const printRoot = document.getElementById('printPagesRoot');
    if (!printRoot || !window.PrintReport) {
        window.print();
        return;
    }

    const docNumber = window.PrintReport.generateReportDocNumber();
    const reportDateText = window.PrintReport.formatDateDDMMYYYY(new Date());
    const singleCompanyLabel = detectSingleCompanyLabel(filteredAttendanceReportDataset);
    const companyLabel = singleCompanyLabel || 'بصمة الأعمال';
    const showCompanyColumn = !singleCompanyLabel;

    let qrDataUrl = null;
    try {
        const { data: snapshot, error: snapshotError } = await dbClient
            .from('report_snapshots')
            .insert({
                doc_number: docNumber,
                report_title: 'تقرير الحضور والانصراف',
                company_name: singleCompanyLabel,
                show_company_column: showCompanyColumn,
                report_date_text: reportDateText,
                rows: filteredAttendanceReportDataset
            })
            .select('id')
            .single();

        if (snapshotError) throw snapshotError;

        const viewUrl = `${window.location.origin}${window.location.pathname.replace('attendance-report.html', 'view_report.html')}?id=${snapshot.id}`;
        qrDataUrl = await window.PrintReport.generateReportQrDataUrl(viewUrl);
    } catch (error) {
        console.error('تعذّر إنشاء نسخة قابلة للعرض عبر رمز QR (تأكد من تنفيذ سكربت إنشاء جدول report_snapshots بسوبابيس):', error.message);
    }

    printRoot.innerHTML = window.PrintReport.buildAttendanceReportPrintPagesHtml({
        docNumber,
        companyLabel,
        reportDateText,
        showCompanyColumn,
        rows: filteredAttendanceReportDataset,
        qrDataUrl
    });

    window.print();
}

// إن كانت كل سجلات التقرير المفلترة الحالية تخص شركة واحدة فقط، تُعاد كاسمها
// (لعرضها بترويسة الطباعة كما بالنموذج المرجعي)، وإلا تُعاد null (تقرير متعدد الشركات)
function detectSingleCompanyLabel(rows) {
    const names = new Set(rows.map(r => r.company_name).filter(n => n && n !== '—'));
    if (names.size === 1) return Array.from(names)[0];
    return null;
}

window.addEventListener('afterprint', () => {
    const printRoot = document.getElementById('printPagesRoot');
    if (printRoot) printRoot.innerHTML = '';
});