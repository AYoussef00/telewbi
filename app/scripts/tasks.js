// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================

// =========================================================================
// 🛡️ نطاق رؤية المستخدم الحالي: مسؤول الشركة (role='company') يرى وينشئ
// مهاماً لشركته/شركاته فقط (المملوكة عبر companies.user_id)، بينما
// super_admin/admin يريان كل المهام بلا قيود — نفس منطق نظام الأدوار
// المستخدم بباقي الشاشات (بلا سياسات RLS خاصة بهذا؛ التصفية من الواجهة).
//
// ⚠️ إصلاح أمني مهم: دور "موظف" (role='employee') كان يقع ضمن نفس الفرع
// else العام (companyIds: null ⇐ بلا أي تقييد)، ما يعني أنه لو مُنح صلاحية
// عرض قسم "المهام" مستقبلاً من شاشة الأدوار والصلاحيات، كان سيرى كل مهام
// كل الشركات لكل الموظفين — وليس مهامه هو فقط. الآن يُقيَّد صراحة بمهامه
// المُسندة إليه هو تحديداً (assigned_to) عبر employeeId.
// =========================================================================
let currentUserScope = { role: null, companyIds: null, employeeId: null }; // companyIds=null / employeeId=null يعني بلا تقييد

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
            // 🛡️ ربط حساب الدخول الحالي بسجله بجدول employees عبر employees.user_id،
            // ثم تقييد كل استعلامات المهام أدناه بـ assigned_to = هذا المعرّف فقط.
            const { data: employeeRow } = await dbClient.from('employees').select('id').eq('user_id', session.user.id).maybeSingle();
            // ⚠️ لو تعذّر العثور على سجل موظف مرتبط بهذا الحساب لأي سبب، نستخدم
            // قيمة employeeId وهمية (-1) لا يمكن أن تطابق أي مهمة حقيقية أبداً،
            // بدل ترك القيد null (الذي كان سيعني "بلا تقييد" فيعرض كل المهام
            // بالخطأ) — الأمان أولاً حتى في الحالات الاستثنائية.
            currentUserScope = { role, companyIds: null, employeeId: employeeRow ? employeeRow.id : -1 };
        } else {
            currentUserScope = { role, companyIds: null, employeeId: null };
        }
    } catch (error) {
        console.error('تعذّر تحديد نطاق صلاحيات المستخدم الحالي:', error.message);
    }
}

// =========================================================================
// 💳 قيد "الأشهر المدفوعة فقط" لمسؤول الشركة: لا يرى مسؤول الشركة مهام أي
// شهر (حسب "إلى تاريخ" due_date للمهمة) لم تُصدَر له فاتورة بحالة "مدفوعة"
// (paid) بعد — يشمل هذا الشهر الجاري لو لم تصدر فاتورته بعد (بلا استثناء)،
// وأيضاً أي مهمة بلا due_date إطلاقاً (لا يمكن التحقق من شهرها، فتُخفى
// بنفس منطق "الإخفاء الافتراضي حتى يثبت السداد"). نفس الآلية المستخدمة
// بـ attendance.js تماماً — انظر التعليق المطابق هناك لسبب استخدام
// invoice_date كـ"شهر الفاتورة" (لا يوجد عمود فترة صريح بجدول invoices).
// =========================================================================
async function getPaidMonthsMapForCompanies(companyIds) {
    const map = new Map(); // company_id (نصياً) ← Set('YYYY-MM')
    if (!companyIds || companyIds.length === 0) return map;
    try {
        const rows = await fetchAllRows((from, to) =>
            dbClient.from('invoices')
                .select('invoice_date, company_id')
                .eq('status', 'paid')
                .in('company_id', companyIds)
                .range(from, to)
        );
        (rows || []).forEach(row => {
            if (!row.invoice_date || row.company_id == null) return;
            const key = String(row.company_id);
            if (!map.has(key)) map.set(key, new Set());
            map.get(key).add(String(row.invoice_date).slice(0, 7));
        });
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

// =========================================================================
// 🙈 إخفاء زرَي "إضافة مهام متعددة" و"قائمة المهام" عن دور "مسؤول شركة"
// تحديداً — هاتان ميزتان إداريتان مخصَّصتان لمسؤولي النظام (تعيين مهام على
// مستوى عدة شركات دفعة واحدة / قائمة قوالب المهام الجاهزة)، وليستا جزءاً من
// نظام الصلاحيات القابل للتخصيص (data-perm="add:tasks") لأن هذا المفتاح هو
// نفسه المستخدم لزر "إضافة مهمة" العادي المطلوب بقاء ظهوره لمسؤول الشركة —
// فإخفاؤهما لا يمكن أن يعتمد على منح/سحب صلاحية "add:tasks" وحدها، بل على
// دور المستخدم مباشرة.
// ⚠️ هذا إخفاء واجهة فقط — الحماية الفعلية من الوصول المباشر عبر الرابط
// موجودة أيضاً بأول كل من tasks_bulk.js وjob_tasks.js (انظر التعليق هناك).
//
// 🛡️ الزران مخفيان افتراضياً بـ CSS (السمة data-hide-for-company بملف
// global-layout.css) منذ أول رسم للصفحة، بمعزل تماماً عن applyButtonGating()
// (المُستدعاة من داخل Permissions.guardPage() فور اكتمالها، والتي كانت تُظهر
// زر "إضافة مهام متعددة" فوراً بمجرد منح الدور صلاحية "add:tasks" العامة —
// لأنها لا تعرف شيئاً عن هذا الاستثناء الخاص بمسؤول الشركة). كان هذا يسبق
// اكتمال هذا التحقق غير الفوري من الدور (استعلام Supabase منفصل بـ
// loadCurrentUserScope) بلحظات، فيظهر الزر ثم يختفي فجأة — وميض غير احترافي.
// الحل: لا نُظهر الزرين الآن إلا صراحةً (بإزالة السمة) لغير مسؤول الشركة؛
// يبقيان مخفيَين بلا أي تدخل إضافي لمسؤول الشركة تحديداً (وهي الحالة
// الافتراضية أصلاً).
// =========================================================================
function applyCompanyRoleTasksUiRestrictions() {
    if (currentUserScope.role === 'company') return; // يبقيان مخفيَين كما هو مضبوط افتراضياً بالـ HTML
    const btnBulk = document.getElementById('btnBulkAddTask');
    const btnJobList = document.getElementById('btnJobTasksList');
    if (btnBulk) btnBulk.removeAttribute('data-hide-for-company');
    if (btnJobList) btnJobList.removeAttribute('data-hide-for-company');
}

// 📅 تاريخ اليوم بصيغة YYYY-MM-DD — يُستخدم لتقييد استعلامات employee_links
// بالروابط النشطة فقط (بلا تاريخ انتهاء، أو بتاريخ انتهاء لم يحِن بعد). بعد
// تحويل "إنهاء الربط" ليصبح تعليماً بتاريخ انتهاء (link_end_date) بدل حذف
// صف الربط فعلياً، تبقى صفوف الروابط المُنهاة موجودة بالجدول، فبلا هذا
// التقييد كانت ستُحتسب هذه الروابط القديمة ضمن موظفي الشركة الحاليين
// وتُسنَد لهم مهام جديدة رغم انتهاء ربطهم فعلياً.
function getTodayDateStringForLinks() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

// =========================================================================
// 🔁 جلب كل الصفوف على دفعات (Pagination) — سوبابيس/PostgREST يحدّان النتيجة
// بحدّ أقصى 1000 صف افتراضياً لكل طلب بلا .range() صريح، ما قد يُسقط صفوفاً
// بصمت دون أي خطأ ظاهر عند تجاوز عدد الشركات/المهام هذا الحد. هذه الدالة
// تكرر الطلب صفحة تلو الأخرى حتى تكتمل كل السجلات مهما كان عددها.
// =========================================================================
const TASKS_FETCH_PAGE_SIZE = 1000;

async function fetchAllRows(builderFactory) {
    let allRows = [];
    let from = 0;
    while (true) {
        const { data, error } = await builderFactory(from, from + TASKS_FETCH_PAGE_SIZE - 1);
        if (error) throw error;
        allRows = allRows.concat(data || []);
        if (!data || data.length < TASKS_FETCH_PAGE_SIZE) break;
        from += TASKS_FETCH_PAGE_SIZE;
    }
    return allRows;
}

// =========================================================================
// 2. مخازن بيانات مساعدة (شركات/موظفين) + بيانات المهام
// =========================================================================
let companiesById = new Map();
let allCompanyOptions = []; // [{value, label}] بعد تطبيق نطاق الرؤية
let employeeLinksByCompanyId = new Map(); // company_id -> [{employee_id, name, job_title}]

let fullTasksDataset = [];
let filteredTasksDataset = [];
let currentTasksPage = 1;
const TASKS_ROWS_PER_PAGE = 10;

// =========================================================================
// 🔒 التحكم بالوصول للصفحة بأكملها وبإظهار أزرار الإجراءات ("إضافة مهمة" /
// "إضافة مهام متعددة" / أزرار تعديل وحذف كل صف) أصبح الآن عبر محرك الصلاحيات
// الموحّد (permissions.js — Permissions.guardPage / data-perm).
// =========================================================================
document.addEventListener('DOMContentLoaded', async () => {
    const allowed = await Permissions.guardPage('tasks');
    if (!allowed) return;

    setDefaultTaskDateRange();

    await loadCurrentUserScope();
    applyCompanyRoleTasksUiRestrictions();
    await loadCompanies();
    setupStatusFilterCombobox();
    setupCompanyFilterCombobox();
    setupModalCombos();

    document.getElementById('taskSearchInput').addEventListener('input', applyTaskFilters);
    document.getElementById('taskFromDate').addEventListener('change', applyTaskFilters);
    document.getElementById('taskToDate').addEventListener('change', applyTaskFilters);

    document.getElementById('btnRefreshTasks').addEventListener('click', loadTasks);
    // "إضافة مهمة جديدة" أصبحت صفحة مستقلة (add_task.html) بدل شاشة منبثقة —
    // النافذة المنبثقة #taskModal تبقى مستخدمة فقط لتعديل مهمة موجودة
    document.getElementById('btnAddTask').addEventListener('click', () => { window.location.href = Routes.url('add_task'); });
    document.getElementById('btnBulkAddTask').addEventListener('click', () => { window.location.href = Routes.url('tasks_bulk'); });
    document.getElementById('btnJobTasksList').addEventListener('click', () => { window.location.href = Routes.url('job_tasks'); });
    const btnTasksReport = document.getElementById('btnTasksReport');
    if (btnTasksReport) btnTasksReport.addEventListener('click', () => { window.location.href = Routes.url('tasks-report'); });

    document.getElementById('btnCloseTaskModal').addEventListener('click', closeTaskModal);
    document.getElementById('btnCancelTaskModal').addEventListener('click', closeTaskModal);
    document.getElementById('taskForm').addEventListener('submit', handleTaskFormSubmit);

    // إغلاق أي قائمة إجراءات مفتوحة عند الضغط خارجها
    document.addEventListener('click', (e) => {
        document.querySelectorAll('.task-actions-menu.open').forEach(menu => {
            if (!menu.parentElement.contains(e.target)) menu.classList.remove('open');
        });
    });

    await loadTasks();
});

// =========================================================================
// 2ب. التاريخ الافتراضي لفلتر "من تاريخ / إلى تاريخ" (تاريخ الاستحقاق):
//     الشهر الحالي كاملاً (أول يوم إلى آخر يوم)، بنفس منطق شاشات التقارير
// =========================================================================
function setDefaultTaskDateRange() {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    document.getElementById('taskFromDate').value = toTaskDateInputValue(firstDay);
    document.getElementById('taskToDate').value = toTaskDateInputValue(lastDay);
}

function toTaskDateInputValue(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// =========================================================================
// 3. تحميل الشركات (ضمن نطاق رؤية المستخدم) لتغذية فلتر الجدول ونموذج التعديل
// =========================================================================
async function loadCompanies() {
    try {
        if (currentUserScope.companyIds !== null && currentUserScope.companyIds.length === 0) {
            companiesById = new Map();
            allCompanyOptions = [];
            return;
        }

        const data = await fetchAllRows((from, to) => {
            let query = dbClient
                .from('companies')
                .select('id, name')
                .order('name', { ascending: true })
                .order('id', { ascending: true })
                .range(from, to);
            if (currentUserScope.companyIds !== null) {
                query = query.in('id', currentUserScope.companyIds);
            }
            return query;
        });

        companiesById = new Map((data || []).map(c => [String(c.id), c]));
        allCompanyOptions = (data || []).map(c => ({ value: String(c.id), label: c.name || '----' }));
    } catch (error) {
        console.error('تعذّر تحميل قائمة الشركات:', error.message);
    }
}

// =========================================================================
// 3ب. فلترا "الحالة" و"الشركة" أعلى الجدول — قوائم قابلة للبحث (Searchable
//     Combobox) بدل قوائم <select> عادية، بنفس نمط شاشة "الحضور والانصراف"
// =========================================================================
const TASK_STATUS_FILTER_OPTIONS = [
    { value: 'all', label: 'الحالة: الكل' },
    { value: 'قيد الانتظار', label: 'قيد الانتظار' },
    { value: 'قيد التنفيذ', label: 'قيد التنفيذ' },
    { value: 'مكتملة', label: 'مكتملة' }
];

let taskStatusFilterComboApi = null;
let taskCompanyFilterComboApi = null;

function setupStatusFilterCombobox() {
    taskStatusFilterComboApi = setupSearchableCombobox({
        inputId: 'taskStatusFilterSearch',
        hiddenId: 'taskStatusFilterId',
        dropdownId: 'taskStatusFilterDropdown',
        getOptions: () => TASK_STATUS_FILTER_OPTIONS,
        emptyText: 'لا توجد نتائج مطابقة',
        onSelectExtra: () => { currentTasksPage = 1; applyTaskFilters(); }
    });
    document.getElementById('taskStatusFilterSearch').value = 'الحالة: الكل';
}

function setupCompanyFilterCombobox() {
    taskCompanyFilterComboApi = setupSearchableCombobox({
        inputId: 'taskCompanyFilterSearch',
        hiddenId: 'taskCompanyFilterId',
        dropdownId: 'taskCompanyFilterDropdown',
        getOptions: () => [{ value: 'all', label: 'جميع الشركات' }, ...allCompanyOptions],
        emptyText: 'لا توجد شركات مطابقة',
        onSelectExtra: () => { currentTasksPage = 1; applyTaskFilters(); }
    });
    document.getElementById('taskCompanyFilterSearch').value = 'جميع الشركات';
}

// جلب موظفي شركة محددة عبر جدول employee_links (المصدر الفعلي لعلاقة الموظف
// بالشركة)، مع المسمى الوظيفي المحفوظ بنفس صف الربط
//
// ⚠️ مُقيَّد بالروابط النشطة فقط (getTodayDateStringForLinks) حتى لا يظهر
// موظف انتهى ربطه بهذه الشركة ضمن قائمة الموظفين القابلين لإسناد مهمة جديدة
// إليهم — صف ربطه لا يزال موجوداً بالجدول (بعد تحويل "إنهاء الربط" لتعليم
// بتاريخ بدل حذف)، لكنه لم يعد يعمل بهذه الشركة فعلياً.
async function loadEmployeesForCompany(companyId) {
    if (employeeLinksByCompanyId.has(companyId)) return employeeLinksByCompanyId.get(companyId);

    try {
        const data = await fetchAllRows((from, to) => dbClient
            .from('employee_links')
            .select('employee_id, job_title, employees(id, name)')
            .eq('company_id', companyId)
            .or(`link_end_date.is.null,link_end_date.gte.${getTodayDateStringForLinks()}`)
            .order('employee_id', { ascending: true })
            .range(from, to));

        const list = (data || [])
            .filter(row => row.employees)
            .map(row => ({ employee_id: row.employees.id, name: row.employees.name, job_title: row.job_title || '' }));

        employeeLinksByCompanyId.set(companyId, list);
        return list;
    } catch (error) {
        console.error('تعذّر تحميل موظفي الشركة المحددة:', error.message);
        return [];
    }
}

// =========================================================================
// 4. جلب المهام (ضمن نطاق الرؤية) وربطها بأسماء الشركات/الموظفين للعرض
// =========================================================================
async function loadTasks() {
    const tableBody = document.getElementById('tasksTableBody');
    tableBody.innerHTML = `<tr><td colspan="7" class="table-loading-state">جاري تحميل المهام...</td></tr>`;

    try {
        if (currentUserScope.companyIds !== null && currentUserScope.companyIds.length === 0) {
            fullTasksDataset = [];
            applyTaskFilters();
            return;
        }

        const taskRows = await fetchAllRows((from, to) => {
            let query = dbClient
                .from('tasks')
                .select('*')
                .order('created_at', { ascending: false })
                .order('id', { ascending: false })
                .range(from, to);
            if (currentUserScope.companyIds !== null) {
                query = query.in('company_id', currentUserScope.companyIds);
            }
            // 🛡️ دور "موظف": تقييد صريح بمهامه هو فقط (انظر تعليق loadCurrentUserScope أعلاه)
            if (currentUserScope.employeeId !== null) {
                query = query.eq('assigned_to', currentUserScope.employeeId);
            }
            return query;
        });

        // 👤 معلومات الموظف المُسنَد إليه لكل مهمة — تُجلب من 3 مصادر معاً:
        //
        //  ⚠️ سابقاً كان الاسم يُجلب فقط عبر جدول employee_links (الربط النشط
        //  الحالي)، فإذا أُنهي ربط الموظف بشركته (end_employee_link.js يحذف
        //  صفه من employee_links وينقله لأرشيف employee_link_history) يختفي
        //  الموظف من هذا الاستعلام تماماً، فتظهر مهمته القديمة "غير مسندة"
        //  رغم أن tasks.assigned_to لا يزال يحمل معرّف الموظف الصحيح بوضوح!
        //
        //  ⚠️ إصلاح إضافي: محاولة أولى بجلب الاسم مباشرة من جدول employees قد
        //  تعود بلا نتيجة لموظف مُنتهي الربط أيضاً لو كانت سياسة القراءة (RLS
        //  SELECT Policy) على جدول employees تعتمد ضمنياً على وجود ربط نشط
        //  (شائع بحسابات دور "company" التي تُقيَّد رؤيتها بموظفي شركتها فقط).
        //  لذا أصبح أرشيف employee_link_history هو المصدر الاحتياطي الأخير،
        //  لأنه يخزّن اسم الموظف كنسخة ثابتة (employee_name) وقت إنهاء الربط —
        //  مستقلة تماماً عن جدول employees وعن أي سياسة وصول عليه.
        //
        //  ⚠️ تحديث لاحق: بعد تحويل "إنهاء الربط" ليصبح تعليماً بتاريخ انتهاء
        //  بدل حذف صف الربط فعلياً، أصبح صف employee_links يبقى موجوداً حتى
        //  بعد إنهاء الربط. لذا لم يعد كافياً الاعتماد على "وجود" صف بجدول
        //  employee_links لتحديد isStillLinked (شارة "⚠️ ربط منتهٍ" أسفل)،
        //  بل لا بد من تقييد استعلام activeLinkRows بالروابط النشطة فقط
        //  (getTodayDateStringForLinks)، وإلا ستبقى الشارة مخفية دائماً حتى
        //  للموظفين الذين انتهى ربطهم فعلياً.
        const assignedEmployeeIds = Array.from(new Set((taskRows || []).map(t => t.assigned_to).filter(Boolean)));
        let employeeInfoById = new Map();

        if (assignedEmployeeIds.length > 0) {
            const [employeesRows, activeLinkRows, historyRows] = await Promise.all([
                fetchAllRows((from, to) => dbClient
                    .from('employees')
                    .select('id, name')
                    .in('id', assignedEmployeeIds)
                    .order('id', { ascending: true })
                    .range(from, to))
                    .catch(err => {
                        console.error('تعذّر جلب أسماء الموظفين مباشرة من جدول employees (سيُعتمد على أرشيف الروابط كبديل):', err.message);
                        return [];
                    }),
                fetchAllRows((from, to) => dbClient
                    .from('employee_links')
                    .select('employee_id, job_title, employees(id, name)')
                    .in('employee_id', assignedEmployeeIds)
                    .or(`link_end_date.is.null,link_end_date.gte.${getTodayDateStringForLinks()}`)
                    .order('employee_id', { ascending: true })
                    .range(from, to))
                    .catch(err => {
                        console.error('تعذّر تحميل بيانات الربط النشط للموظفين المُسنَد إليهم:', err.message);
                        return [];
                    }),
                fetchAllRows((from, to) => dbClient
                    .from('employee_link_history')
                    .select('employee_id, employee_name, job_title, end_date')
                    .in('employee_id', assignedEmployeeIds)
                    .order('employee_id', { ascending: true })
                    .range(from, to))
                    .catch(err => {
                        // جدول الأرشيف قد لا يكون قد أُنشئ بعد بقواعد بيانات قديمة —
                        // لا نوقف تحميل المهام بالكامل بسبب هذا فقط
                        console.error('تعذّر تحميل أرشيف الروابط المنتهية (سيُكتفى بالمصادر الأخرى فقط):', err.message);
                        return [];
                    })
            ]);

            // اسم/مسمى الربط النشط — من جدول employee_links مباشرة (بما فيه اسم
            // الموظف المُضمَّن embedded عبر employees(id, name))، حتى لو تعذّر
            // الوصول لجدول employees مباشرة بسبب RLS
            const activeInfoByEmployeeId = new Map();
            (activeLinkRows || []).forEach(row => {
                if (row.employee_id == null) return;
                activeInfoByEmployeeId.set(String(row.employee_id), {
                    name: row.employees ? row.employees.name : null,
                    job_title: row.job_title || ''
                });
            });

            // اسم/مسمى مباشر من جدول employees (المصدر الأدق إن كان متاحاً)
            const directNameByEmployeeId = new Map(
                (employeesRows || []).map(emp => [String(emp.id), emp.name])
            );

            // أحدث سجل أرشيفي لكل موظف (الأحدث حسب end_date أولاً) — يحمل اسم
            // الموظف كنسخة ثابتة (employee_name) بجانب مسماه الوظيفي وقتها
            const historyByEmployeeId = new Map();
            (historyRows || []).forEach(row => {
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
                const isStillLinked = !!activeInfo;

                const name = directNameByEmployeeId.get(key)
                    || (activeInfo && activeInfo.name)
                    || (historyInfo && historyInfo.employee_name)
                    || null;

                const jobTitle = (activeInfo && activeInfo.job_title)
                    || (historyInfo && historyInfo.job_title)
                    || '';

                if (name) {
                    employeeInfoById.set(key, { name, job_title: jobTitle, isStillLinked });
                }
            });
        }

        fullTasksDataset = (taskRows || []).map(task => {
            const company = task.company_id != null ? companiesById.get(String(task.company_id)) : null;
            const employeeInfo = task.assigned_to != null ? employeeInfoById.get(String(task.assigned_to)) : null;

            return {
                ...task,
                company_name: company ? company.name : null,
                assignee_name: employeeInfo ? employeeInfo.name : null,
                assignee_job_title: employeeInfo ? employeeInfo.job_title : '',
                assignee_link_ended: employeeInfo ? !employeeInfo.isStillLinked : false
            };
        });

        // 💳 مسؤول الشركة: إخفاء مهام أي شهر (due_date) لم تُصدَر له فاتورة
        // مدفوعة بعد — انظر تعليق getPaidMonthsMapForCompanies أعلى الملف
        if (currentUserScope.role === 'company') {
            const paidMonthsMap = await getPaidMonthsMapForCompanies(currentUserScope.companyIds);
            fullTasksDataset = fullTasksDataset.filter(task => isRecordDateInPaidMonth(paidMonthsMap, task.company_id, task.due_date));
        }

        applyTaskFilters();

    } catch (error) {
        console.error('فشل جلب بيانات المهام:', error.message);
        tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#ef4444; padding:20px;">تعذّر تحميل المهام: ${error.message}</td></tr>`;
    }
}

// =========================================================================
// 5. الإحصائيات + الفلاتر
// =========================================================================
function renderStats(data) {
    const completed = data.filter(t => t.status === 'مكتملة').length;
    const inProgress = data.filter(t => t.status === 'قيد التنفيذ').length;
    const pending = data.filter(t => t.status === 'قيد الانتظار').length;

    document.getElementById('statCompleted').textContent = completed;
    document.getElementById('statInProgress').textContent = inProgress;
    document.getElementById('statPending').textContent = pending;
    document.getElementById('statTotal').textContent = data.length;
}

function applyTaskFilters() {
    const searchQuery = (document.getElementById('taskSearchInput').value || '').toLowerCase().trim();
    const statusValue = document.getElementById('taskStatusFilterId').value || 'all';
    const companyValue = document.getElementById('taskCompanyFilterId').value || 'all';
    const fromDate = document.getElementById('taskFromDate').value;
    const toDate = document.getElementById('taskToDate').value;

    filteredTasksDataset = fullTasksDataset.filter(task => {
        const matchesSearch = !searchQuery
            || (task.title || '').toLowerCase().includes(searchQuery)
            || (task.assignee_name || '').toLowerCase().includes(searchQuery);
        const matchesStatus = statusValue === 'all' || task.status === statusValue;
        const matchesCompany = companyValue === 'all' || String(task.company_id) === companyValue;
        const matchesFromDate = !fromDate || (task.due_date && task.due_date >= fromDate);
        const matchesToDate = !toDate || (task.due_date && task.due_date <= toDate);

        return matchesSearch && matchesStatus && matchesCompany && matchesFromDate && matchesToDate;
    });

    renderStats(fullTasksDataset);
    currentTasksPage = 1;
    renderTasksTable();
}

// =========================================================================
// 6. رسم جدول المهام (مع تقسيم صفحات)
//    🔒 أزرار "تعديل" و"حذف" لكل صف تحمل الآن data-perm="edit:tasks" /
//    data-perm="delete:tasks" (مخفية بالكامل عبر CSS إلى أن يؤكد محرك
//    الصلاحيات — permissions.js — امتلاك المستخدم الحالي لهذا الإجراء)، لذا
//    نستدعي Permissions.applyButtonGating(tableBody) يدوياً بعد كل حقن HTML
//    جديد بالجدول، ليغطي هذا الاستدعاء الواحد كل عمليات إعادة العرض (بحث/
//    فلترة/تقليب صفحات) بدل تكراره بكل نقطة استدعاء.
// =========================================================================
function renderTasksTable() {
    const tableBody = document.getElementById('tasksTableBody');
    const data = filteredTasksDataset;

    if (!data || data.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; color:#94a3b8;">لا توجد مهام مطابقة لخيارات البحث الحالية.</td></tr>`;
        setupTasksPaginationControls(0);
        return;
    }

    const startIndex = (currentTasksPage - 1) * TASKS_ROWS_PER_PAGE;
    const paginatedData = data.slice(startIndex, startIndex + TASKS_ROWS_PER_PAGE);

    tableBody.innerHTML = paginatedData.map(task => buildTaskRowHtml(task)).join('');
    // 🎨 تعبئة أيقونات SVG الموحّدة (data-icon) داخل الصفوف المُولَّدة ديناميكياً
    applyIconPlaceholders(tableBody);
    if (window.Permissions) Permissions.applyButtonGating(tableBody);
    setupTasksPaginationControls(data.length);
}

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

function buildTaskRowHtml(task) {
    const isCompleted = task.status === 'مكتملة';
    const typeBadgeClass = TASK_TYPE_BADGE[task.type] || 'badge-type-standalone';
    const statusBadgeClass = TASK_STATUS_BADGE[task.status] || 'badge-status-pending';

    // ⚠️ لو انتهى ربط الموظف المُسنَد إليه بشركته، يبقى اسمه ظاهراً (بيانات
    // أرشيفية) لكن مع إشارة صغيرة توضّح أن ربطه الحالي منتهٍ، بدل إخفاء
    // اسمه بالكامل وعرض "غير مسندة" وكأن المهمة لم تُسنَد لأحد أصلاً.
    const endedBadgeHtml = task.assignee_link_ended
        ? `<span class="assignee-role" style="color:#f97316;" title="انتهى ربط هذا الموظف بشركته الحالية">⚠️ ربط منتهٍ</span>`
        : '';

    const assigneeHtml = task.assignee_name
        ? `<div class="assignee-cell">
                <span class="assignee-avatar">${(task.assignee_name || '?').trim().charAt(0)}</span>
                <div class="assignee-info">
                    <span class="assignee-name">${task.assignee_name}</span>
                    ${task.assignee_job_title ? `<span class="assignee-role">${task.assignee_job_title}</span>` : ''}
                    ${endedBadgeHtml}
                </div>
           </div>`
        : `<span class="assignee-none">غير مسندة</span>`;

    let dateHtml = '—';
    if (task.start_date && task.due_date) {
        dateHtml = `<span data-icon="calendar"></span> ${task.start_date} → ${task.due_date}`;
    } else if (task.due_date) {
        dateHtml = `<span data-icon="calendar"></span> ${task.due_date}`;
    } else if (task.start_date) {
        dateHtml = `<span data-icon="calendar"></span> ${task.start_date} →`;
    }

    return `
        <tr>
            <td><span class="task-title-cell ${isCompleted ? 'completed' : ''}">${task.title}</span></td>
            <td><span class="badge-task-type ${typeBadgeClass}">${task.type}</span></td>
            <td>${assigneeHtml}</td>
            <td><span class="task-company-cell"><span data-icon="building"></span> ${task.company_name || '—'}</span></td>
            <td style="color:#475569;">${dateHtml}</td>
            <td style="text-align:center;"><span class="badge-task-status ${statusBadgeClass}">${task.status}</span></td>
            <td class="task-actions-cell">
                <button type="button" class="btn-task-actions" onclick="toggleTaskActionsMenu(event, ${task.id})">⋯</button>
                <div class="task-actions-menu" id="taskActionsMenu-${task.id}">
                    <button type="button" data-perm="edit:tasks" onclick="openTaskModal(${task.id})"><span data-icon="edit"></span> تعديل</button>
                    ${!isCompleted ? `<button type="button" onclick="markTaskCompleted(${task.id})"><span data-icon="check-circle"></span> تحديد كمكتملة</button>` : ''}
                    <button type="button" class="action-danger" data-perm="delete:tasks" onclick="deleteTask(${task.id})"><span data-icon="trash"></span> حذف</button>
                </div>
            </td>
        </tr>
    `;
}

function toggleTaskActionsMenu(event, taskId) {
    event.stopPropagation();
    const menu = document.getElementById(`taskActionsMenu-${taskId}`);
    const wasOpen = menu.classList.contains('open');
    document.querySelectorAll('.task-actions-menu.open').forEach(m => m.classList.remove('open'));
    if (!wasOpen) menu.classList.add('open');
}

function setupTasksPaginationControls(totalItems) {
    const container = document.getElementById('tasksPagination');
    container.innerHTML = '';
    const totalPages = Math.ceil(totalItems / TASKS_ROWS_PER_PAGE);
    if (totalPages <= 1) return;

    const prevBtn = document.createElement('button');
    prevBtn.innerHTML = '&rarr; السابقة';
    prevBtn.disabled = currentTasksPage === 1;
    prevBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;' + (prevBtn.disabled ? 'opacity:0.5;' : '');
    prevBtn.onclick = () => { if (currentTasksPage > 1) { currentTasksPage--; renderTasksTable(); } };
    container.appendChild(prevBtn);

    const label = document.createElement('span');
    label.style.cssText = 'font-size: 0.9rem; color: #475569; font-weight: 600; margin: 0 10px;';
    label.textContent = `صفحة ${currentTasksPage} من ${totalPages}`;
    container.appendChild(label);

    const nextBtn = document.createElement('button');
    nextBtn.innerHTML = 'التالية &larr;';
    nextBtn.disabled = currentTasksPage === totalPages;
    nextBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;' + (nextBtn.disabled ? 'opacity:0.5;' : '');
    nextBtn.onclick = () => { if (currentTasksPage < totalPages) { currentTasksPage++; renderTasksTable(); } };
    container.appendChild(nextBtn);
}

// =========================================================================
// 7. إجراءات سريعة: تحديد كمكتملة / حذف
// =========================================================================
async function markTaskCompleted(taskId) {
    try {
        const { data, error } = await dbClient.from('tasks').update({ status: 'مكتملة' }).eq('id', taskId).select();
        if (error) throw error;
        if (!data || data.length === 0) {
            alert('تعذّر تحديث المهمة (قد تحتاج صلاحية تحديث على جدول tasks بسوبابيس).');
            return;
        }
        await loadTasks();
    } catch (error) {
        console.error('تعذّر تحديد المهمة كمكتملة:', error.message);
        alert('فشلت العملية: ' + error.message);
    }
}

async function deleteTask(taskId) {
    if (!confirm('هل أنت متأكد من حذف هذه المهمة؟ لا يمكن التراجع عن هذا الإجراء.')) return;
    try {
        const { error } = await dbClient.from('tasks').delete().eq('id', taskId);
        if (error) throw error;
        await loadTasks();
    } catch (error) {
        console.error('تعذّر حذف المهمة:', error.message);
        alert('فشلت العملية: ' + error.message);
    }
}

// =========================================================================
// 8. مكوّن قائمة قابلة للبحث (Searchable Combobox) — مُستخدَم لكل قوائم
//    البحث بهذه الصفحة: فلترا الحالة/الشركة أعلى الجدول، والشركة/الموظف
//    المُسنَد إليه داخل نافذة تعديل مهمة
// =========================================================================
function setupSearchableCombobox({ inputId, hiddenId, dropdownId, getOptions, emptyText, onSelectExtra }) {
    const input = document.getElementById(inputId);
    const hidden = document.getElementById(hiddenId);
    const dropdown = document.getElementById(dropdownId);

    function renderOptions(filterText) {
        const options = getOptions();
        const normalized = (filterText || '').trim().toLowerCase();
        const filtered = normalized ? options.filter(opt => opt.label.toLowerCase().includes(normalized)) : options;

        dropdown.innerHTML = '';
        if (filtered.length === 0) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'combo-empty';
            emptyEl.textContent = emptyText || 'لا توجد نتائج مطابقة';
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
                if (onSelectExtra) onSelectExtra(opt);
            });
            dropdown.appendChild(item);
        });
    }

    function openDropdown() { renderOptions(''); dropdown.classList.add('open'); }
    function closeDropdown() { dropdown.classList.remove('open'); }

    input.addEventListener('focus', () => { input.select(); openDropdown(); });
    input.addEventListener('input', () => { renderOptions(input.value); dropdown.classList.add('open'); });
    input.addEventListener('blur', () => setTimeout(closeDropdown, 150));
    document.addEventListener('click', (e) => { if (!input.contains(e.target) && !dropdown.contains(e.target)) closeDropdown(); });

    return { refresh: () => renderOptions(input.value) };
}

let taskCompanyComboApi = null;
let taskAssigneeComboApi = null;

function setupModalCombos() {
    taskCompanyComboApi = setupSearchableCombobox({
        inputId: 'taskCompanySearch',
        hiddenId: 'taskCompanyId',
        dropdownId: 'taskCompanyDropdown',
        getOptions: () => allCompanyOptions,
        emptyText: 'لا توجد شركات مطابقة',
        onSelectExtra: async (opt) => {
            await handleTaskCompanySelected(opt.value);
        }
    });

    taskAssigneeComboApi = setupSearchableCombobox({
        inputId: 'taskAssigneeSearch',
        hiddenId: 'taskAssignedTo',
        dropdownId: 'taskAssigneeDropdown',
        getOptions: () => window.__currentAssigneeOptions || [],
        emptyText: 'لا يوجد موظفون مرتبطون بهذه الشركة'
    });
}

async function handleTaskCompanySelected(companyId) {
    const assigneeInput = document.getElementById('taskAssigneeSearch');
    const assigneeHidden = document.getElementById('taskAssignedTo');
    assigneeInput.value = '';
    assigneeHidden.value = '';

    if (!companyId) {
        assigneeInput.disabled = true;
        assigneeInput.placeholder = 'اختر الشركة أولاً...';
        window.__currentAssigneeOptions = [];
        return;
    }

    assigneeInput.disabled = true;
    assigneeInput.placeholder = 'جاري تحميل الموظفين...';

    const employees = await loadEmployeesForCompany(companyId);
    window.__currentAssigneeOptions = employees.map(e => ({
        value: String(e.employee_id),
        label: e.job_title ? `${e.name} — ${e.job_title}` : e.name
    }));

    assigneeInput.disabled = false;
    assigneeInput.placeholder = employees.length ? 'ابحث عن موظف...' : 'لا يوجد موظفون مرتبطون بهذه الشركة';
}

// =========================================================================
// 9. فتح/إغلاق نافذة تعديل مهمة موجودة + الحفظ
//    (الإضافة أصبحت صفحة مستقلة add_task.html؛ هذه النافذة تُستخدم للتعديل فقط)
// =========================================================================
async function openTaskModal(taskId) {
    if (!taskId) { window.location.href = Routes.url('add_task'); return; }

    const form = document.getElementById('taskForm');
    form.reset();
    document.getElementById('taskId').value = '';
    document.getElementById('taskCompanyId').value = '';
    document.getElementById('taskAssignedTo').value = '';
    document.getElementById('taskAssigneeSearch').value = '';
    document.getElementById('taskAssigneeSearch').disabled = true;
    document.getElementById('taskAssigneeSearch').placeholder = 'اختر الشركة أولاً...';
    hideTaskFormAlert();
    document.querySelectorAll('#taskForm .field-error').forEach(el => el.textContent = '');

    document.getElementById('taskModalTitle').textContent = 'تعديل المهمة';
    const task = fullTasksDataset.find(t => t.id === taskId);
    if (task) {
        document.getElementById('taskId').value = task.id;
        document.getElementById('taskTitle').value = task.title || '';
        document.getElementById('taskType').value = task.type || 'مسندة';
        document.getElementById('taskStatus').value = task.status || 'قيد الانتظار';
        document.getElementById('taskStartDate').value = task.start_date || '';
        document.getElementById('taskDueDate').value = task.due_date || '';
        document.getElementById('taskNotes').value = task.notes || '';

        if (task.company_id) {
            const company = companiesById.get(String(task.company_id));
            document.getElementById('taskCompanyId').value = task.company_id;
            document.getElementById('taskCompanySearch').value = company ? company.name : '';

            await handleTaskCompanySelected(String(task.company_id));
            if (task.assigned_to) {
                document.getElementById('taskAssignedTo').value = task.assigned_to;
                const match = (window.__currentAssigneeOptions || []).find(o => o.value === String(task.assigned_to));
                document.getElementById('taskAssigneeSearch').value = match ? match.label : (task.assignee_name || '');
            }
        }
    }

    document.getElementById('taskModal').style.display = 'flex';
}

function closeTaskModal() {
    document.getElementById('taskModal').style.display = 'none';
    document.querySelectorAll('.task-actions-menu.open').forEach(m => m.classList.remove('open'));
}

function showTaskFormAlert(message, type) {
    const alertBox = document.getElementById('taskFormAlert');
    alertBox.textContent = message;
    alertBox.className = 'form-alert ' + (type === 'success' ? 'alert-success' : 'alert-error');
    alertBox.style.display = 'flex';
}
function hideTaskFormAlert() {
    document.getElementById('taskFormAlert').style.display = 'none';
}

async function handleTaskFormSubmit(event) {
    event.preventDefault();
    hideTaskFormAlert();

    const taskId = document.getElementById('taskId').value;
    const title = document.getElementById('taskTitle').value.trim();
    const type = document.getElementById('taskType').value;
    const status = document.getElementById('taskStatus').value;
    const companyId = document.getElementById('taskCompanyId').value;
    const assignedTo = document.getElementById('taskAssignedTo').value;
    const startDate = document.getElementById('taskStartDate').value;
    const dueDate = document.getElementById('taskDueDate').value;
    const notes = document.getElementById('taskNotes').value.trim();

    document.querySelectorAll('#taskForm .field-error').forEach(el => el.textContent = '');
    let hasError = false;
    if (!title) { document.getElementById('error-title').textContent = 'الرجاء إدخال عنوان المهمة.'; hasError = true; }
    if (!companyId) { document.getElementById('error-company_id').textContent = 'الرجاء اختيار الشركة.'; hasError = true; }
    if (startDate && dueDate && startDate > dueDate) {
        document.getElementById('error-due_date').textContent = 'يجب أن يكون "إلى تاريخ" بعد "من تاريخ" أو يساويه.';
        hasError = true;
    }
    if (hasError) return;

    const submitBtn = document.getElementById('btnSaveTask');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'جاري الحفظ...';

    const payload = {
        title,
        type,
        status,
        company_id: Number(companyId),
        assigned_to: assignedTo ? Number(assignedTo) : null,
        start_date: startDate || null,
        due_date: dueDate || null,
        notes: notes || null
    };

    try {
        if (taskId) {
            const { error } = await dbClient.from('tasks').update(payload).eq('id', taskId);
            if (error) throw error;
        } else {
            const { error } = await dbClient.from('tasks').insert(payload);
            if (error) throw error;
        }

        closeTaskModal();
        await loadTasks();

    } catch (error) {
        console.error('تعذّر حفظ المهمة:', error.message);
        showTaskFormAlert('فشلت العملية: ' + error.message, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
    }
}
