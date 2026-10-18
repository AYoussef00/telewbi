// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================
const SUPABASE_URL = "https://mcdhxdfkuokhmhtfvjev.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_yt9V8lsNU1zN3Ix2CvovbQ_QCA2VDdM";
const dbClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 🛡️ نفس منطق نطاق الرؤية المستخدم بتقرير المهام: مسؤول الشركة (role='company')
// يرى فقط موظفي شركته/شركاته المملوكة، بينما super_admin/admin يريان الجميع.
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

// مخزن بيانات التقرير الكامل (بعد الربط بين الجداول) ونسخة الفلترة الحالية
let fullReportDataset = [];
let filteredReportDataset = [];

// قوائم القيم المميزة (Distinct) المستخدمة لتغذية اقتراحات قوائم البحث القابلة للكتابة فيها
let allEmployeeNameOptions = [];
let allCompanyNameOptions = [];

// إعدادات تقسيم الصفحات
let currentReportPage = 1;
const reportRowsPerPage = 10;

// 📅 تاريخ اليوم بصيغة YYYY-MM-DD حسب توقيت جهاز المستخدم — يُستخدم لتقييد جلب
// روابط الموظفين (شركة/مسمى وظيفي/نوع ربط كل موظف بالتقرير) على الروابط النشطة فقط.
// ⚠️ ضروري بعد أن أصبح "إنهاء ربط موظف" يُسجِّل تاريخ انتهاء بدل حذف السجل
// فعلياً: بدون هذا الفلتر قد تظهر شركة/مسمى وظيفي قديمين مُنهيين لموظف انتهى
// ربطه، أو حتى تُقيَّد رؤية مسؤول الشركة بالخطأ لموظف لم يعد ضمن شركته فعلياً.
function getTodayDateStringForLinks() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

document.addEventListener('DOMContentLoaded', async () => {
    const allowed = await Permissions.guardPage('reports_employees');
    if (!allowed) return;

    // قائمتا بحث قابلتان للكتابة فيها (Searchable Combobox) لاسم الموظف واسم الشركة
    setupSearchCombo({
        inputId: 'reportEmployeeSearchInput',
        dropdownId: 'reportEmployeeDropdown',
        clearLabel: 'كل الموظفين',
        emptyText: 'لا يوجد موظفون مطابقون',
        getOptions: () => allEmployeeNameOptions,
        onQueryChange: applyReportFilters
    });

    setupSearchCombo({
        inputId: 'reportCompanySearchInput',
        dropdownId: 'reportCompanyDropdown',
        clearLabel: 'كل الشركات',
        emptyText: 'لا توجد شركات مطابقة',
        getOptions: () => allCompanyNameOptions,
        onQueryChange: applyReportFilters
    });

    const statusFilter = document.getElementById('reportStatusFilter');
    if (statusFilter) statusFilter.addEventListener('change', applyReportFilters);

    const btnExport = document.getElementById('btnExportExcel');
    if (btnExport) btnExport.addEventListener('click', exportReportToExcel);

    const btnPrint = document.getElementById('btnPrintReport');
    if (btnPrint) btnPrint.addEventListener('click', printEmployeeReport);

    await loadCurrentUserScope();
    await loadEmployeeReportData();
});

// =========================================================================
// 1ب. مكوّن قائمة بحث قابلة للكتابة فيها (Searchable Filter Combobox)
//     على عكس قوائم نماذج إضافة/تعديل الموظف، هذا المكوّن لا يفرض اختيار قيمة
//     محددة بدقة؛ فهو أداة تصفية حرة للتقرير: يمكن الكتابة الحرة للبحث الفوري
//     أو اختيار اقتراح جاهز من القائمة المنسدلة أسفل الحقل.
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

        // اقتراح ثابت أعلى القائمة لمسح الفلتر والعودة لعرض الكل
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

    function closeDropdown() {
        dropdown.classList.remove('open');
    }

    input.addEventListener('focus', () => openDropdown());

    input.addEventListener('input', () => {
        renderSuggestions(input.value);
        dropdown.classList.add('open');
        onQueryChange();
    });

    input.addEventListener('blur', () => {
        // تأخير بسيط لضمان تنفيذ حدث mousedown الخاص باختيار عنصر من القائمة أولاً
        setTimeout(closeDropdown, 150);
    });

    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !dropdown.contains(e.target)) {
            closeDropdown();
        }
    });
}

// =========================================================================
// 1ج. جلب كامل صفوف جدول ما على دفعات (Pagination) — سوبابيس (PostgREST)
//     يفرض حداً افتراضياً 1000 صف كحد أقصى لكل طلب، وأي طلب select('*') بلا
//     .range() صريح كان يُقتطع صامتاً عند تجاوز هذا الحد فلا تظهر كل البيانات
//     بالجدول (نفس المشكلة التي أُصلحت بتقريري الحضور والانصراف والمهام).
//     builderFactory(from, to) يجب أن يُعيد استعلام سوبابيس جاهزاً (Promise)
//     مع .range(from, to) مُطبّق عليه بالفعل.
// =========================================================================
const REPORT_FETCH_PAGE_SIZE = 1000;

async function fetchAllRows(builderFactory) {
    let allRows = [];
    let from = 0;

    while (true) {
        const { data, error } = await builderFactory(from, from + REPORT_FETCH_PAGE_SIZE - 1);
        if (error) throw error;

        allRows = allRows.concat(data || []);

        if (!data || data.length < REPORT_FETCH_PAGE_SIZE) break; // آخر صفحة
        from += REPORT_FETCH_PAGE_SIZE;
    }

    return allRows;
}

// =========================================================================
// 2. جلب بيانات الموظفين + الشركات ودمجها في تقرير واحد
// =========================================================================
async function loadEmployeeReportData() {
    const tableBody = document.getElementById('reportTableBody');

    try {
        // 🛡️ مسؤول الشركة بلا شركات مملوكة أصلاً — لا داعي لأي طلب شبكة، التقرير فارغ
        if (currentUserScope.companyIds !== null && currentUserScope.companyIds.length === 0) {
            fullReportDataset = [];
            filteredReportDataset = [];
            allEmployeeNameOptions = [];
            allCompanyNameOptions = [];
            currentReportPage = 1;
            renderReportTable(filteredReportDataset);
            return;
        }

        // ⚠️ شركة كل موظف والمسمى الوظيفي الفعلي ونوع الربط كلها تُشتق من جدول
        // الربط employee_links (المصدر الفعلي لعلاقة الموظف بالشركة)، وليس من
        // أعمدة employees.company_id / employees.job_title اللذين لم يعودا
        // يُستخدمان منذ فصل شاشة "إضافة موظف" عن شاشة "ربط الموظفين".
        //
        // الجداول الثلاثة تُجلب الآن على دفعات (fetchAllRows) بدل طلب واحد،
        // لضمان تحميل كل السجلات مهما بلغ عددها (وليس أول 1000 صف فقط).
        //
        // ⚠️ روابط نشطة فقط (بلا تاريخ انتهاء، أو لم يأتِ تاريخ انتهائها بعد):
        // بعد أن أصبح "إنهاء ربط موظف" يُسجِّل تاريخ انتهاء بدل حذف السجل
        // فعلياً، تبقى روابط الموظفين المُنهاة محفوظة بجدول employee_links —
        // بدون هذا الفلتر قد يظهر لموظف منتهي الربط شركة/مسمى وظيفي قديمين،
        // أو حتى يُدرَج بالخطأ ضمن نطاق رؤية مسؤول شركة لم يعد يتبعها فعلياً.
        //
        // 🛡️ نطاق الرؤية: لمسؤول الشركة (companyIds مصفوفة محددة)، تُقيَّد
        // استعلامات الشركات والربط بشركاته المملوكة فقط عبر .in('id'/'company_id').
        // ثم تُقيَّد قائمة الموظفين نفسها لاحقاً لتشمل فقط من ظهر بجدول الربط
        // المُقيَّد (أي الموظفين المرتبطين فعلياً بشركة/شركات هذا المستخدم).
        //
        // 🆕 link_type يُجلب أيضاً هنا (بخلاف السابق) لعمود "نوع الربط" الجديد
        // بتصدير Excel (اضافة/استضافة) — انظر linkTypeByEmployeeId أدناه.
        const todayStr = getTodayDateStringForLinks();
        const [employees, companies, links] = await Promise.all([
            fetchAllRows((from, to) =>
                dbClient.from('employees').select('*')
                    .order('created_at', { ascending: false })
                    .order('id', { ascending: false }) // ترتيب ثانوي حاسم لضمان تسلسل صفحات ثابت بلا تكرار أو نقص
                    .range(from, to)
            ),
            fetchAllRows((from, to) => {
                let query = dbClient.from('companies').select('id, name')
                    .order('id', { ascending: true });
                if (currentUserScope.companyIds !== null) query = query.in('id', currentUserScope.companyIds);
                return query.range(from, to);
            }),
            fetchAllRows((from, to) => {
                let query = dbClient.from('employee_links').select('employee_id, company_id, job_title, link_type')
                    .or(`link_end_date.is.null,link_end_date.gte.${todayStr}`)
                    .order('employee_id', { ascending: true })
                    .order('company_id', { ascending: true });
                if (currentUserScope.companyIds !== null) query = query.in('company_id', currentUserScope.companyIds);
                return query.range(from, to);
            })
        ]);

        // خريطة سريعة لأسماء الشركات حسب المعرّف
        const companyNameById = new Map(companies.map(c => [String(c.id), c.name || '----']));

        // خريطة شركة كل موظف (employee_id -> company_id) من جدول الربط (مُقيَّد بالنطاق أعلاه)
        const companyIdByEmployeeId = new Map(links.map(l => [String(l.employee_id), l.company_id]));

        // خريطة المسمى الوظيفي الفعلي لكل موظف مرتبط (employee_id -> job_title) من جدول الربط
        const jobTitleByEmployeeId = new Map(
            links
                .filter(l => l.employee_id != null && l.job_title)
                .map(l => [String(l.employee_id), l.job_title])
        );

        // 🆕 خريطة نوع الربط الفعلي لكل موظف مرتبط (employee_id -> link_type:
        // "اضافة" أو "استضافة") من نفس جدول الربط — تُستخدم بعمود "نوع الربط"
        // الجديد بتصدير Excel فقط (لا تُضاف كعمود بجدول الشاشة أو الطباعة)
        const linkTypeByEmployeeId = new Map(
            links
                .filter(l => l.employee_id != null && l.link_type)
                .map(l => [String(l.employee_id), l.link_type])
        );

        // 🛡️ تقييد قائمة الموظفين أنفسهم: لمسؤول الشركة، يُعرض فقط من ظهر
        // بجدول الربط المُقيَّد أعلاه (أي المرتبطين فعلياً بشركة/شركات هذا
        // المستخدم)؛ لبقية الأدوار (companyIds === null) تبقى القائمة كاملة.
        const scopedEmployees = currentUserScope.companyIds !== null
            ? employees.filter(emp => companyIdByEmployeeId.has(String(emp.id)))
            : employees;

        // بناء صفوف التقرير المدموجة
        fullReportDataset = scopedEmployees.map(emp => {
            const linkedCompanyId = companyIdByEmployeeId.get(String(emp.id));
            const companyId = linkedCompanyId != null ? String(linkedCompanyId) : null;
            return {
                id: emp.id,
                name: emp.name || '----',
                national_id: emp.national_id || '----',
                // 🆕 رقم جوال الموظف (employees.mobile_number) — يُستخدم بعمود
                // "رقم الجوال" الجديد بتصدير Excel فقط
                mobile_number: emp.mobile_number || '----',
                job_title: jobTitleByEmployeeId.get(String(emp.id)) || 'غير محدد',
                // 🆕 نوع ربط الموظف الحالي (اضافة/استضافة) — يُستخدم بعمود
                // "نوع الربط" الجديد بتصدير Excel فقط
                link_type: linkTypeByEmployeeId.get(String(emp.id)) || 'غير محدد',
                status: emp.status || 'نشط',
                company_id: companyId,
                company_name: companyId ? (companyNameById.get(companyId) || '----') : '----'
            };
        });

        filteredReportDataset = fullReportDataset;
        currentReportPage = 1;

        // تحديث قوائم الاقتراحات الخاصة بحقلي البحث (اسم الموظف / اسم الشركة)
        allEmployeeNameOptions = Array.from(new Set(fullReportDataset.map(r => r.name).filter(n => n && n !== '----')))
            .sort((a, b) => a.localeCompare(b, 'ar'));

        allCompanyNameOptions = Array.from(new Set(companies.map(c => c.name).filter(Boolean)))
            .sort((a, b) => a.localeCompare(b, 'ar'));

        renderReportTable(filteredReportDataset);

    } catch (error) {
        console.error("فشل تحميل بيانات تقرير الموظفين:", error);
        if (tableBody) {
            tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#ef4444; padding:20px;">تعذّر تحميل بيانات التقرير: ${(error && error.message) || 'خطأ غير معروف'}</td></tr>`;
        }
    }
}

// =========================================================================
// 3. تطبيق الفلاتر: البحث النصي + الشركة + الحالة
// =========================================================================
function applyReportFilters() {
    const employeeQuery = (document.getElementById('reportEmployeeSearchInput')?.value || '').toLowerCase().trim();
    const companyQuery = (document.getElementById('reportCompanySearchInput')?.value || '').toLowerCase().trim();
    const statusValue = document.getElementById('reportStatusFilter')?.value || 'all';

    filteredReportDataset = fullReportDataset.filter(row => {
        const matchesEmployee = !employeeQuery || row.name.toLowerCase().includes(employeeQuery);
        const matchesCompany = !companyQuery || row.company_name.toLowerCase().includes(companyQuery);

        const matchesStatus =
            statusValue === 'all' ||
            (statusValue === 'active' && (row.status === 'نشط' || row.status === 'active' || row.status === 'Active')) ||
            (statusValue === 'inactive' && (row.status === 'غير نشط' || row.status === 'inactive' || row.status === 'Inactive'));

        return matchesEmployee && matchesCompany && matchesStatus;
    });

    currentReportPage = 1;
    renderReportTable(filteredReportDataset);
}

// =========================================================================
// 4. بناء جدول التقرير (وضع الشاشة: مع تقسيم صفحات)
// =========================================================================
function renderReportTable(data) {
    const tableBody = document.getElementById('reportTableBody');
    const resultsCountEl = document.getElementById('reportResultsCount');
    if (!tableBody) return;

    if (resultsCountEl) {
        resultsCountEl.textContent = `عدد النتائج المطابقة: ${data.length}`;
    }

    if (!data || data.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:30px; color:#94a3b8;">لا توجد بيانات مطابقة لخيارات البحث الحالية.</td></tr>`;
        setupReportPaginationControls(0);
        return;
    }

    const startIndex = (currentReportPage - 1) * reportRowsPerPage;
    const endIndex = startIndex + reportRowsPerPage;
    const paginatedData = data.slice(startIndex, endIndex);

    tableBody.innerHTML = paginatedData.map(row => buildReportRowHtml(row)).join('');

    setupReportPaginationControls(data.length);
}

// 🏷️ يترجم قيمة الحالة المخزّنة في قاعدة البيانات (active/inactive بالإنجليزية)
//    لتسمية عربية مناسبة؛ كانت الكلمة الإنجليزية "active" تظهر حرفياً بالجدول
//    بدل "نشط" لأن الكود كان يعرض row.status مباشرة دون ترجمة.
function getEmployeeStatusLabel(status) {
    const isActive = status === 'نشط' || status === 'active' || status === 'Active';
    return isActive ? 'نشط' : 'غير نشط';
}

function buildReportRowHtml(row) {
    const statusIsActive = row.status === 'نشط' || row.status === 'active' || row.status === 'Active';
    const statusBadgeClass = statusIsActive ? 'badge-status-active' : 'badge-status-inactive';
    const statusLabel = getEmployeeStatusLabel(row.status);

    return `
        <tr>
            <td><strong style="color:#1e293b;">${row.name}</strong></td>
            <td style="color:#475569; font-family: monospace; font-size:0.95rem;">${row.national_id}</td>
            <td style="font-weight:500; color:#334155;">${row.job_title}</td>
            <td style="color:#334155;">${row.company_name}</td>
            <td style="text-align:center;"><span class="badge-status ${statusBadgeClass}">${statusLabel}</span></td>
        </tr>
    `;
}

// =========================================================================
// 5. أزرار التنقل بين صفحات التقرير
// =========================================================================
function setupReportPaginationControls(totalItems) {
    const controlsContainer = document.getElementById('reportPagination');
    if (!controlsContainer) return;
    controlsContainer.innerHTML = '';

    const totalPages = Math.ceil(totalItems / reportRowsPerPage);
    if (totalPages <= 1) return;

    const prevBtn = document.createElement('button');
    prevBtn.innerHTML = '&rarr; السابقة';
    prevBtn.disabled = currentReportPage === 1;
    prevBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;';
    if (prevBtn.disabled) prevBtn.style.opacity = '0.5';
    prevBtn.onclick = () => {
        if (currentReportPage > 1) {
            currentReportPage--;
            renderReportTable(filteredReportDataset);
        }
    };
    controlsContainer.appendChild(prevBtn);

    const countLabel = document.createElement('span');
    countLabel.style.cssText = 'font-size: 0.9rem; color: #475569; font-weight: 600; margin: 0 10px;';
    countLabel.textContent = `صفحة ${currentReportPage} من ${totalPages}`;
    controlsContainer.appendChild(countLabel);

    const nextBtn = document.createElement('button');
    nextBtn.innerHTML = 'التالية &larr;';
    nextBtn.disabled = currentReportPage === totalPages;
    nextBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;';
    if (nextBtn.disabled) nextBtn.style.opacity = '0.5';
    nextBtn.onclick = () => {
        if (currentReportPage < totalPages) {
            currentReportPage++;
            renderReportTable(filteredReportDataset);
        }
    };
    controlsContainer.appendChild(nextBtn);
}

// =========================================================================
// 6. تصدير التقرير الكامل (بعد الفلترة) إلى ملف Excel عبر مكتبة SheetJS
//
// 🆕 تحديث هذا القسم بالكامل ليشمل:
//   1) عمودي "رقم الجوال" و"نوع الربط" الجديدين (خاصان بتصدير Excel فقط —
//      لا يُضافان لجدول الشاشة ولا لنسخة الطباعة، بناءً على طلب المستخدم).
//   2) تنسيق "احترافي" للملف الناتج ضمن ما تدعمه مكتبة SheetJS المستخدمة هنا
//      فعلياً فعلياً (xlsx@0.18.5 عبر CDN — النسخة المجانية مفتوحة المصدر):
//        • اتجاه الورقة بالكامل من اليمين لليسار (RTL) عبر workbook.Workbook.Views
//          — فيظهر عمود "الاسم" أول عمود من جهة اليمين تلقائياً عند الفتح
//          بإكسل، تماماً كاتجاه الجداول العربية المعتادة، بدل الاتجاه
//          الافتراضي (LTR) الذي يضع أول عمود على اليسار.
//        • تفعيل التصفية التلقائية (AutoFilter) على كامل نطاق الجدول —
//          تظهر أسهم فرز/تصفية بكل عمود من صف الترويسة مباشرة داخل إكسل.
//        • عرض أعمدة مضبوط يدوياً لكل عمود حسب محتواه المتوقع.
//
//   ⚠️ ملاحظة تقنية هامة: تم التحقق فعلياً (بتفكيك ملف xlsx ناتج وفحص XML
//   الداخلي) أن هذه النسخة تحديداً من مكتبة SheetJS لا تكتب تنسيقات الخلايا
//   (تلوين خلفية/خط عريض/حدود) عند التصدير — ميزة "الأنماط" (Cell Styles)
//   محصورة بالنسخة المدفوعة (Pro) من المكتبة، وأي محاولة لضبط cell.s يُكتب
//   بصمت بلا أي أثر بالملف الناتج. لذا "التنسيق الاحترافي" هنا مقصور فعلياً
//   على ما تدعمه المكتبة (اتجاه RTL + تصفية تلقائية + عرض أعمدة)، وليس
//   ألواناً/خطوطاً عريضة داخل الخلايا — أي طلب لاحق بإضافة تلوين فعلي
//   للترويسة سيتطلب تبديل مكتبة التصدير (مثل ExcelJS) بدل SheetJS.
// =========================================================================
function exportReportToExcel() {
    if (!filteredReportDataset || filteredReportDataset.length === 0) {
        alert('لا توجد بيانات لتصديرها بناءً على خيارات البحث الحالية.');
        return;
    }

    const headers = ['الاسم', 'رقم الهوية', 'رقم الجوال', 'المسمى الوظيفي', 'نوع الربط', 'الشركة', 'الحالة'];

    const rows = filteredReportDataset.map(row => [
        row.name,
        row.national_id,
        row.mobile_number,
        row.job_title,
        row.link_type,
        row.company_name,
        getEmployeeStatusLabel(row.status)
    ]);

    const worksheetData = [headers, ...rows];
    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

    // عرض أعمدة مناسب لسهولة القراءة (عمودان جديدان: رقم الجوال، نوع الربط)
    worksheet['!cols'] = [
        { wch: 22 }, { wch: 15 }, { wch: 14 }, { wch: 18 }, { wch: 12 }, { wch: 20 }, { wch: 12 }
    ];

    // 🆕 تصفية تلقائية (AutoFilter) على كامل نطاق الجدول (الترويسة + كل الصفوف)
    const lastColLetter = XLSX.utils.encode_col(headers.length - 1);
    worksheet['!autofilter'] = { ref: `A1:${lastColLetter}${worksheetData.length}` };

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'تقرير الموظفين');

    // 🆕 اتجاه الملف بالكامل من اليمين لليسار (RTL) — انظر الشرح المفصّل أعلى الدالة
    workbook.Workbook = { Views: [{ RTL: true }] };

    const now = new Date();
    const dateSuffix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    XLSX.writeFile(workbook, `تقرير_الموظفين_${dateSuffix}.xlsx`);
}

// =========================================================================
// 7. طباعة التقرير: نفس تصميم الطباعة الاحترافي المشترك مع تقريري الحضور
//    والمهام (ترويسة بالشركة + رمز QR + رقم مستند + جدول بترويسة زرقاء +
//    علامة مائية متكررة + تذييل برقم الصفحة)، عبر buildGenericReportPrintPagesHtml
//    مع تعريف أعمدة تقرير الموظفين تحديداً. رمز QR يشير لصفحة عرض عامة
//    (view_report.html) تعرض نفس التقرير لأي شخص يمسحه دون تسجيل دخول — عبر
//    لقطة تُحفظ بجدول report_snapshots؛ إن لم يكن السكربت اللازم لعمودي
//    report_type/columns منفَّذاً بعد بسوبابيس تستمر الطباعة بشكل طبيعي لكن
//    بدون رمز QR فعّال (فشل الحفظ يُلتقط بأمان دون إيقاف الطباعة).
// =========================================================================
const EMPLOYEE_REPORT_COLUMNS = [
    { key: 'name', label: 'الاسم', align: 'right' },
    { key: 'national_id', label: 'رقم الهوية', align: 'center' },
    { key: 'job_title', label: 'المسمى الوظيفي', align: 'center' },
    { key: 'company_name', label: 'الشركة', align: 'center' },
    { key: 'status', label: 'الحالة', align: 'center' }
];

async function printEmployeeReport() {
    if (!filteredReportDataset || filteredReportDataset.length === 0) {
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
    const singleCompanyLabel = detectSingleCompanyLabel(filteredReportDataset);
    const companyLabel = singleCompanyLabel || 'بصمة الأعمال';

    // 🗂️ ترتيب نسخة الطباعة فقط حسب المسمى الوظيفي أبجدياً (تجميع كل مسمى
    // وظيفي مع بعضه بالورقة المطبوعة لتسهيل المراجعة)، مع دفع الموظفين بلا
    // مسمى محدد ("غير محدد") لنهاية الترتيب بدل تشتيتهم بين المسميات. جدول
    // الشاشة نفسه (وترتيب تصدير Excel) يبقيان بلا تغيير — هذا الترتيب خاص
    // بالطباعة فقط كما طلب المستخدم.
    const sortedForPrint = [...filteredReportDataset].sort((a, b) => {
        const aUnknown = a.job_title === 'غير محدد';
        const bUnknown = b.job_title === 'غير محدد';
        if (aUnknown && !bUnknown) return 1;
        if (!aUnknown && bUnknown) return -1;
        return a.job_title.localeCompare(b.job_title, 'ar') || a.name.localeCompare(b.name, 'ar');
    });

    const printRows = sortedForPrint.map(row => ({
        name: row.name,
        national_id: row.national_id,
        job_title: row.job_title,
        company_name: row.company_name,
        status: getEmployeeStatusLabel(row.status)
    }));

    let qrDataUrl = null;
    try {
        const { data: snapshot, error: snapshotError } = await dbClient
            .from('report_snapshots')
            .insert({
                doc_number: docNumber,
                report_title: 'تقرير الموظفين',
                report_type: 'employees',
                columns: EMPLOYEE_REPORT_COLUMNS,
                company_name: singleCompanyLabel,
                show_company_column: !singleCompanyLabel,
                report_date_text: reportDateText,
                rows: printRows
            })
            .select('id')
            .single();

        if (snapshotError) throw snapshotError;

        const viewUrl = `${window.location.origin}${window.location.pathname.replace('employee-report.html', 'view_report.html')}?id=${snapshot.id}`;
        qrDataUrl = await window.PrintReport.generateReportQrDataUrl(viewUrl);
    } catch (error) {
        console.error('تعذّر إنشاء نسخة قابلة للعرض عبر رمز QR (تأكد من تنفيذ سكربت إضافة عمودي report_type/columns لجدول report_snapshots بسوبابيس):', error.message);
    }

    printRoot.innerHTML = window.PrintReport.buildGenericReportPrintPagesHtml({
        docNumber,
        companyLabel,
        subtitleText: 'تقرير الموظفين',
        reportDateText,
        columns: EMPLOYEE_REPORT_COLUMNS,
        rows: printRows,
        qrDataUrl
    });

    window.print();
}

// إن كانت كل صفوف التقرير المفلترة الحالية تخص شركة واحدة فقط، تُعاد كاسمها
// (لعرضها بترويسة الطباعة)، وإلا تُعاد null (تقرير متعدد الشركات/بدون شركة محددة)
function detectSingleCompanyLabel(rows) {
    const names = new Set(rows.map(r => r.company_name).filter(n => n && n !== '----'));
    if (names.size === 1) return Array.from(names)[0];
    return null;
}

window.addEventListener('afterprint', () => {
    const printRoot = document.getElementById('printPagesRoot');
    if (printRoot) printRoot.innerHTML = '';
});