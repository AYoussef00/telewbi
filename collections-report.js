// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================
const SUPABASE_URL = "https://mcdhxdfkuokhmhtfvjev.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_yt9V8lsNU1zN3Ix2CvovbQ_QCA2VDdM";
const dbClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// =========================================================================
// تقرير "تحصيل الموظفين": نسخة قراءة فقط (بلا أي إجراء تعديل) من شاشة
// "تحصيل الموظفين" (collections.html) — يعرض عن شهر مُختار حالة تحصيل كل
// موظفي "اضافة" (employee_links.link_type = 'اضافة')، مع دعم البحث/الفلترة،
// وتصدير Excel، وطباعة احترافية موحّدة الشكل مع بقية تقارير المنصة عبر
// print-report.js (window.PrintReport). يعتمد على نفس جدول
// employee_collections المُستخدم بشاشة التحصيل نفسها (راجع تعليقات
// collections.js للتفاصيل الكاملة حول بنية الجدول).
//
// 🗓️ المبلغ المستحق ("المستحق") لكل موظف عن الشهر المختار يُحسب بنفس منطق
// شاشة "تحصيل الموظفين" تماماً: مقارنة نطاق ربط الموظف (link_date إلى
// link_end_date) بالشهر المختار — كامل الصافي إن غطّى الربط الشهر بالكامل،
// أو تناسبياً على أساس شهر ثابت من 30 يوماً إن بدأ/انتهى الربط خلال الشهر،
// أو إن كان الشهر الجاري لم ينتهِ بعد (لا يُحتسب أي يوم مستقبلي). الموظف الذي
// لا يتقاطع ربطه إطلاقاً مع الشهر المختار لا يظهر بالتقرير عن ذلك الشهر.
//
// 🆕 جدول الشاشة: عمود "الموظف" يعرض اسم الموظف واسم الشركة تحته (سطر ثانوي
// رمادي)، وعمود "رقم الهوية" يعرض رقم الهوية والمسمى الوظيفي تحته — بدل
// عمودين منفصلين لكل منهما كما كان سابقاً، بنفس أسلوب شاشة "تحصيل الموظفين"
// التشغيلية (collections.js). تصدير Excel والطباعة (buildGenericReportPrintPagesHtml)
// يبقيان بعمودين منفصلين للشركة والمسمى الوظيفي بلا أي تغيير — بيانات جدولية
// مسطّحة يُفضَّل فيها الفصل الكامل بين الأعمدة.
// =========================================================================

// 🛡️ نفس منطق نطاق الرؤية المستخدم بتقريري الموظفين والمهام: مسؤول الشركة
// (role='company') يرى فقط بيانات شركته/شركاته المملوكة، بينما super_admin/admin يريان الجميع.
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
// جلب كامل صفوف جدول ما على دفعات (Pagination) — سوبابيس (PostgREST) يفرض
// حداً افتراضياً 1000 صف كحد أقصى لكل طلب (نفس الحل المعتمد ببقية شاشات المنصة)
// =========================================================================
const COLLECTIONS_REPORT_FETCH_PAGE_SIZE = 1000;

async function fetchAllRows(builderFactory) {
    let allRows = [];
    let from = 0;
    while (true) {
        const { data, error } = await builderFactory(from, from + COLLECTIONS_REPORT_FETCH_PAGE_SIZE - 1);
        if (error) throw error;
        allRows = allRows.concat(data || []);
        if (!data || data.length < COLLECTIONS_REPORT_FETCH_PAGE_SIZE) break;
        from += COLLECTIONS_REPORT_FETCH_PAGE_SIZE;
    }
    return allRows;
}

// مخزن بيانات التقرير الكامل (بعد الدمج) ونسخة الفلترة الحالية
let fullCollectionsReportDataset = [];
let filteredCollectionsReportDataset = [];

// قوائم القيم المميزة (Distinct) لتغذية اقتراحات قوائم البحث القابلة للكتابة فيها
let allReportEmployeeNameOptions = [];
let allReportCompanyNameOptions = [];

// إعدادات تقسيم الصفحات
let currentCollectionsReportPage = 1;
const collectionsReportRowsPerPage = 10;

// الشهر المختار حالياً بصيغة YYYY-MM (من حقل <input type="month">)
let currentReportMonthValue = '';

document.addEventListener('DOMContentLoaded', async () => {
    const allowed = await Permissions.guardPage('reports_collections');
    if (!allowed) return;

    const monthPicker = document.getElementById('collectionsReportMonthPicker');
    const now = new Date();
    currentReportMonthValue = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    if (monthPicker) {
        monthPicker.value = currentReportMonthValue;
        monthPicker.addEventListener('change', () => {
            currentReportMonthValue = monthPicker.value || currentReportMonthValue;
            loadCollectionsReportData();
        });
    }

    // قائمتا بحث قابلتان للكتابة فيها (Searchable Combobox) لاسم الموظف واسم الشركة
    setupReportSearchCombo({
        inputId: 'collectionsReportEmployeeSearchInput',
        dropdownId: 'collectionsReportEmployeeDropdown',
        clearLabel: 'كل الموظفين',
        emptyText: 'لا يوجد موظفون مطابقون',
        getOptions: () => allReportEmployeeNameOptions,
        onQueryChange: applyCollectionsReportFilters
    });

    setupReportSearchCombo({
        inputId: 'collectionsReportCompanySearchInput',
        dropdownId: 'collectionsReportCompanyDropdown',
        clearLabel: 'كل الشركات',
        emptyText: 'لا توجد شركات مطابقة',
        getOptions: () => allReportCompanyNameOptions,
        onQueryChange: applyCollectionsReportFilters
    });

    const statusFilter = document.getElementById('collectionsReportStatusFilter');
    if (statusFilter) statusFilter.addEventListener('change', applyCollectionsReportFilters);

    const btnExport = document.getElementById('btnExportCollectionsReportExcel');
    if (btnExport) btnExport.addEventListener('click', exportCollectionsReportToExcel);

    const btnPrint = document.getElementById('btnPrintCollectionsReport');
    if (btnPrint) btnPrint.addEventListener('click', printCollectionsReport);

    await loadCurrentUserScope();
    await loadCollectionsReportData();
});

// =========================================================================
// مكوّن قائمة بحث قابلة للكتابة فيها (Searchable Filter Combobox) — نفس مكوّن
// employee-report.js/companies-report.js حرفياً، بمعرّف منفصل تفادياً لأي
// تعارض أسماء إن حُمِّل أكثر من ملف تقرير بنفس الصفحة مستقبلاً
// =========================================================================
function setupReportSearchCombo({ inputId, dropdownId, clearLabel, emptyText, getOptions, onQueryChange }) {
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
        setTimeout(closeDropdown, 150);
    });

    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !dropdown.contains(e.target)) {
            closeDropdown();
        }
    });
}

// 💰 تنسيق القيم المالية بمنزلتين عشريتين بأرقام إنجليزية دائماً
function formatCollectionsReportCurrency(value) {
    const num = parseFloat(value);
    if (isNaN(num)) return '0.00';
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
}

// 📅 تنسيق تاريخ/وقت بصيغة DD/MM/YYYY
function formatCollectionsReportDate(dateStr) {
    if (!dateStr) return '—';
    const datePart = String(dateStr).split('T')[0];
    const parts = datePart.split('-');
    if (parts.length !== 3) return String(dateStr);
    const [y, m, d] = parts;
    return `${d}/${m}/${y}`;
}

function getCollectionsReportStatusLabel(status) {
    return status === 'paid' ? 'مدفوع' : 'غير مدفوع';
}

// =========================================================================
// 🗓️ حساب المبلغ المستحق فعلياً عن الشهر المختار "حتى تاريخه" — نفس منطق
// شاشة "تحصيل الموظفين" (collections.js) حرفياً: مقارنة نطاق ربط الموظف
// (link_date إلى link_end_date، أو حتى الآن إن لم يُحدَّد تاريخ انتهاء) بالشهر
// المختار، بلا احتساب أي يوم مستقبلي بعد تاريخ اليوم الفعلي، وتناسبياً على
// أساس شهر تجاري ثابت من 30 يوماً إن كانت الفترة المحتسبة أقل من الشهر بالكامل.
// =========================================================================
function parseCollectionsReportDateOnly(dateStr) {
    return new Date(dateStr + 'T00:00:00');
}

function daysInCollectionsReportCalendarMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
}

const COLLECTIONS_REPORT_PRORATION_DAYS_PER_MONTH = 30;

function computeReportLinkOverlapWithMonth(linkDateStr, linkEndDateStr, year, month) {
    const monthStart = new Date(year, month, 1);
    const monthCalendarEnd = new Date(year, month, daysInCollectionsReportCalendarMonth(year, month));

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const accrualEnd = monthCalendarEnd < today ? monthCalendarEnd : today;

    const linkStart = linkDateStr ? parseCollectionsReportDateOnly(linkDateStr) : null;
    const linkEnd = linkEndDateStr ? parseCollectionsReportDateOnly(linkEndDateStr) : null;

    const effectiveStart = (linkStart && linkStart > monthStart) ? linkStart : monthStart;
    const effectiveEnd = (linkEnd && linkEnd < accrualEnd) ? linkEnd : accrualEnd;

    if (effectiveEnd < effectiveStart) {
        return { overlapDays: 0, isFullMonth: false };
    }

    const overlapDays = Math.round((effectiveEnd - effectiveStart) / 86400000) + 1;
    const isFullMonth = effectiveStart.getTime() === monthStart.getTime() && effectiveEnd.getTime() === monthCalendarEnd.getTime();
    return { overlapDays, isFullMonth };
}

function computeReportLinkDueForMonth(netSalaryValue, linkDateStr, linkEndDateStr, year, month) {
    const baseValue = parseFloat(netSalaryValue) || 0;
    const { overlapDays, isFullMonth } = computeReportLinkOverlapWithMonth(linkDateStr, linkEndDateStr, year, month);

    if (overlapDays <= 0) return { dueAmount: 0, overlapDays: 0, isFullMonth: false };
    if (isFullMonth) return { dueAmount: Math.round(baseValue * 100) / 100, overlapDays, isFullMonth: true };

    const dailyRate = baseValue / COLLECTIONS_REPORT_PRORATION_DAYS_PER_MONTH;
    return { dueAmount: Math.round(dailyRate * overlapDays * 100) / 100, overlapDays, isFullMonth: false };
}

// =========================================================================
// 2. جلب موظفي "اضافة" (الروابط) مع بيانات الموظف والشركة، ودمجها بسجل
//    تحصيل الشهر المختار — الموظف بلا سجل تحصيل لهذا الشهر يُعامَل كـ"غير
//    مدفوع" افتراضياً بمبلغ مستلم صفر (نفس منطق شاشة التحصيل نفسها تماماً).
//    الروابط التي لا تتقاطع إطلاقاً مع الشهر المختار (بدأت لاحقاً، أو انتهت
//    قبل بدايته) تُستبعَد من التقرير تماماً — نفس سلوك شاشة التحصيل.
// =========================================================================
async function loadCollectionsReportData() {
    const tableBody = document.getElementById('collectionsReportTableBody');

    try {
        // 🛡️ مسؤول الشركة بلا شركات مملوكة أصلاً — لا داعي لأي طلب شبكة، التقرير فارغ
        if (currentUserScope.companyIds !== null && currentUserScope.companyIds.length === 0) {
            fullCollectionsReportDataset = [];
            filteredCollectionsReportDataset = [];
            allReportEmployeeNameOptions = [];
            allReportCompanyNameOptions = [];
            currentCollectionsReportPage = 1;
            updateCollectionsReportStats();
            renderCollectionsReportTable(filteredCollectionsReportDataset);
            return;
        }

        if (tableBody) {
            tableBody.innerHTML = `<tr><td colspan="7" class="table-loading-state">جاري جلب بيانات التقرير...</td></tr>`;
        }

        const additionLinks = await fetchAllRows((from, to) => {
            let query = dbClient.from('employee_links')
                .select('id, employee_id, company_id, job_title, net_salary_value, link_date, link_end_date, employees(name, national_id), companies(name)')
                .eq('link_type', 'اضافة')
                .order('id', { ascending: true });
            if (currentUserScope.companyIds !== null) query = query.in('company_id', currentUserScope.companyIds);
            return query.range(from, to);
        });

        const monthDateStr = `${currentReportMonthValue}-01`;
        const [reportYearStr, reportMonthNumStr] = currentReportMonthValue.split('-');
        const reportSelectedYear = parseInt(reportYearStr, 10);
        const reportSelectedMonthIndex = parseInt(reportMonthNumStr, 10) - 1;
        const linkIds = additionLinks.map(l => l.id);

        // 🛡️ لا داعي لاستعلام جدول التحصيل إن لم توجد أي روابط إضافة أصلاً بالنطاق الحالي
        const collectionRows = linkIds.length === 0 ? [] : await fetchAllRows((from, to) =>
            dbClient.from('employee_collections')
                .select('employee_link_id, amount, received_amount, status, paid_at, notes')
                .eq('collection_month', monthDateStr)
                .in('employee_link_id', linkIds)
                .range(from, to)
        );

        const collectionByLinkId = new Map();
        collectionRows.forEach(row => collectionByLinkId.set(String(row.employee_link_id), row));

        fullCollectionsReportDataset = additionLinks
            .map(link => {
                const netSalaryValue = link.net_salary_value != null ? parseFloat(link.net_salary_value) : 0;
                const dueInfo = computeReportLinkDueForMonth(netSalaryValue, link.link_date, link.link_end_date, reportSelectedYear, reportSelectedMonthIndex);

                // لا شيء مستحق بعد عن هذا الشهر (لا تداخل بين فترة الربط والشهر
                // المختار): لا داعٍ لإظهار الموظف بالتقرير عن هذا الشهر تحديداً
                if (dueInfo.overlapDays <= 0) return null;

                const collection = collectionByLinkId.get(String(link.id));
                const receivedAmount = collection && collection.received_amount != null ? parseFloat(collection.received_amount) : 0;
                const remaining = Math.max(dueInfo.dueAmount - receivedAmount, 0);
                return {
                    linkId: link.id,
                    employeeName: (link.employees && link.employees.name) ? link.employees.name : '----',
                    nationalId: (link.employees && link.employees.national_id) ? link.employees.national_id : '----',
                    companyName: (link.companies && link.companies.name) ? link.companies.name : '----',
                    jobTitle: link.job_title || '----',
                    netSalaryValue,               // كامل الصافي الشهري المرجعي (بغض النظر عن التناسب)
                    dueAmount: dueInfo.dueAmount,  // المستحق الفعلي عن هذا الشهر حتى تاريخه (بعد التناسب إن وُجد)
                    isFullMonth: dueInfo.isFullMonth,
                    overlapDays: dueInfo.overlapDays,
                    receivedAmount,
                    remaining,
                    status: collection ? (collection.status || 'unpaid') : 'unpaid',
                    paidAt: collection ? collection.paid_at : null
                };
            })
            .filter(Boolean);

        filteredCollectionsReportDataset = fullCollectionsReportDataset;
        currentCollectionsReportPage = 1;

        allReportEmployeeNameOptions = Array.from(new Set(fullCollectionsReportDataset.map(r => r.employeeName).filter(n => n && n !== '----')))
            .sort((a, b) => a.localeCompare(b, 'ar'));
        allReportCompanyNameOptions = Array.from(new Set(fullCollectionsReportDataset.map(r => r.companyName).filter(n => n && n !== '----')))
            .sort((a, b) => a.localeCompare(b, 'ar'));

        updateCollectionsReportStats();
        renderCollectionsReportTable(filteredCollectionsReportDataset);

    } catch (error) {
        console.error('تعذّر تحميل بيانات تقرير تحصيل الموظفين:', error);
        if (tableBody) {
            tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#ef4444; padding:20px;">تعذّر تحميل بيانات التقرير: ${(error && error.message) || 'خطأ غير معروف'}</td></tr>`;
        }
    }
}

// =========================================================================
// 3. تطبيق الفلاتر: بحث الموظف + بحث الشركة + الحالة
// =========================================================================
function applyCollectionsReportFilters() {
    const employeeQuery = (document.getElementById('collectionsReportEmployeeSearchInput')?.value || '').toLowerCase().trim();
    const companyQuery = (document.getElementById('collectionsReportCompanySearchInput')?.value || '').toLowerCase().trim();
    const statusValue = document.getElementById('collectionsReportStatusFilter')?.value || 'all';

    filteredCollectionsReportDataset = fullCollectionsReportDataset.filter(row => {
        const matchesEmployee = !employeeQuery
            || row.employeeName.toLowerCase().includes(employeeQuery)
            || row.nationalId.toLowerCase().includes(employeeQuery);
        const matchesCompany = !companyQuery || row.companyName.toLowerCase().includes(companyQuery);
        const matchesStatus = statusValue === 'all' || row.status === statusValue;

        return matchesEmployee && matchesCompany && matchesStatus;
    });

    currentCollectionsReportPage = 1;
    updateCollectionsReportStats();
    renderCollectionsReportTable(filteredCollectionsReportDataset);
}

// 📈 تحديث بطاقات الإحصائيات بناءً على البيانات المفلترة حالياً (وليس كامل الشهر دوماً)
// "إجمالي المستحق" يعتمد على المبلغ المستحق الفعلي حتى تاريخه (dueAmount) وليس كامل الصافي دائماً
function updateCollectionsReportStats() {
    const data = filteredCollectionsReportDataset;
    let totalDue = 0, totalReceived = 0;
    data.forEach(row => {
        totalDue += parseFloat(row.dueAmount) || 0;
        totalReceived += parseFloat(row.receivedAmount) || 0;
    });
    const totalRemaining = Math.max(totalDue - totalReceived, 0);

    const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    setText('statReportEmployeeCount', data.length);
    setText('statReportTotalDue', formatCollectionsReportCurrency(totalDue));
    setText('statReportTotalPaid', formatCollectionsReportCurrency(totalReceived));
    setText('statReportTotalUnpaid', formatCollectionsReportCurrency(totalRemaining));
}

// =========================================================================
// 4. بناء جدول التقرير (وضع الشاشة: مع تقسيم صفحات)
// =========================================================================
function renderCollectionsReportTable(data) {
    const tableBody = document.getElementById('collectionsReportTableBody');
    const resultsCountEl = document.getElementById('collectionsReportResultsCount');
    if (!tableBody) return;

    if (resultsCountEl) {
        resultsCountEl.textContent = `عدد النتائج المطابقة: ${data.length}`;
    }

    if (!data || data.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; color:#94a3b8;">لا توجد بيانات مطابقة لخيارات البحث الحالية.</td></tr>`;
        setupCollectionsReportPaginationControls(0);
        return;
    }

    const startIndex = (currentCollectionsReportPage - 1) * collectionsReportRowsPerPage;
    const endIndex = startIndex + collectionsReportRowsPerPage;
    const paginatedData = data.slice(startIndex, endIndex);

    tableBody.innerHTML = paginatedData.map(row => buildCollectionsReportRowHtml(row)).join('');

    setupCollectionsReportPaginationControls(data.length);
}

// 🆕 عمود "الموظف": الاسم + اسم الشركة بسطر ثانوي رمادي تحته (.collection-subtext
// من collections.css، المُستدعى أصلاً بهذه الصفحة). عمود "رقم الهوية": الرقم +
// المسمى الوظيفي بسطر ثانوي تحته — بدل عمودين منفصلين لكل منهما كما كان سابقاً.
function buildCollectionsReportRowHtml(row) {
    const isPaid = row.status === 'paid';
    const statusBadgeClass = isPaid ? 'status-badge-active' : 'status-badge-unpaid';
    const statusLabel = getCollectionsReportStatusLabel(row.status);
    const hasRemaining = row.remaining > 0.004;
    const remainingClass = hasRemaining ? 'has-remaining' : 'no-remaining';

    // 📌 عند وجود استحقاق جزئي (بداية/نهاية ربط خلال الشهر، أو شهر جارٍ لم
    // ينتهِ بعد) نعرض عدد الأيام المحتسبة تحت المبلغ، مع تلميح يوضّح كامل
    // الصافي الشهري للمقارنة — نفس أسلوب شاشة "تحصيل الموظفين"
    const dueTitleAttr = !row.isFullMonth
        ? ` title="الصافي الكامل: ${formatCollectionsReportCurrency(row.netSalaryValue)} — ${row.overlapDays} يوم من ${COLLECTIONS_REPORT_PRORATION_DAYS_PER_MONTH}"`
        : '';
    const dueProratedNote = !row.isFullMonth
        ? `<div class="due-prorated-note">(${row.overlapDays} يوم)</div>`
        : '';

    return `
        <tr>
            <td>
                <strong style="color:#1e293b;">${row.employeeName}</strong>
                <div class="collection-subtext">${row.companyName}</div>
            </td>
            <td class="collection-national-id-cell">
                <div>${row.nationalId}</div>
                <div class="collection-subtext">${row.jobTitle}</div>
            </td>
            <td class="collection-net-cell"${dueTitleAttr} style="text-align:center;">${formatCollectionsReportCurrency(row.dueAmount)}${dueProratedNote}</td>
            <td class="collection-received-cell" style="text-align:center;">${formatCollectionsReportCurrency(row.receivedAmount)}</td>
            <td class="collection-remaining-cell ${remainingClass}" style="text-align:center;">${formatCollectionsReportCurrency(row.remaining)}</td>
            <td style="text-align:center;"><span class="${statusBadgeClass}">${statusLabel}</span></td>
            <td style="text-align:center; font-family: monospace;">${row.paidAt ? formatCollectionsReportDate(row.paidAt) : '—'}</td>
        </tr>
    `;
}

// =========================================================================
// 5. أزرار التنقل بين صفحات التقرير
// =========================================================================
function setupCollectionsReportPaginationControls(totalItems) {
    const controlsContainer = document.getElementById('collectionsReportPagination');
    if (!controlsContainer) return;
    controlsContainer.innerHTML = '';

    const totalPages = Math.ceil(totalItems / collectionsReportRowsPerPage);
    if (totalPages <= 1) return;

    const prevBtn = document.createElement('button');
    prevBtn.innerHTML = '&rarr; السابقة';
    prevBtn.disabled = currentCollectionsReportPage === 1;
    prevBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;';
    if (prevBtn.disabled) prevBtn.style.opacity = '0.5';
    prevBtn.onclick = () => {
        if (currentCollectionsReportPage > 1) {
            currentCollectionsReportPage--;
            renderCollectionsReportTable(filteredCollectionsReportDataset);
        }
    };
    controlsContainer.appendChild(prevBtn);

    const countLabel = document.createElement('span');
    countLabel.style.cssText = 'font-size: 0.9rem; color: #475569; font-weight: 600; margin: 0 10px;';
    countLabel.textContent = `صفحة ${currentCollectionsReportPage} من ${totalPages}`;
    controlsContainer.appendChild(countLabel);

    const nextBtn = document.createElement('button');
    nextBtn.innerHTML = 'التالية &larr;';
    nextBtn.disabled = currentCollectionsReportPage === totalPages;
    nextBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;';
    if (nextBtn.disabled) nextBtn.style.opacity = '0.5';
    nextBtn.onclick = () => {
        if (currentCollectionsReportPage < totalPages) {
            currentCollectionsReportPage++;
            renderCollectionsReportTable(filteredCollectionsReportDataset);
        }
    };
    controlsContainer.appendChild(nextBtn);
}

// =========================================================================
// 6. تصدير التقرير الكامل (بعد الفلترة) إلى ملف Excel عبر مكتبة SheetJS
//    ⚠️ يبقى بعمودين منفصلين للشركة والمسمى الوظيفي (بلا دمج) — بيانات
//    جدولية مسطّحة يُفضَّل فيها الفصل الكامل بين الأعمدة، بخلاف عرض الشاشة.
// =========================================================================
function exportCollectionsReportToExcel() {
    if (!filteredCollectionsReportDataset || filteredCollectionsReportDataset.length === 0) {
        alert('لا توجد بيانات لتصديرها بناءً على خيارات البحث الحالية.');
        return;
    }

    const headers = ['الموظف', 'رقم الهوية', 'الشركة', 'المسمى الوظيفي', 'المستحق', 'المستلم', 'المتبقي', 'الحالة', 'تاريخ التحصيل'];

    const rows = filteredCollectionsReportDataset.map(row => [
        row.employeeName,
        row.nationalId,
        row.companyName,
        row.jobTitle,
        formatCollectionsReportCurrency(row.dueAmount),
        formatCollectionsReportCurrency(row.receivedAmount),
        formatCollectionsReportCurrency(row.remaining),
        getCollectionsReportStatusLabel(row.status),
        row.paidAt ? formatCollectionsReportDate(row.paidAt) : '—'
    ]);

    const worksheetData = [headers, ...rows];
    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

    worksheet['!cols'] = [
        { wch: 22 }, { wch: 15 }, { wch: 20 }, { wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 }
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'تحصيل الموظفين');

    XLSX.writeFile(workbook, `تقرير_تحصيل_الموظفين_${currentReportMonthValue}.xlsx`);
}

// =========================================================================
// 7. طباعة التقرير: نفس تصميم الطباعة الاحترافي المشترك مع بقية تقارير
//    المنصة (ترويسة بالشركة + رمز QR + رقم مستند + جدول بترويسة زرقاء +
//    علامة مائية متكررة + تذييل برقم الصفحة)، عبر buildGenericReportPrintPagesHtml.
//    ⚠️ يبقى بعمودين منفصلين للشركة والمسمى الوظيفي (بلا دمج)، كتصدير Excel تماماً.
// =========================================================================
const COLLECTIONS_REPORT_COLUMNS = [
    { key: 'employeeName', label: 'الموظف', align: 'right' },
    { key: 'nationalId', label: 'رقم الهوية', align: 'center' },
    { key: 'companyName', label: 'الشركة', align: 'center' },
    { key: 'jobTitle', label: 'المسمى الوظيفي', align: 'center' },
    { key: 'netSalaryValue', label: 'المستحق', align: 'center' },
    { key: 'receivedAmount', label: 'المستلم', align: 'center' },
    { key: 'remaining', label: 'المتبقي', align: 'center' },
    { key: 'status', label: 'الحالة', align: 'center' }
];

async function printCollectionsReport() {
    if (!filteredCollectionsReportDataset || filteredCollectionsReportDataset.length === 0) {
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
    const singleCompanyLabel = detectSingleCollectionsReportCompanyLabel(filteredCollectionsReportDataset);
    const companyLabel = singleCompanyLabel || 'بصمة الأعمال';

    // ترتيب نسخة الطباعة أبجدياً حسب اسم الموظف (جدول الشاشة وتصدير Excel يبقيان بلا تغيير)
    const sortedForPrint = [...filteredCollectionsReportDataset].sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'ar'));

    const printRows = sortedForPrint.map(row => ({
        employeeName: row.employeeName,
        nationalId: row.nationalId,
        companyName: row.companyName,
        jobTitle: row.jobTitle,
        // ⚠️ المفتاح يبقى "netSalaryValue" (يطابق COLLECTIONS_REPORT_COLUMNS أعلاه
        // بعمود "المستحق")، لكن القيمة المعروضة أصبحت المبلغ المستحق الفعلي بعد
        // التناسب (dueAmount) وليس كامل الصافي الشهري دائماً
        netSalaryValue: formatCollectionsReportCurrency(row.dueAmount),
        receivedAmount: formatCollectionsReportCurrency(row.receivedAmount),
        remaining: formatCollectionsReportCurrency(row.remaining),
        status: getCollectionsReportStatusLabel(row.status)
    }));

    const monthLabelText = `شهر ${currentReportMonthValue}`;

    let qrDataUrl = null;
    try {
        const { data: snapshot, error: snapshotError } = await dbClient
            .from('report_snapshots')
            .insert({
                doc_number: docNumber,
                report_title: `تقرير تحصيل الموظفين — ${monthLabelText}`,
                report_type: 'employee_collections',
                columns: COLLECTIONS_REPORT_COLUMNS,
                company_name: singleCompanyLabel,
                show_company_column: !singleCompanyLabel,
                report_date_text: reportDateText,
                rows: printRows
            })
            .select('id')
            .single();

        if (snapshotError) throw snapshotError;

        const viewUrl = `${window.location.origin}${window.location.pathname.replace('collections-report.html', 'view_report.html')}?id=${snapshot.id}`;
        qrDataUrl = await window.PrintReport.generateReportQrDataUrl(viewUrl);
    } catch (error) {
        console.error('تعذّر إنشاء نسخة قابلة للعرض عبر رمز QR (تأكد من تنفيذ سكربت إضافة عمودي report_type/columns لجدول report_snapshots بسوبابيس):', error.message);
    }

    printRoot.innerHTML = window.PrintReport.buildGenericReportPrintPagesHtml({
        docNumber,
        companyLabel,
        subtitleText: `تقرير تحصيل الموظفين — ${monthLabelText}`,
        reportDateText,
        columns: COLLECTIONS_REPORT_COLUMNS,
        rows: printRows,
        qrDataUrl
    });

    window.print();
}

// إن كانت كل صفوف التقرير المفلترة الحالية تخص شركة واحدة فقط، تُعاد كاسمها، وإلا تُعاد null
function detectSingleCollectionsReportCompanyLabel(rows) {
    const names = new Set(rows.map(r => r.companyName).filter(n => n && n !== '----'));
    if (names.size === 1) return Array.from(names)[0];
    return null;
}

window.addEventListener('afterprint', () => {
    const printRoot = document.getElementById('printPagesRoot');
    if (printRoot) printRoot.innerHTML = '';
});