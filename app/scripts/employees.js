// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================

// =========================================================================
// 🛡️ نطاق رؤية المستخدم الحالي — نفس المنطق المستخدم بباقي شاشات النظام
// (المهام، الحضور والانصراف، إلخ): مسؤول الشركة (role='company') يرى فقط
// موظفي شركته/شركاته المملوكة (عبر employee_links)، والموظف (role='employee')
// يرى سجله الشخصي فقط، بينما super_admin/admin يريان كل الموظفين بلا قيود.
//
// ⚠️ إصلاح أمني مهم: هذه الشاشة لم تكن تحتوي إطلاقاً على أي تقييد بحسب
// الدور — كانت تجلب دائماً *كل* سجلات جدول employees (الاسم، رقم الهوية،
// الجوال، المستندات...) بغض النظر عن هوية المستخدم المسجّل دخوله، طالما
// يملك صلاحية عرض القسم فقط، بلا فرق بين مدير عام النظام وموظف عادي.
let currentUserScope = { role: null, employeeId: null };
let scopedEmployeeIds = null; // null = بلا تقييد (مدير عام/مسؤول)؛ مصفوفة = مُقيَّد بهذه المعرّفات فقط

async function loadCurrentUserScope() {
    try {
        const { data: { session } } = await dbClient.auth.getSession();
        if (!session) return;

        const { data: profileRow } = await dbClient.from('users').select('role').eq('id', session.user.id).maybeSingle();
        const role = profileRow?.role || null;

        if (role === 'company') {
            const { data: ownedCompanies } = await dbClient.from('companies').select('id').eq('user_id', session.user.id);
            const companyIds = (ownedCompanies || []).map(c => c.id);

            if (companyIds.length === 0) {
                scopedEmployeeIds = [];
            } else {
                // موظفو شركاته: الربط الحالي + الأرشيف (حتى تظهر له سجلات موظفيه
                // السابقين أيضاً، وليس فقط المرتبطين حالياً). الأرشيف طلب غير
                // معطِّل (قد لا يكون الجدول موجوداً بعد بقواعد بيانات قديمة).
                const idSet = new Set();
                const { data: activeLinks } = await dbClient.from('employee_links').select('employee_id').in('company_id', companyIds);
                (activeLinks || []).forEach(l => { if (l.employee_id != null) idSet.add(l.employee_id); });
                try {
                    const { data: historyLinks, error: historyError } = await dbClient
                        .from('employee_link_history').select('employee_id').in('company_id', companyIds);
                    if (historyError) throw historyError;
                    (historyLinks || []).forEach(l => { if (l.employee_id != null) idSet.add(l.employee_id); });
                } catch (historyErr) {
                    console.error('تعذّر تحميل أرشيف الروابط المنتهية لتحديد نطاق موظفي الشركة:', historyErr.message);
                }
                scopedEmployeeIds = Array.from(idSet);
            }
            currentUserScope = { role, employeeId: null };
        } else if (role === 'employee') {
            const { data: employeeRow } = await dbClient.from('employees').select('id').eq('user_id', session.user.id).maybeSingle();
            // employeeId = -1 لو تعذّر إيجاد سجل موظف مرتبط بهذا الحساب، حتى لا
            // يُفسَّر عدم التقييد بالخطأ ⇐ عرض كل الموظفين
            const employeeId = employeeRow ? employeeRow.id : -1;
            currentUserScope = { role, employeeId };
            scopedEmployeeIds = [employeeId];
        } else {
            currentUserScope = { role, employeeId: null };
            scopedEmployeeIds = null;
        }
    } catch (error) {
        console.error('تعذّر تحديد نطاق صلاحيات المستخدم الحالي:', error.message);
    }
}

let localEmployeesCache = [];
let filteredEmployeesCache = [];
let editingEmployeeId = null;

// 🔍 قائمة خيارات اقتراحات مربع البحث المنسدل — كل عنصر يحمل الاسم المعروض
// بالحقل بعد الاختيار (label) بالإضافة لرقم الهوية (nationalId) الذي يُستخدم
// للبحث فقط ويظهر كنص فرعي (sublabel) داخل عنصر القائمة، حتى يعمل البحث
// باسم الموظف أو برقم هويته معاً من نفس الحقل.
let allEmployeeSearchOptions = [];

// 🔗 خريطة المسمى الوظيفي الفعلي لكل موظف مرتبط (employee_id -> job_title)، مصدرها
// جدول employee_links. نستخدمها بدل عمود employees.job_title الذي أصبح دائماً
// "غير محدد" منذ حذف حقل المسمى الوظيفي من نموذج إضافة الموظف — المسمى الحقيقي
// يُحدَّد فقط عند ربط الموظف بشركة عبر شاشة "ربط الموظفين".
let employeeLinkedJobTitleMap = {};

// Pagination Settings — 🆕 15 صفاً بالصفحة بدل 7
let currentEmpPage = 1;
const empsPerPage = 15;

// 📅 تاريخ اليوم بصيغة YYYY-MM-DD حسب توقيت جهاز المستخدم — يُستخدم لتقييد جلب
// مسميات الربط الوظيفية على الروابط النشطة فقط. ⚠️ ضروري بعد أن أصبح "إنهاء
// ربط موظف" يُسجِّل تاريخ انتهاء بدل حذف السجل فعلياً: بدون هذا الفلتر قد
// يظهر لموظف منتهي الربط مسمى وظيفي قديم بدل "غير محدد".
function getTodayDateStringForLinks() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

document.querySelector('.btn-add-employee').addEventListener('click', function() {
    window.location.href = Routes.url('add_employee');
});


document.addEventListener('DOMContentLoaded', async () => {
    const allowed = await Permissions.guardPage('employees');
    if (!allowed) return;

    injectEmployeeRowActionStyles();

    await loadCurrentUserScope();

    fetchAndRenderEmployees();
    setupEmployeeSearchCombo();

    const employeeForm = document.getElementById('addEmployeeForm');
    if (employeeForm) {
        employeeForm.addEventListener('submit', handleEmployeeSubmission);
    }
});

// =========================================================================
// 🆕 تنسيقات صف الموظف القابل للنقر + زر "عرض بيانات الموظف" + قائمة الثلاث
// نقاط (⋮) — تُحقن من هنا مباشرة (بدل ملف employees.css المشترك بين شاشات
// كثيرة) لتبقى هذه الميزة مستقلة تماماً عن أي ذاكرة تخزين مؤقت لملف مشترك.
// =========================================================================
function injectEmployeeRowActionStyles() {
    if (document.getElementById('empRowActionStyles')) return;
    const style = document.createElement('style');
    style.id = 'empRowActionStyles';
    style.textContent = `
        #employeesTableBody tr.emp-row-clickable { cursor: pointer; transition: background-color 0.12s ease; }
        #employeesTableBody tr.emp-row-clickable:hover { background-color: #f8fafc; }

        .emp-actions-cell { display: inline-flex; align-items: center; justify-content: center; gap: 8px; }

        .emp-view-btn {
            display: inline-flex; align-items: center; justify-content: center;
            width: 32px; height: 32px; padding: 0;
            background-color: #fff7ed; color: #c2410c;
            border: 1px solid #fed7aa; border-radius: 6px;
            font-family: inherit; cursor: pointer;
            transition: background-color 0.15s ease;
        }
        .emp-view-btn:hover { background-color: #ffedd5; }
        .emp-view-btn svg { width: 17px; height: 17px; flex-shrink: 0; }

        .emp-more-btn {
            display: inline-flex; align-items: center; justify-content: center;
            width: 32px; height: 32px; padding: 0;
            background: #ffffff; color: #475569;
            border: 1px solid #e2e8f0; border-radius: 6px; cursor: pointer;
            transition: background-color 0.15s ease, border-color 0.15s ease;
        }
        .emp-more-btn:hover, .emp-more-btn.open { background-color: #f1f5f9; border-color: #cbd5e1; }
        .emp-more-btn svg { width: 18px; height: 18px; }

        #empRowMenu {
            position: fixed; z-index: 3000; min-width: 190px;
            background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px;
            box-shadow: 0 10px 28px rgba(15, 23, 42, 0.16);
            padding: 6px; display: none; direction: rtl;
        }
        #empRowMenu.open { display: block; }
        #empRowMenu .emp-menu-item {
            display: flex; align-items: center; gap: 10px; width: 100%;
            background: none; border: none; border-radius: 6px;
            padding: 9px 12px; font-size: 13.5px; font-weight: 600;
            font-family: inherit; color: #334155; cursor: pointer; text-align: start;
        }
        #empRowMenu .emp-menu-item:hover { background-color: #f1f5f9; }
        #empRowMenu .emp-menu-item svg { width: 16px; height: 16px; flex-shrink: 0; }
        #empRowMenu .emp-menu-item.danger { color: #dc2626; }
        #empRowMenu .emp-menu-item.danger:hover { background-color: #fef2f2; }
        #empRowMenu .emp-menu-divider { height: 1px; background: #f1f5f9; margin: 4px 0; }
    `;
    document.head.appendChild(style);
}

// أيقونة الثلاث نقاط العمودية (⋮)
const EMP_MORE_ICON_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>`;

// =========================================================================
// 🆕 قائمة خيارات الصف (⋮): تعديل / إضافة للقائمة السوداء / حذف — قائمة
// واحدة عائمة (position: fixed) تُبنى عند الطلب وتُوضع بجانب الزر الذي ضُغط،
// حتى لا تُقصّ داخل حاوية الجدول. كل خيار يحمل data-perm الخاص به، فيظهر فقط
// لمن يملك الصلاحية المطابقة.
// =========================================================================
let empRowMenuEl = null;
let empRowMenuAnchorBtn = null;

function getEmpRowMenu() {
    if (empRowMenuEl) return empRowMenuEl;
    empRowMenuEl = document.createElement('div');
    empRowMenuEl.id = 'empRowMenu';
    empRowMenuEl.setAttribute('role', 'menu');
    document.body.appendChild(empRowMenuEl);

    document.addEventListener('click', (e) => {
        if (!empRowMenuEl.classList.contains('open')) return;
        if (empRowMenuEl.contains(e.target)) return;
        if (empRowMenuAnchorBtn && empRowMenuAnchorBtn.contains(e.target)) return;
        closeEmpRowMenu();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeEmpRowMenu(); });
    window.addEventListener('resize', closeEmpRowMenu);
    window.addEventListener('scroll', closeEmpRowMenu, true);
    return empRowMenuEl;
}

function closeEmpRowMenu() {
    if (!empRowMenuEl) return;
    empRowMenuEl.classList.remove('open');
    if (empRowMenuAnchorBtn) empRowMenuAnchorBtn.classList.remove('open');
    empRowMenuAnchorBtn = null;
}

function openEmpRowMenu(anchorBtn, empId) {
    const menu = getEmpRowMenu();

    // الضغط على نفس الزر مرة ثانية يغلق القائمة
    if (menu.classList.contains('open') && empRowMenuAnchorBtn === anchorBtn) {
        closeEmpRowMenu();
        return;
    }
    closeEmpRowMenu();

    menu.innerHTML = '';

    const items = [
        { perm: 'edit:employees', icon: ICONS.edit, label: 'تعديل بيانات الموظف', danger: false, run: () => editEmployee(empId) },
        { perm: 'delete:employees', icon: ICONS.blocked, label: 'إضافة للقائمة السوداء', danger: false, run: () => blacklistEmployee(empId) },
        { divider: true, perm: 'delete:employees' },
        { perm: 'delete:employees', icon: ICONS.trash, label: 'حذف الموظف', danger: true, run: () => deleteEmployee(empId) }
    ];

    items.forEach(item => {
        if (item.divider) {
            const div = document.createElement('div');
            div.className = 'emp-menu-divider';
            div.setAttribute('data-perm', item.perm);
            menu.appendChild(div);
            return;
        }
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'emp-menu-item' + (item.danger ? ' danger' : '');
        btn.setAttribute('role', 'menuitem');
        btn.setAttribute('data-perm', item.perm);
        btn.innerHTML = `${item.icon || ''}<span>${item.label}</span>`;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeEmpRowMenu();
            item.run();
        });
        menu.appendChild(btn);
    });

    // إظهار الخيارات المسموحة فقط حسب صلاحيات المستخدم
    Permissions.applyButtonGating(menu);

    // قياس القائمة أولاً (مخفية بصرياً) ثم تحديد موضعها بجانب الزر مع إبقائها داخل الشاشة
    menu.style.visibility = 'hidden';
    menu.classList.add('open');
    const btnRect = anchorBtn.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();

    let left = btnRect.left;
    if (left + menuRect.width > window.innerWidth - 8) left = window.innerWidth - menuRect.width - 8;
    if (left < 8) left = 8;

    let top = btnRect.bottom + 4;
    if (top + menuRect.height > window.innerHeight - 8) top = btnRect.top - menuRect.height - 4;
    if (top < 8) top = 8;

    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    menu.style.visibility = 'visible';

    anchorBtn.classList.add('open');
    empRowMenuAnchorBtn = anchorBtn;
}

// =========================================================================
// 🔍 مربع بحث قابل للكتابة فيه مع قائمة اقتراحات منسدلة (Searchable Combobox)
//     يعرض أسماء الموظفين المطابقة أثناء الكتابة — سواء بحثاً بالاسم أو رقم
//     الهوية (رقم الهوية يظهر كنص فرعي أسفل كل اقتراح لمساعدة التمييز بين
//     الأسماء المتشابهة) — مع خيار "✕ كل الموظفين" لمسح البحث، بالإضافة
//     لتطبيق الفلترة الفورية حرفاً بحرف كما كان سابقاً.
// =========================================================================
function setupEmployeeSearchCombo() {
    const input = document.getElementById('employeeSearchInput');
    const dropdown = document.getElementById('employeeSearchDropdown');
    if (!input || !dropdown) return;

    function renderSuggestions(query) {
        const normalized = (query || '').trim().toLowerCase();
        const matches = normalized
            ? allEmployeeSearchOptions.filter(opt =>
                opt.label.toLowerCase().includes(normalized) ||
                (opt.nationalId && opt.nationalId.toLowerCase().includes(normalized))
              )
            : allEmployeeSearchOptions;

        dropdown.innerHTML = '';

        // اقتراح ثابت أعلى القائمة لمسح البحث والعودة لعرض كل الموظفين
        const clearItem = document.createElement('div');
        clearItem.className = 'combo-item combo-item-clear';
        clearItem.textContent = '✕ كل الموظفين';
        clearItem.addEventListener('mousedown', (e) => {
            e.preventDefault();
            input.value = '';
            closeDropdown();
            applyEmployeeFilters();
        });
        dropdown.appendChild(clearItem);

        if (matches.length === 0) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'combo-empty';
            emptyEl.textContent = 'لا يوجد موظفون مطابقون';
            dropdown.appendChild(emptyEl);
            return;
        }

        matches.slice(0, 30).forEach(opt => {
            const item = document.createElement('div');
            item.className = 'combo-item';
            if (input.value.trim() === opt.label) item.classList.add('selected');

            // عرض الاسم مع رقم الهوية كنص فرعي صغير (إن وُجد) لمساعدة التمييز
            const nameEl = document.createElement('span');
            nameEl.textContent = opt.label;
            item.appendChild(nameEl);
            if (opt.nationalId) {
                const idEl = document.createElement('span');
                idEl.style.cssText = 'display:block; font-size:11px; color:#94a3b8; margin-top:2px;';
                idEl.textContent = '🪪 ' + opt.nationalId;
                item.appendChild(idEl);
            }

            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                input.value = opt.label;
                closeDropdown();
                applyEmployeeFilters();
            });
            dropdown.appendChild(item);
        });
    }

    function openDropdown() {
        renderSuggestions(input.value);
        dropdown.classList.add('open');
    }

    function closeDropdown() {
        dropdown.classList.remove('open');
    }

    input.addEventListener('focus', openDropdown);

    input.addEventListener('input', () => {
        renderSuggestions(input.value);
        dropdown.classList.add('open');
        applyEmployeeFilters();
    });

    input.addEventListener('blur', () => {
        setTimeout(closeDropdown, 150);
    });

    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !dropdown.contains(e.target)) {
            closeDropdown();
        }
    });
}

// 📊 دالة جلب الموظفين حياً من سوبابيس، مع جلب مسميات الربط الوظيفية بالتوازي
async function fetchAndRenderEmployees() {
    const tableBody = document.getElementById('employeesTableBody');
    if (!tableBody) return;

    // 🛡️ تقييد جلب الموظفين بنطاق المستخدم الحالي (انظر تعليق نطاق الرؤية أعلى
    // الملف) — بلا هذا التقييد كان أي مستخدم (بما فيه دور "موظف") يرى بيانات
    // كل الموظفين بالنظام، وليس فقط سجله الشخصي أو موظفي شركته.
    let employeesQuery = dbClient.from('employees').select('*').order('created_at', { ascending: false });
    if (scopedEmployeeIds !== null) employeesQuery = employeesQuery.in('id', scopedEmployeeIds);

    const [
        { data: employees, error },
        { data: links, error: linksError }
    ] = await Promise.all([
        employeesQuery,
        // ⚠️ روابط نشطة فقط (بلا تاريخ انتهاء، أو لم يأتِ تاريخ انتهائها بعد) —
        // انظر تعليق getTodayDateStringForLinks أعلى الملف.
        dbClient.from('employee_links').select('employee_id, job_title')
            .or(`link_end_date.is.null,link_end_date.gte.${getTodayDateStringForLinks()}`)
    ]);

    if (error) {
        console.error("خطأ في الاتصال بقاعدة البيانات:", error.message);
        tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#ef4444; padding:20px;">فشل تحميل بيانات الموظفين.</td></tr>`;
        return;
    }

    // بناء خريطة (employee_id -> job_title) من سجلات الربط لعرض المسمى الوظيفي
    // الفعلي فقط للموظفين المرتبطين بشركة؛ نتجاهل فشل هذا الجلب بصمت (غير حرج)
    // ونكتفي بعرض "غير محدد" بدل توقف الجدول بالكامل عن العرض.
    employeeLinkedJobTitleMap = {};
    if (linksError) {
        console.error('تعذّر تحميل مسميات الربط الوظيفية:', linksError.message);
    } else {
        (links || []).forEach(link => {
            if (link.employee_id != null && link.job_title) {
                employeeLinkedJobTitleMap[String(link.employee_id)] = link.job_title;
            }
        });
    }

    localEmployeesCache = employees;
    filteredEmployeesCache = employees;
    currentEmpPage = 1;

    // تحديث قائمة اقتراحات البحث (اسم + رقم هوية) — رقم الهوية يُحوَّل صراحة
    // إلى نص (String) لأن عمود national_id قد يعود من سوبابيس كرقم (number)
    // حسب نوعه الفعلي بقاعدة البيانات، وليس بالضرورة كنص (string) دائماً.
    const seenNames = new Set();
    allEmployeeSearchOptions = (employees || [])
        .filter(e => {
            if (!e.name || seenNames.has(e.name)) return false;
            seenNames.add(e.name);
            return true;
        })
        .map(e => ({
            label: e.name,
            nationalId: e.national_id != null ? String(e.national_id) : ''
        }))
        .sort((a, b) => a.label.localeCompare(b.label, 'ar'));

    renderEmployeesTable(filteredEmployeesCache);
}

// 📑 بناء أسطر الجدول وتوليد الدوائر التعريفية الثنائية تلقائياً بناءً على الاسم الأول
function renderEmployeesTable(data) {
    const tableBody = document.getElementById('employeesTableBody');
    if (!tableBody) return;
    closeEmpRowMenu();
    tableBody.innerHTML = '';

    if (!data || data.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:30px; color:#94a3b8;">لا يوجد موظفون متطابقون مع خيارات البحث.</td></tr>`;
        setupEmpPaginationControls(0);
        return;
    }

    // عرض 15 صفاً بالصفحة (empsPerPage)
    const startIndex = (currentEmpPage - 1) * empsPerPage;
    const endIndex = startIndex + empsPerPage;
    const paginatedData = data.slice(startIndex, endIndex);

    paginatedData.forEach(emp => {
        const row = document.createElement('tr');

        // Extract initials for the avatar circle (e.g. "أنس سعيد" -> "أس")
        const nameParts = (emp.name || '').trim().split(' ').filter(p => p.length > 0);
        let initials = 'مو'; // Default fallback characters
        if (nameParts.length >= 2) {
            initials = nameParts[0][0] + nameParts[1][0];
        } else if (nameParts.length === 1) {
            initials = nameParts[0].substring(0, 2);
        }

        // Generate stable, deterministic backgrounds matching your design mix
        const charCodeSum = [...initials].reduce((acc, char) => acc + char.charCodeAt(0), 0);
        let prefixColorClass = 'prefix-blue';
        if (charCodeSum % 2 === 0) prefixColorClass = 'prefix-yellow';
        if (charCodeSum % 3 === 0) prefixColorClass = 'prefix-orange';

        // ترجمة قيمة الحالة المخزّنة (active/inactive) لنص وشارة عربية مناسبة
        const isActiveStatus = emp.status !== 'inactive';
        const statusBadgeClass = isActiveStatus ? 'status-badge-active' : 'status-badge-inactive';
        const statusLabel = isActiveStatus ? 'نشط' : 'غير نشط';

        // 🏷️ المسمى الوظيفي: يُعرض المسمى الفعلي من سجل الربط إن كان الموظف مرتبطاً
        // بشركة (من جدول employee_links)، وإلا يُعرض "غير محدد".
        const linkedJobTitle = employeeLinkedJobTitleMap[String(emp.id)];
        const jobTitleDisplay = linkedJobTitle || 'غير محدد';

        // 📧 البريد الإلكتروني: يُعرض "لا يوجد" بدل الشرطات عند عدم وجود بريد مسجّل
        const emailDisplay = emp.email || 'لا يوجد';

        // 🆕 عمود الإجراءات: زر "عرض البيانات" ظاهر دائماً + زر ثلاث نقاط (⋮)
        // يفتح قائمة بباقي الخيارات (تعديل / قائمة سوداء / حذف)
        row.innerHTML = `
            <td>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <span class="company-prefix ${prefixColorClass}">${initials}</span>
                    <strong style="color: #1e293b;">${emp.name || '----'}</strong>
                </div>
            </td>
            <td style="color: #475569; font-family: monospace; font-size: 0.95rem;">${emp.national_id || '----'}</td>
            <td style="color: #475569; font-family: monospace;">${emailDisplay}</td>
            <td style="font-weight: 500; color: #334155;">${jobTitleDisplay}</td>
            <td style="text-align: center;">
                <span class="${statusBadgeClass}">${statusLabel}</span>
            </td>
            <td style="text-align: center;">
                <div class="emp-actions-cell">
                    <button type="button" class="emp-view-btn" data-perm="view:employees" title="عرض بيانات الموظف">${ICONS.eye}</button>
                    <button type="button" class="emp-more-btn" data-perm="edit:employees,delete:employees" title="المزيد من الخيارات" aria-haspopup="menu" aria-label="المزيد من الخيارات">${EMP_MORE_ICON_SVG}</button>
                </div>
            </td>
        `;

        const viewBtn = row.querySelector('.emp-view-btn');
        if (viewBtn) viewBtn.addEventListener('click', (e) => { e.stopPropagation(); viewEmployee(emp.id); });

        const moreBtn = row.querySelector('.emp-more-btn');
        if (moreBtn) moreBtn.addEventListener('click', (e) => { e.stopPropagation(); openEmpRowMenu(moreBtn, emp.id); });

        // 🆕 الضغط على أي مكان بالصف يعرض بيانات الموظف (باستثناء أزرار الإجراءات)
        row.classList.add('emp-row-clickable');
        row.title = 'عرض بيانات الموظف';
        row.addEventListener('click', (e) => {
            if (e.target.closest('button, a, input, select, textarea')) return;
            viewEmployee(emp.id);
        });

        tableBody.appendChild(row);
    });

    setupEmpPaginationControls(data.length);

    // 🛡️ العناصر أعلاه (أزرار عرض البيانات والثلاث نقاط) بُنيت للتو ديناميكياً وتحمل
    // السمة data-perm — يجب تطبيق حارس الصلاحيات عليها يدوياً هنا لإظهارها فقط
    // لمن يملك الصلاحية المطابقة (تُستدعى هذه الدالة أيضاً بكل إعادة رسم عبر
    // البحث/الفلترة/التنقل بين الصفحات، فتغطي كل حالات إعادة الرسم تلقائياً).
    Permissions.applyButtonGating(tableBody);
}

// 🔍 دالة الفلترة المُوحّدة: تجمع بحث النص الحر (اسم/بريد/هوية) مع فلتر الحالة معاً
//     (كانت الحالة والبحث لا يعملان سابقاً بسبب استدعاء دالة غير معرّفة أصلاً
//     "handleFilterChange" من الـ HTML، والبحث كان يتجاهل فلتر الحالة كلياً)
//
//     ⚠️ إصلاح إضافي: عمود national_id قد يعود من سوبابيس كرقم (number) وليس
//     دائماً كنص (string) حسب نوعه الفعلي بقاعدة البيانات — استدعاء .includes()
//     مباشرة على رقم كان يتسبب بخطأ JS صامت (TypeError) يوقف الفلترة بالكامل،
//     فيبدو للمستخدم أن البحث "لا يعمل" تماماً كلما وصل الفحص لهذا الحقل. الحل:
//     تحويل القيمة صراحة إلى نص عبر String(...) قبل البحث فيها.
function applyEmployeeFilters() {
    const text = (document.getElementById('employeeSearchInput')?.value || '').toLowerCase().trim();
    const statusValue = document.getElementById('statusFilter')?.value || 'all';

    filteredEmployeesCache = localEmployeesCache.filter(e => {
        const matchesText = !text ||
            (e.name && e.name.toLowerCase().includes(text)) ||
            (e.email && e.email.toLowerCase().includes(text)) ||
            (e.national_id != null && String(e.national_id).toLowerCase().includes(text));

        const isActiveStatus = e.status !== 'inactive';
        const matchesStatus = statusValue === 'all' ||
            (statusValue === 'active' && isActiveStatus) ||
            (statusValue === 'inactive' && !isActiveStatus);

        return matchesText && matchesStatus;
    });

    currentEmpPage = 1;
    renderEmployeesTable(filteredEmployeesCache);
}

// 📟 بناء عداد التنقل بين صفحات الموظفين أسفل الجدول
function setupEmpPaginationControls(totalItems) {
    const controlsContainer = document.getElementById('employeesPagination');
    if (!controlsContainer) return;
    controlsContainer.innerHTML = '';

    const totalPages = Math.ceil(totalItems / empsPerPage);
    if (totalPages <= 1) return;

    const isEnglish = document.documentElement.getAttribute('lang') === 'en';

    const prevBtn = document.createElement('button');
    prevBtn.innerHTML = isEnglish ? '&larr; Prev' : '&rarr; السابقة';
    prevBtn.disabled = currentEmpPage === 1;
    prevBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;';
    if (prevBtn.disabled) prevBtn.style.opacity = '0.5';
    prevBtn.onclick = () => {
        if (currentEmpPage > 1) {
            currentEmpPage--;
            renderEmployeesTable(filteredEmployeesCache);
        }
    };
    controlsContainer.appendChild(prevBtn);

    const countLabel = document.createElement('span');
    countLabel.style.cssText = 'font-size: 0.9rem; color: #475569; font-weight: 600; font-family: system-ui, sans-serif; margin: 0 10px;';
    countLabel.textContent = isEnglish ? `Page ${currentEmpPage} of ${totalPages}` : `صفحة ${currentEmpPage} من ${totalPages}`;
    controlsContainer.appendChild(countLabel);

    const nextBtn = document.createElement('button');
    nextBtn.innerHTML = isEnglish ? 'Next &rarr;' : 'التالية &larr;';
    nextBtn.disabled = currentEmpPage === totalPages;
    nextBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;';
    if (nextBtn.disabled) nextBtn.style.opacity = '0.5';
    nextBtn.onclick = () => {
        if (currentEmpPage < totalPages) {
            currentEmpPage++;
            renderEmployeesTable(filteredEmployeesCache);
        }
    };
    controlsContainer.appendChild(nextBtn);
}

// =========================================================================
// 🗑️ حذف الموظف — يُمنع الحذف إن كان للموظف بيانات مرتبطة به (ربط بشركة، سجل
// ربط منتهٍ، حضور، مهام، تحصيل...)، مع رسالة عربية واضحة تذكر نوع البيانات
// المرتبطة وعددها بدل رسالة الخطأ التقنية الخام من قاعدة البيانات.
// =========================================================================

// أسماء عربية مقروءة للجداول التي قد تمنع حذف الموظف (قيد المفتاح الأجنبي)
const EMPLOYEE_RELATED_TABLE_LABELS = {
    employee_links: 'ربط بشركة',
    employee_link_history: 'سجل ربط منتهٍ',
    attendance: 'سجلات حضور وانصراف',
    attendance_records: 'سجلات حضور وانصراف',
    tasks: 'مهام',
    employee_tasks: 'مهام',
    employee_collections: 'سجلات تحصيل',
    invoices: 'فواتير',
    employee_blacklist: 'قائمة سوداء'
};

// يعدّ سجلات جدول مرتبطة بالموظف؛ يُرجع 0 عند أي خطأ (جدول/عمود غير موجود...)
async function countEmployeeRelatedRows(table, id) {
    try {
        const { count, error } = await dbClient
            .from(table).select('*', { count: 'exact', head: true }).eq('employee_id', id);
        if (error) return 0;
        return count || 0;
    } catch (e) {
        return 0;
    }
}

function showEmployeeBlockedMessage(relatedParts) {
    alert(
        'لا يمكن حذف هذا الموظف لأن لديه بيانات مرتبطة به:\n\n' +
        relatedParts.map(p => '• ' + p).join('\n') +
        '\n\nيمكنك بدلاً من ذلك إنهاء ربطه بالشركة أو إضافته للقائمة السوداء.'
    );
}

async function deleteEmployee(id) {
    // 1. فحص مسبق للبيانات المرتبطة المعروفة
    const [linksCount, historyCount] = await Promise.all([
        countEmployeeRelatedRows('employee_links', id),
        countEmployeeRelatedRows('employee_link_history', id)
    ]);

    const relatedParts = [];
    if (linksCount > 0) relatedParts.push(`${EMPLOYEE_RELATED_TABLE_LABELS.employee_links} (${linksCount})`);
    if (historyCount > 0) relatedParts.push(`${EMPLOYEE_RELATED_TABLE_LABELS.employee_link_history} (${historyCount})`);

    if (relatedParts.length > 0) {
        showEmployeeBlockedMessage(relatedParts);
        return;
    }

    if (!confirm('هل أنت متأكد من حذف هذا الموظف نهائياً؟')) return;

    try {
        // .select() لمعرفة هل حُذف سجل فعلاً (سياسات RLS قد تمنع الحذف بصمت)
        const { data: deletedRows, error } = await dbClient.from('employees').delete().eq('id', id).select();
        if (error) throw error;

        if (!deletedRows || deletedRows.length === 0) {
            alert('لم يتم حذف الموظف فعلياً. قد تكون صلاحية الحذف (RLS DELETE Policy) غير مفعّلة على جدول employees في سوبابيس.');
            return;
        }

        alert('تم حذف الموظف بنجاح!');
        await fetchAndRenderEmployees();
    } catch (err) {
        const rawMsg = (err && (err.message || err.details)) || '';
        const isForeignKeyError = err && (err.code === '23503' || /foreign key/i.test(rawMsg));
        if (isForeignKeyError) {
            // اسم الجدول المرتبط يأتي بنهاية رسالة الخطأ: ... on table "attendance"
            const matches = [...rawMsg.matchAll(/on table "([^"]+)"/g)];
            const relatedTable = matches.length ? matches[matches.length - 1][1] : null;
            const label = relatedTable ? (EMPLOYEE_RELATED_TABLE_LABELS[relatedTable] || `سجلات في جدول (${relatedTable})`) : 'سجلات أخرى';
            showEmployeeBlockedMessage([label]);
            return;
        }
        alert('فشلت العملية: ' + rawMsg);
    }
}

// 👁️ دالة الانتقال لصفحة استعراض بيانات الموظف الكاملة (view_employee.html)
function viewEmployee(id) {
    window.location.href = (Routes.url('view_employee') + '?id=') + encodeURIComponent(id);
}

// 📝 دالة الانتقال لصفحة تعديل بيانات الموظف الكاملة (edit_employee.html)
function editEmployee(id) {
    window.location.href = (Routes.url('edit_employee') + '?id=') + encodeURIComponent(id);
}

// 🚫 إضافة موظف للقائمة السوداء (يمنعه من إعادة التوظيف مستقبلاً برقم هويته)
// كما تُعطَّل حالة الموظف تلقائياً (تصبح "غير نشط") فور إضافته للقائمة السوداء —
// الحالة تتبع نشاط الربط/الحظر تلقائياً، ولا تُدار يدوياً من شاشة التعديل.
async function blacklistEmployee(id) {
    const emp = localEmployeesCache.find(e => String(e.id) === String(id));
    if (!emp) return;

    const isEnglish = document.documentElement.getAttribute('lang') === 'en';

    if (!emp.national_id) {
        alert(isEnglish ? 'This employee has no national ID on record.' : 'لا يوجد رقم هوية مسجّل لهذا الموظف.');
        return;
    }

    const reason = prompt(
        isEnglish
            ? `Add "${emp.name}" to the blacklist. Please enter a reason:`
            : `إضافة "${emp.name}" للقائمة السوداء. الرجاء إدخال السبب:`
    );

    if (reason === null) return; // المستخدم ألغى العملية
    if (!reason.trim()) {
        alert(isEnglish ? 'A reason is required.' : 'السبب مطلوب لإتمام الإضافة للقائمة السوداء.');
        return;
    }

    try {
        // فحص عدم تكرار نفس رقم الهوية بالقائمة السوداء مسبقاً
        const { data: existing, error: checkError } = await dbClient
            .from('employee_blacklist')
            .select('id')
            .eq('national_id', emp.national_id)
            .maybeSingle();

        if (checkError) throw new Error(checkError.message);

        if (existing) {
            alert(isEnglish ? 'This national ID is already blacklisted.' : 'رقم الهوية هذا مضاف بالفعل للقائمة السوداء.');
            return;
        }

        const { error } = await dbClient
            .from('employee_blacklist')
            .insert([{
                national_id: emp.national_id,
                name: emp.name,
                reason: reason.trim()
            }]);

        if (error) throw new Error(error.message);

        // 🚫 تعطيل حالة الموظف تلقائياً فور إضافته للقائمة السوداء
        const { error: statusUpdateError } = await dbClient
            .from('employees')
            .update({ status: 'inactive' })
            .eq('id', id);

        if (statusUpdateError) {
            console.error('تعذّر تحديث حالة الموظف تلقائياً بعد الحظر:', statusUpdateError.message);
        }

        alert(isEnglish ? 'Added to the blacklist successfully.' : 'تمت الإضافة للقائمة السوداء بنجاح.');
        await fetchAndRenderEmployees();
    } catch (error) {
        console.error('Blacklist Error:', error.message);
        alert((isEnglish ? 'Failed: ' : 'فشلت العملية: ') + error.message);
    }
}
