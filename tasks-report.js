// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================
const SUPABASE_URL = "https://mcdhxdfkuokhmhtfvjev.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_yt9V8lsNU1zN3Ix2CvovbQ_QCA2VDdM";
const dbClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 🛡️ نفس منطق نطاق الرؤية المستخدم بشاشة "إدارة المهام": مسؤول الشركة
// (role='company') يرى فقط مهام شركته/شركاته المملوكة، بينما super_admin/admin
// يريان كل المهام بلا قيود.
let currentUserScope = { role: null, companyIds: null };

async function loadCurrentUserScope() {
    try {
        const { data: { session } } = await dbClient.auth.getSession();
        if (!session) return;

        const { data: profileRow } = await dbClient.from('users').select('role').eq('id', session.user.id).maybeSingle();
        const role = profileRow?.role || null;

        if (role === 'company') {
            const { data: ownedCompanies } = await dbClient.from('companies').select('id').eq('user_id', session.user.id);
            currentUserScope = { role, companyIds: (ownedCompanies || []).map(c => c.id) };
        } else {
            currentUserScope = { role, companyIds: null };
        }
    } catch (error) {
        console.error('تعذّر تحديد نطاق صلاحيات المستخدم الحالي:', error.message);
    }
}

// =========================================================================
// 💳 قيد "الأشهر المدفوعة فقط" لمسؤول الشركة: لا يرى مسؤول الشركة مهام أي
// شهر (حسب due_date) لم تُصدَر له فاتورة بحالة "مدفوعة" (paid) بعد — يشمل
// هذا الشهر الجاري لو لم تصدر فاتورته بعد (بلا استثناء)، وأي مهمة بلا
// due_date أيضاً (لا يمكن التحقق من شهرها). نفس الآلية المستخدمة بـ tasks.js
// و attendance.js تماماً — "شهر الفاتورة" = شهر/سنة invoice_date نفسه (لا
// يوجد عمود فترة صريح بجدول invoices).
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
                .range(from, from + TASKS_FETCH_PAGE_SIZE - 1);
            if (error) throw error;
            (data || []).forEach(row => {
                if (!row.invoice_date || row.company_id == null) return;
                const key = String(row.company_id);
                if (!map.has(key)) map.set(key, new Set());
                map.get(key).add(String(row.invoice_date).slice(0, 7));
            });
            if (!data || data.length < TASKS_FETCH_PAGE_SIZE) break;
            from += TASKS_FETCH_PAGE_SIZE;
        }
    } catch (error) {
        console.error('تعذّر تحديد الأشهر المدفوعة لكل شركة:', error.message);
    }
    return map;
}

function isRecordDateInPaidMonth(paidMonthsMap, companyId, dateStr) {
    if (!dateStr || companyId == null) return false;
    const set = paidMonthsMap.get(String(companyId));
    if (!set) return false;
    return set.has(String(dateStr).slice(0, 7));
}

let companiesById = new Map();

// مخزن بيانات التقرير الكامل (ضمن نطاق تاريخ الاستحقاق المحدد) ونسخة الفلترة الحالية
let fullTasksReportDataset = [];
let filteredTasksReportDataset = [];

// قوائم القيم المميزة (Distinct) لتغذية اقتراحات قوائم البحث
let allEmployeeNameOptions = [];
let allCompanyNameOptions = [];

// إعدادات تقسيم الصفحات
let currentTaskReportPage = 1;
const taskReportRowsPerPage = 10;

const TASK_TYPE_FILTER_OPTIONS = [
    { value: 'all', label: 'النوع: الكل' },
    { value: 'مسندة', label: 'مسندة' },
    { value: 'مستقلة', label: 'مستقلة' },
    { value: 'روتينية', label: 'روتينية' }
];
const TASK_STATUS_FILTER_OPTIONS = [
    { value: 'all', label: 'الحالة: الكل' },
    { value: 'قيد الانتظار', label: 'قيد الانتظار' },
    { value: 'قيد التنفيذ', label: 'قيد التنفيذ' },
    { value: 'مكتملة', label: 'مكتملة' }
];

// =========================================================================
// 🆕 إصلاح "الفترة تظهر صحيحة ثم تُحمَّل باقي الشهور":
//
// السبب: كل تغيير بحقلي "من تاريخ" / "إلى تاريخ" يُطلق طلب جلب مستقل
// (loadTasksReportData). عند تعديل التاريخين تباعاً (مثلاً تغيير "من" أولاً
// فيُجلب نطاق واسع مؤقتاً: من التاريخ الجديد حتى "إلى" القديم، ثم تغيير
// "إلى" فيُجلب النطاق الصحيح الضيّق)، قد ينتهي الطلب الأضيق أولاً فتظهر الفترة
// الصحيحة، ثم ينتهي الطلب الأقدم الأوسع (الذي يضم أشهراً أكثر) متأخراً فيكتب
// فوق النتيجة الصحيحة ببيانات أشهر لم يطلبها المستخدم.
//
// الحل بطبقتين:
//   1) رقم تسلسلي لكل طلب (tasksLoadSequence): أي طلب انتهى وهو ليس الأحدث
//      تُهمَل نتيجته تماماً ولا يكتب أي شيء بالشاشة.
//   2) تأجيل قصير (debounce) لتغييرات حقلي التاريخ، فلا يُطلَق جلب لكل لمسة
//      متتابعة، بل جلب واحد بعد استقرار اختيار المستخدم.
// =========================================================================
let tasksLoadSequence = 0;
let tasksLoadDebounceTimer = null;
const TASKS_DATE_CHANGE_DEBOUNCE_MS = 300;

function scheduleTasksReportLoad() {
    if (tasksLoadDebounceTimer) clearTimeout(tasksLoadDebounceTimer);
    tasksLoadDebounceTimer = setTimeout(() => {
        tasksLoadDebounceTimer = null;
        loadTasksReportData();
    }, TASKS_DATE_CHANGE_DEBOUNCE_MS);
}

document.addEventListener('DOMContentLoaded', async () => {
    const allowed = await Permissions.guardPage('reports_tasks');
    if (!allowed) return;

    setDefaultMonthRange();

    setupSearchCombo({
        inputId: 'reportTaskEmployeeSearchInput',
        dropdownId: 'reportTaskEmployeeDropdown',
        clearLabel: 'كل الموظفين',
        emptyText: 'لا يوجد موظفون مطابقون',
        getOptions: () => allEmployeeNameOptions,
        onQueryChange: applyTasksReportFilters
    });

    setupSearchCombo({
        inputId: 'reportTaskCompanySearchInput',
        dropdownId: 'reportTaskCompanyDropdown',
        clearLabel: 'كل الشركات',
        emptyText: 'لا توجد شركات مطابقة',
        getOptions: () => allCompanyNameOptions,
        onQueryChange: applyTasksReportFilters
    });

    setupSelectCombo({
        inputId: 'reportTaskTypeFilterSearch',
        hiddenId: 'reportTaskTypeFilterId',
        dropdownId: 'reportTaskTypeFilterDropdown',
        options: TASK_TYPE_FILTER_OPTIONS,
        onSelect: applyTasksReportFilters
    });
    document.getElementById('reportTaskTypeFilterSearch').value = 'النوع: الكل';

    setupSelectCombo({
        inputId: 'reportTaskStatusFilterSearch',
        hiddenId: 'reportTaskStatusFilterId',
        dropdownId: 'reportTaskStatusFilterDropdown',
        options: TASK_STATUS_FILTER_OPTIONS,
        onSelect: applyTasksReportFilters
    });
    document.getElementById('reportTaskStatusFilterSearch').value = 'الحالة: الكل';

    const fromDate = document.getElementById('reportFromDateInput');
    const toDate = document.getElementById('reportToDateInput');
    if (fromDate) fromDate.addEventListener('change', scheduleTasksReportLoad);
    if (toDate) toDate.addEventListener('change', scheduleTasksReportLoad);

    const btnExport = document.getElementById('btnExportExcel');
    if (btnExport) btnExport.addEventListener('click', exportTasksReportToExcel);

    const btnPrint = document.getElementById('btnPrintReport');
    if (btnPrint) btnPrint.addEventListener('click', printTasksReport);

    await loadCurrentUserScope();
    await loadCompanies();
    await loadTasksReportData();
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
// 1ب. مكوّن قائمة بحث حرة (Searchable Filter Combobox) — بحث اسم الموظف/الشركة
//     (نفس منطق تقرير الحضور والانصراف: كتابة حرة للبحث الفوري أو اختيار
//     اقتراح جاهز من القائمة المنسدلة أسفل الحقل)
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
// 1ج. مكوّن قائمة اختيار حصري (Select Combobox) — فلترا النوع/الحالة
//     (نفس منطق شاشة "إدارة المهام": اختيار من قيم ثابتة فقط، لا كتابة حرة)
// =========================================================================
function setupSelectCombo({ inputId, hiddenId, dropdownId, options, onSelect }) {
    const input = document.getElementById(inputId);
    const hidden = document.getElementById(hiddenId);
    const dropdown = document.getElementById(dropdownId);
    if (!input || !hidden || !dropdown) return;

    function renderOptions(filterText) {
        const normalized = (filterText || '').trim().toLowerCase();
        const filtered = normalized ? options.filter(opt => opt.label.toLowerCase().includes(normalized)) : options;

        dropdown.innerHTML = '';
        if (filtered.length === 0) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'combo-empty';
            emptyEl.textContent = 'لا توجد نتائج مطابقة';
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
                input.value = opt.label;
                closeDropdown();
                onSelect();
            });
            dropdown.appendChild(item);
        });
    }

    function openDropdown() { renderOptions(''); dropdown.classList.add('open'); }
    function closeDropdown() { dropdown.classList.remove('open'); }
    function getSelectedLabel() {
        const match = options.find(opt => String(opt.value) === String(hidden.value));
        return match ? match.label : '';
    }

    input.addEventListener('focus', () => { input.select(); openDropdown(); });
    input.addEventListener('input', () => { renderOptions(input.value); dropdown.classList.add('open'); });
    input.addEventListener('blur', () => { setTimeout(() => { input.value = getSelectedLabel(); closeDropdown(); }, 120); });
    document.addEventListener('click', (e) => { if (!input.contains(e.target) && !dropdown.contains(e.target)) closeDropdown(); });
}

// =========================================================================
// 2. تحميل الشركات (ضمن نطاق رؤية المستخدم) — للربط بمعرّف الشركة فقط
// =========================================================================
async function loadCompanies() {
    try {
        let query = dbClient.from('companies').select('id, name').order('name', { ascending: true });
        if (currentUserScope.companyIds !== null) {
            if (currentUserScope.companyIds.length === 0) {
                companiesById = new Map();
                return;
            }
            query = query.in('id', currentUserScope.companyIds);
        }

        const { data, error } = await query;
        if (error) throw error;

        companiesById = new Map((data || []).map(c => [String(c.id), c]));
    } catch (error) {
        console.error('تعذّر تحميل قائمة الشركات:', error.message);
    }
}

// =========================================================================
// 3. جلب المهام ضمن نطاق تاريخ الاستحقاق المحدد (وضمن نطاق رؤية المستخدم)،
//    وربطها باسم/مسمى الموظف المُسنَد إليه واسم الشركة للعرض
//
//    ⚠️ نفس مشكلة تقرير الحضور والانصراف: سوبابيس (PostgREST) يفرض حداً
//    افتراضياً 1000 صف كحد أقصى لكل طلب — أي طلب مهام يتجاوز هذا العدد ضمن
//    نطاق التاريخ المحدد كان يُقتطع صامتاً فلا تظهر كل المهام بالجدول. لذا
//    تُجلب المهام الآن على دفعات (صفحات من 1000 صف) عبر fetchAllTasksRows
//    حتى تكتمل كل المهام مهما بلغ عددها، بدل طلب واحد قد يُقتطع.
//
//    ⚠️ إصلاح جوهري: "تاريخ الاستحقاق" حقل اختياري بجدول المهام — كثير من
//    المهام (خصوصاً المستقلة/الروتينية) لا تحمل تاريخ استحقاق إطلاقاً
//    (due_date = NULL). كان الفلتر السابق يستخدم .gte()/.lte() مباشرة على
//    due_date، وهذا يُقصي هذه المهام تماماً من أي نطاق تاريخ مهما اتُّسع —
//    لأن NULL لا يحقّق أي مقارنة >=/<= في SQL أصلاً، فتظهر الشاشة فارغة أو
//    تُخفي جزءاً كبيراً من المهام دون أي خطأ ظاهر. الحل: عند تحديد نطاق
//    تاريخ، تُضم المهام بلا تاريخ استحقاق دائماً (عبر .or() مع due_date IS
//    NULL) بدل استبعادها — يطابق هذا سلوك عرضها بالجدول أصلاً (عمود التاريخ
//    يعرض "—" لها بدل تركها مخفية بصمت).
// =========================================================================
const TASKS_FETCH_PAGE_SIZE = 1000;

async function fetchAllTasksRows(fromDate, toDate) {
    let allRows = [];
    let from = 0;

    while (true) {
        let query = dbClient
            .from('tasks')
            .select('*')
            .order('due_date', { ascending: true })
            .order('id', { ascending: true }) // ترتيب ثانوي حاسم لضمان تسلسل صفحات ثابت بلا تكرار أو نقص
            .range(from, from + TASKS_FETCH_PAGE_SIZE - 1);

        if (currentUserScope.companyIds !== null) query = query.in('company_id', currentUserScope.companyIds);

        // نطاق تاريخ الاستحقاق: تُضم المهام بلا تاريخ استحقاق (NULL) دائماً
        // بغض النظر عن النطاق المحدد — انظر الشرح أعلاه
        if (fromDate && toDate) {
            query = query.or(`due_date.is.null,and(due_date.gte.${fromDate},due_date.lte.${toDate})`);
        } else if (fromDate) {
            query = query.or(`due_date.is.null,due_date.gte.${fromDate}`);
        } else if (toDate) {
            query = query.or(`due_date.is.null,due_date.lte.${toDate}`);
        }

        const { data, error } = await query;
        if (error) throw error;

        allRows = allRows.concat(data || []);

        if (!data || data.length < TASKS_FETCH_PAGE_SIZE) break; // آخر صفحة
        from += TASKS_FETCH_PAGE_SIZE;
    }

    return allRows;
}

async function loadTasksReportData() {
    const tableBody = document.getElementById('reportTableBody');
    const fromDate = document.getElementById('reportFromDateInput').value;
    const toDate = document.getElementById('reportToDateInput').value;

    // 🆕 رقم هذا الطلب — أي طلب أحدث يبطل نتيجة هذا الطلب (انظر الشرح أعلاه)
    const requestId = ++tasksLoadSequence;
    const isStale = () => requestId !== tasksLoadSequence;

    try {
        if (currentUserScope.companyIds !== null && currentUserScope.companyIds.length === 0) {
            fullTasksReportDataset = [];
            allEmployeeNameOptions = [];
            allCompanyNameOptions = [];
            applyTasksReportFilters();
            return;
        }

        // 🆕 مؤشر تحميل واضح أثناء الجلب بدل إبقاء بيانات الفترة السابقة ظاهرة
        if (tableBody) {
            tableBody.innerHTML = `<tr><td colspan="6" class="table-loading-state">جاري جلب بيانات التقرير...</td></tr>`;
        }

        const taskRows = await fetchAllTasksRows(fromDate, toDate);
        if (isStale()) return; // طلب أحدث (نطاق تاريخ مختلف) بدأ بعد هذا — أهمل نتيجته

        // 👤 أسماء/مسميات الموظفين المُسنَد إليهم — تُجلب من 3 مصادر معاً بدل
        // الاعتماد فقط على الربط النشط بجدول employee_links:
        //
        //  ⚠️ سابقاً كان الاسم يُجلب فقط عبر الربط النشط، فإذا أُنهي ربط الموظف
        //  بشركته (end_employee_link.js) يختفي الموظف من هذا الاستعلام تماماً،
        //  فتظهر مهمته القديمة "غير مسندة" بالتقرير رغم أن tasks.assigned_to
        //  لا يزال يحمل معرّف الموظف الصحيح بوضوح (نفس الإصلاح المطبَّق فعلياً
        //  بشاشة "إدارة المهام" tasks.js). المصادر الثلاثة بالترتيب: جدول
        //  employees مباشرة، ثم الربط النشط employee_links (يحمل الاسم مضمَّناً
        //  حتى لو تعذّر الوصول المباشر لجدول employees بسبب RLS)، ثم أرشيف
        //  الروابط المنتهية employee_link_history كملاذ أخير (يخزّن اسم الموظف
        //  كنسخة ثابتة وقت إنهاء الربط، مستقلة عن أي صلاحيات على جدول employees).
        const assignedEmployeeIds = Array.from(new Set((taskRows || []).map(t => t.assigned_to).filter(Boolean)));
        let employeeInfoById = new Map();
        if (assignedEmployeeIds.length > 0) {
            const [employeesResult, activeLinkResult, historyResult] = await Promise.all([
                dbClient.from('employees').select('id, name').in('id', assignedEmployeeIds)
                    .then(res => res, err => { console.error('تعذّر جلب أسماء الموظفين مباشرة من جدول employees:', err.message); return { data: [] }; }),
                dbClient.from('employee_links').select('employee_id, job_title, employees(id, name)').in('employee_id', assignedEmployeeIds)
                    .then(res => res, err => { console.error('تعذّر تحميل بيانات الربط النشط للموظفين المُسنَد إليهم:', err.message); return { data: [] }; }),
                dbClient.from('employee_link_history').select('employee_id, employee_name, job_title, end_date').in('employee_id', assignedEmployeeIds)
                    .then(res => res, err => { console.error('تعذّر تحميل أرشيف الروابط المنتهية:', err.message); return { data: [] }; })
            ]);
            if (isStale()) return;

            const directNameByEmployeeId = new Map(
                ((employeesResult && employeesResult.data) || []).map(emp => [String(emp.id), emp.name])
            );

            const activeInfoByEmployeeId = new Map();
            ((activeLinkResult && activeLinkResult.data) || []).forEach(row => {
                if (row.employee_id == null) return;
                activeInfoByEmployeeId.set(String(row.employee_id), {
                    name: row.employees ? row.employees.name : null,
                    job_title: row.job_title || ''
                });
            });

            const historyByEmployeeId = new Map();
            ((historyResult && historyResult.data) || []).forEach(row => {
                const key = String(row.employee_id);
                const existing = historyByEmployeeId.get(key);
                if (!existing || String(row.end_date || '') > String(existing.end_date || '')) {
                    historyByEmployeeId.set(key, row);
                }
            });

            assignedEmployeeIds.forEach(id => {
                const key = String(id);
                const activeInfo = activeInfoByEmployeeId.get(key);
                const historyInfo = historyByEmployeeId.get(key);

                const name = directNameByEmployeeId.get(key)
                    || (activeInfo && activeInfo.name)
                    || (historyInfo && historyInfo.employee_name)
                    || null;

                const jobTitle = (activeInfo && activeInfo.job_title)
                    || (historyInfo && historyInfo.job_title)
                    || '';

                if (name) {
                    employeeInfoById.set(key, { name, job_title: jobTitle });
                }
            });
        }

        let mappedDataset = (taskRows || []).map(task => {
            const company = task.company_id != null ? companiesById.get(String(task.company_id)) : null;
            const employeeInfo = task.assigned_to != null ? employeeInfoById.get(String(task.assigned_to)) : null;

            return {
                id: task.id,
                title: task.title,
                type: task.type || '—',
                status: task.status || 'قيد الانتظار',
                due_date: task.due_date,
                start_date: task.start_date,
                company_id: task.company_id,
                company_name: company ? (company.name || '----') : (task.company_id ? 'شركة محذوفة' : '—'),
                assignee_name: employeeInfo ? employeeInfo.name : null
            };
        });

        // 💳 مسؤول الشركة: إخفاء مهام أي شهر (due_date) لم تُصدَر له فاتورة
        // مدفوعة بعد — انظر تعليق getPaidMonthsMapForCompanies أعلى الملف
        if (currentUserScope.role === 'company') {
            const paidMonthsMap = await getPaidMonthsMapForCompanies(currentUserScope.companyIds);
            if (isStale()) return;
            mappedDataset = mappedDataset.filter(task => isRecordDateInPaidMonth(paidMonthsMap, task.company_id, task.due_date));
        }

        // ✅ لا تُكتب أي نتيجة بالمتغيرات العامة إلا بعد التأكد أن هذا هو أحدث طلب
        fullTasksReportDataset = mappedDataset;

        allEmployeeNameOptions = distinctSorted(fullTasksReportDataset.map(r => r.assignee_name).filter(Boolean));
        allCompanyNameOptions = distinctSorted(fullTasksReportDataset.map(r => r.company_name).filter(n => n && n !== '—'));

        applyTasksReportFilters();

    } catch (error) {
        if (isStale()) return;
        console.error('فشل جلب بيانات تقرير المهام:', error.message);
        if (tableBody) {
            tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#ef4444; padding:20px;">تعذّر تحميل بيانات التقرير: ${error.message}</td></tr>`;
        }
    }
}

function distinctSorted(values) {
    return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ar'));
}

// =========================================================================
// 4. تطبيق الفلاتر: اسم الموظف + اسم الشركة + النوع + الحالة (نطاق تاريخ
//    الاستحقاق مطبَّق مسبقاً عبر الجلب من قاعدة البيانات)
// =========================================================================
function applyTasksReportFilters() {
    const nameQuery = (document.getElementById('reportTaskEmployeeSearchInput')?.value || '').toLowerCase().trim();
    const companyQuery = (document.getElementById('reportTaskCompanySearchInput')?.value || '').toLowerCase().trim();
    const typeValue = document.getElementById('reportTaskTypeFilterId')?.value || 'all';
    const statusValue = document.getElementById('reportTaskStatusFilterId')?.value || 'all';

    filteredTasksReportDataset = fullTasksReportDataset.filter(row => {
        const employeeName = (row.assignee_name || '').toLowerCase();
        const companyName = (row.company_name || '').toLowerCase();

        const matchesName = !nameQuery || employeeName.includes(nameQuery);
        const matchesCompany = !companyQuery || companyName.includes(companyQuery);
        const matchesType = typeValue === 'all' || row.type === typeValue;
        const matchesStatus = statusValue === 'all' || row.status === statusValue;

        return matchesName && matchesCompany && matchesType && matchesStatus;
    });

    currentTaskReportPage = 1;
    renderTasksReportTable(filteredTasksReportDataset);
}

// =========================================================================
// 5. بناء جدول التقرير (وضع الشاشة: مع تقسيم صفحات)
// =========================================================================
const TASK_TYPE_BADGE = {
    'مسندة': 'badge-type-assigned',
    'مستقلة': 'badge-type-standalone',
    'روتينية': 'badge-type-routine'
};
const TASK_STATUS_BADGE = {
    'قيد الانتظار': 'badge-status-pending',
    'قيد التنفيذ': 'badge-status-inprogress',
    'مكتملة': 'badge-status-done'
};

function renderTasksReportTable(data) {
    const tableBody = document.getElementById('reportTableBody');
    const resultsCountEl = document.getElementById('reportResultsCount');
    if (!tableBody) return;

    if (resultsCountEl) resultsCountEl.textContent = `عدد النتائج المطابقة: ${data.length}`;

    if (!data || data.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:30px; color:#94a3b8;">لا توجد مهام مطابقة لخيارات البحث الحالية.</td></tr>`;
        setupTaskReportPaginationControls(0);
        return;
    }

    const startIndex = (currentTaskReportPage - 1) * taskReportRowsPerPage;
    const endIndex = startIndex + taskReportRowsPerPage;
    const paginatedData = data.slice(startIndex, endIndex);

    tableBody.innerHTML = paginatedData.map(row => buildTasksReportRowHtml(row)).join('');
    if (window.applyIconPlaceholders) applyIconPlaceholders(tableBody); // تعبئة أيقونات SVG بالاستايل الجديد بدل الإيموجي
    setupTaskReportPaginationControls(data.length);
}

// 📅 عمود "التاريخ" يعرض فترة المهمة كاملة "من تاريخ - إلى تاريخ" (start_date
// - due_date) بدل تاريخ الاستحقاق وحده — يطابق مفهوم "فترة المهمة" المستخدَم
// بنماذج إضافة/تعديل المهام (add_task.html/tasks_bulk.html). إن تطابق
// التاريخان يُعرض تاريخ واحد فقط بلا تكرار، وإن غاب أحدهما يُعرض الآخر وحده.
function formatTaskPeriod(row) {
    const start = row.start_date;
    const due = row.due_date;
    if (start && due) return start === due ? due : `${start} - ${due}`;
    return due || start || '—';
}

function buildTasksReportRowHtml(row) {
    const isCompleted = row.status === 'مكتملة';
    const typeBadgeClass = TASK_TYPE_BADGE[row.type] || 'badge-type-standalone';
    const statusBadgeClass = TASK_STATUS_BADGE[row.status] || 'badge-status-pending';

    return `
        <tr>
            <td><strong style="color:#1e293b;"><span data-icon="person"></span> ${row.assignee_name || 'غير مسندة'}</strong></td>
            <td><span class="task-title-cell ${isCompleted ? 'completed' : ''}">${row.title}</span></td>
            <td style="color:#334155;"><span data-icon="building"></span> ${row.company_name}</td>
            <td><span class="badge-task-type ${typeBadgeClass}">${row.type}</span></td>
            <td style="color:#475569;"><span data-icon="calendar"></span> ${formatTaskPeriod(row)}</td>
            <td style="text-align:center;"><span class="badge-task-status ${statusBadgeClass}">${row.status}</span></td>
        </tr>
    `;
}

// =========================================================================
// 6. أزرار التنقل بين صفحات التقرير
// =========================================================================
function setupTaskReportPaginationControls(totalItems) {
    const controlsContainer = document.getElementById('reportPagination');
    if (!controlsContainer) return;
    controlsContainer.innerHTML = '';

    const totalPages = Math.ceil(totalItems / taskReportRowsPerPage);
    if (totalPages <= 1) return;

    const prevBtn = document.createElement('button');
    prevBtn.innerHTML = '&rarr; السابقة';
    prevBtn.disabled = currentTaskReportPage === 1;
    prevBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;';
    if (prevBtn.disabled) prevBtn.style.opacity = '0.5';
    prevBtn.onclick = () => {
        if (currentTaskReportPage > 1) {
            currentTaskReportPage--;
            renderTasksReportTable(filteredTasksReportDataset);
        }
    };
    controlsContainer.appendChild(prevBtn);

    const countLabel = document.createElement('span');
    countLabel.style.cssText = 'font-size: 0.9rem; color: #475569; font-weight: 600; margin: 0 10px;';
    countLabel.textContent = `صفحة ${currentTaskReportPage} من ${totalPages}`;
    controlsContainer.appendChild(countLabel);

    const nextBtn = document.createElement('button');
    nextBtn.innerHTML = 'التالية &larr;';
    nextBtn.disabled = currentTaskReportPage === totalPages;
    nextBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;';
    if (nextBtn.disabled) nextBtn.style.opacity = '0.5';
    nextBtn.onclick = () => {
        if (currentTaskReportPage < totalPages) {
            currentTaskReportPage++;
            renderTasksReportTable(filteredTasksReportDataset);
        }
    };
    controlsContainer.appendChild(nextBtn);
}

// =========================================================================
// 7. تصدير التقرير الكامل (بعد الفلترة) إلى ملف Excel عبر مكتبة SheetJS
// =========================================================================
function exportTasksReportToExcel() {
    if (!filteredTasksReportDataset || filteredTasksReportDataset.length === 0) {
        alert('لا توجد بيانات لتصديرها بناءً على خيارات البحث الحالية.');
        return;
    }

    const headers = ['الموظف', 'عنوان المهمة', 'الشركة', 'النوع', 'التاريخ', 'الحالة'];

    const rows = filteredTasksReportDataset.map(row => [
        row.assignee_name || 'غير مسندة',
        row.title,
        row.company_name,
        row.type,
        formatTaskPeriod(row),
        row.status
    ]);

    const worksheetData = [headers, ...rows];
    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

    worksheet['!cols'] = [
        { wch: 22 }, { wch: 34 }, { wch: 22 }, { wch: 12 }, { wch: 14 }, { wch: 14 }
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'تقرير المهام');

    const now = new Date();
    const dateSuffix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    XLSX.writeFile(workbook, `تقرير_المهام_${dateSuffix}.xlsx`);
}

// =========================================================================
// 8. طباعة التقرير: نفس تصميم الطباعة الاحترافي المشترك (ترويسة بالشركة +
//    رمز QR + رقم مستند + جدول بترويسة زرقاء + تذييل برقم الصفحة)، لكن
//    بأعمدة مختلفة عن تقرير الحضور والانصراف — لذا يُستخدم
//    buildGenericReportPrintPagesHtml (بدل الدالة المخصصة لتقرير الحضور) مع
//    تعريف أعمدة هذا التقرير تحديداً. رمز QR يشير لصفحة عرض عامة
//    (view_report.html) تعرض نفس التقرير لأي شخص يمسحه دون تسجيل دخول — عبر
//    لقطة تُحفظ بجدول report_snapshots (بعمودي report_type/columns
//    الإضافيين؛ يتطلب تنفيذ سكربت SQL المرفق مرة واحدة بسوبابيس، وإن لم
//    يُنفَّذ بعد تستمر الطباعة بشكل طبيعي لكن بدون رمز QR فعّال).
//
//    ⚠️ عمود "الشركة" محذوف من أعمدة الطباعة تحديداً (بناءً على طلب المستخدم)؛
//    جدول الشاشة (buildTasksReportRowHtml) وتصدير Excel (exportTasksReportToExcel)
//    ما زالا يعرضان اسم الشركة كالمعتاد — الحذف خاص بنسخة الطباعة فقط.
//
//    ⚠️ عدد الصفوف بالصفحة الواحدة: يُحسب تلقائياً بالقياس الفعلي داخل
//    buildGenericReportPrintPagesHtml (انظر packRowsIntoPrintPages بملف
//    print-report.js) — تُملأ كل صفحة بأقصى عدد صفوف يسعها ارتفاعها الحقيقي،
//    فتُعالَج مشكلة التفاف عمود "عنوان المهمة" على أكثر من سطر تلقائياً دون
//    الحاجة لتمرير رقم ثابت (rowsPerPage) هنا يهدر مساحة الصفحة حين تكون
//    العناوين قصيرة.
//
//    🆕 showBranding: false — بناءً على طلب المستخدم صراحة، طباعة تقرير
//    المهام لا تعرض العلامة المائية المتكررة "بصمة الأعمال" خلف الصفحة ولا
//    عبارة "هذه الخدمة مقدمة من بصمة الأعمال" أسفلها (يبقى فقط "صفحة X من Y").
//    هذا الخيار خاص بتقرير المهام فقط — لا يمرَّر من أي تقرير آخر
//    (الشركات/الموظفين/التحصيل)، فتبقى كما كانت تماماً (انظر الشرح بملف
//    print-report.js). ينطبق هذا أيضاً عند عرض لقطة هذا التقرير عبر رمز QR
//    (انظر التحقق من report_type === 'tasks' بملف view_report.js).
// =========================================================================
const TASKS_REPORT_COLUMNS = [
    { key: 'employee_name', label: 'الموظف', align: 'right' },
    { key: 'title', label: 'عنوان المهمة', align: 'right' },
    { key: 'type', label: 'النوع', align: 'center' },
    { key: 'period', label: 'التاريخ', align: 'center' },
    { key: 'status', label: 'الحالة', align: 'center' }
];

async function printTasksReport() {
    if (!filteredTasksReportDataset || filteredTasksReportDataset.length === 0) {
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
    const singleCompanyLabel = detectSingleCompanyLabel(filteredTasksReportDataset);
    const companyLabel = singleCompanyLabel || 'بصمة الأعمال';

    const printRows = filteredTasksReportDataset.map(row => ({
        employee_name: row.assignee_name || 'غير مسندة',
        title: row.title,
        type: row.type,
        period: formatTaskPeriod(row),
        status: row.status
    }));

    let qrDataUrl = null;
    try {
        const { data: snapshot, error: snapshotError } = await dbClient
            .from('report_snapshots')
            .insert({
                doc_number: docNumber,
                report_title: 'تقرير المهام',
                report_type: 'tasks',
                columns: TASKS_REPORT_COLUMNS,
                company_name: singleCompanyLabel,
                show_company_column: !singleCompanyLabel,
                report_date_text: reportDateText,
                rows: printRows
            })
            .select('id')
            .single();

        if (snapshotError) throw snapshotError;

        const viewUrl = `${window.location.origin}${window.location.pathname.replace('tasks-report.html', 'view_report.html')}?id=${snapshot.id}`;
        qrDataUrl = await window.PrintReport.generateReportQrDataUrl(viewUrl);
    } catch (error) {
        console.error('تعذّر إنشاء نسخة قابلة للعرض عبر رمز QR (تأكد من تنفيذ سكربت إضافة عمودي report_type/columns لجدول report_snapshots بسوبابيس):', error.message);
    }

    printRoot.innerHTML = window.PrintReport.buildGenericReportPrintPagesHtml({
        docNumber,
        companyLabel,
        subtitleText: 'تقرير المهام',
        reportDateText,
        columns: TASKS_REPORT_COLUMNS,
        rows: printRows,
        qrDataUrl,
        showBranding: false
    });

    window.print();
}

// إن كانت كل مهام التقرير المفلترة الحالية تخص شركة واحدة فقط، تُعاد كاسمها
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