// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================

// 🛡️ نفس منطق نطاق الرؤية المستخدم بتقرير الشركات/الموظفين: مسؤول الشركة
// (role='company') يرى فقط روابط موظفي شركته/شركاته المملوكة، بينما
// super_admin/admin يريان كل الروابط.
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
let fullLinksReportDataset = [];
let filteredLinksReportDataset = [];

// قوائم القيم المميزة (Distinct) لتغذية اقتراحات قوائم البحث
let allEmployeeNameOptions = [];
let allCompanyNameOptions = [];

// إعدادات تقسيم الصفحات
let currentLinksReportPage = 1;
const linksReportRowsPerPage = 10;

// 📅 تاريخ اليوم بصيغة YYYY-MM-DD حسب توقيت جهاز المستخدم — يُستخدم لتقييد جلب
// روابط الموظفين على الروابط النشطة فقط (بلا تاريخ انتهاء، أو لم يأتِ تاريخ
// انتهائها بعد)، بنفس منطق بقية التقارير — بدون هذا الفلتر كانت ستظهر روابط
// مُنهاة (بعد "إنهاء ربط موظف") ضمن التقرير رغم انتهائها فعلياً.
function getTodayDateStringForLinks() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

document.addEventListener('DOMContentLoaded', async () => {
    const allowed = await Permissions.guardPage('reports_company_links');
    if (!allowed) return;

    // قائمتا بحث قابلتان للكتابة فيها (Searchable Combobox) لاسم الموظف واسم الشركة
    setupSearchCombo({
        inputId: 'reportEmployeeSearchInput',
        dropdownId: 'reportEmployeeDropdown',
        clearLabel: 'كل الموظفين',
        emptyText: 'لا يوجد موظفون مطابقون',
        getOptions: () => allEmployeeNameOptions,
        onQueryChange: applyLinksReportFilters
    });

    setupSearchCombo({
        inputId: 'reportCompanySearchInput',
        dropdownId: 'reportCompanyDropdown',
        clearLabel: 'كل الشركات',
        emptyText: 'لا توجد شركات مطابقة',
        getOptions: () => allCompanyNameOptions,
        onQueryChange: applyLinksReportFilters
    });

    const statusFilter = document.getElementById('reportStatusFilter');
    if (statusFilter) statusFilter.addEventListener('change', applyLinksReportFilters);
    const linkTypeFilter = document.getElementById('reportLinkTypeFilter');
    if (linkTypeFilter) linkTypeFilter.addEventListener('change', applyLinksReportFilters);

    const btnExport = document.getElementById('btnExportExcel');
    if (btnExport) btnExport.addEventListener('click', exportLinksReportToExcel);

    const btnPrint = document.getElementById('btnPrintReport');
    if (btnPrint) btnPrint.addEventListener('click', printLinksReport);

    await loadCurrentUserScope();
    await loadLinksReportData();
});

// =========================================================================
// 1ب. مكوّن قائمة بحث قابلة للكتابة فيها (Searchable Filter Combobox) — أداة
//     تصفية حرة للتقرير، نفس منطق تقريري الموظفين والشركات تماماً.
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

// =========================================================================
// 1ج. جلب كامل صفوف جدول ما على دفعات (Pagination) — سوبابيس (PostgREST)
//     يفرض حداً افتراضياً 1000 صف كحد أقصى لكل طلب — نفس الأداة المستخدمة
//     بكل التقارير الأخرى لضمان تحميل كل السجلات مهما بلغ عددها.
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
// 2. جلب بيانات روابط الموظفين بالشركات (employee_links) مع بيانات كل موظف
//    وشركة مرتبطَين بها
// =========================================================================
async function loadLinksReportData() {
    const tableBody = document.getElementById('reportTableBody');

    try {
        // 🛡️ مسؤول الشركة بلا شركات مملوكة أصلاً — لا داعي لأي طلب شبكة، التقرير فارغ
        if (currentUserScope.companyIds !== null && currentUserScope.companyIds.length === 0) {
            fullLinksReportDataset = [];
            filteredLinksReportDataset = [];
            allEmployeeNameOptions = [];
            allCompanyNameOptions = [];
            currentLinksReportPage = 1;
            renderLinksReportTable(filteredLinksReportDataset);
            return;
        }

        // ⚠️ روابط نشطة فقط (بلا تاريخ انتهاء، أو لم يأتِ تاريخ انتهائها بعد) —
        // نفس فلتر بقية التقارير بعد أن أصبح "إنهاء ربط موظف" يُسجِّل تاريخ
        // انتهاء بدل حذف السجل فعلياً.
        //
        // 🛡️ نطاق الرؤية: لمسؤول الشركة (companyIds مصفوفة محددة)، يُقيَّد
        // الاستعلام بشركاته المملوكة فقط عبر .in('company_id', ...).
        const todayStr = getTodayDateStringForLinks();
        const links = await fetchAllRows((from, to) => {
            let query = dbClient.from('employee_links')
                .select('id, link_type, link_status, link_status_note, basic_salary_value, net_salary_value, employees(name, national_id, mobile_number), companies(name, company_refund, company_refund_type, company_commission, company_commission_type, income_mode, company_net_income, company_net_income_type)')
                .or(`link_end_date.is.null,link_end_date.gte.${todayStr}`)
                .order('id', { ascending: true });
            if (currentUserScope.companyIds !== null) query = query.in('company_id', currentUserScope.companyIds);
            return query.range(from, to);
        });

        fullLinksReportDataset = links.map(link => {
            // 🆕 حالة الربط: السجلات القديمة (قبل إضافة هذا الحقل) تُعامَل كـ
            // "تم التعيين" افتراضياً — نفس القيمة الافتراضية بقاعدة البيانات.
            const linkStatus = link.link_status || 'تم التعيين';
            const isPending = linkStatus === 'قيد المعالجة';
            // رسوم الاسترداد والعمولة وصافي الدخل: النسبة تُحسب من صافي هذا الربط تحديداً
            const fin = window.CompanyFinance.compute(link.net_salary_value, link.companies);

            return {
                id: link.id,
                company_name: (link.companies && link.companies.name) || '----',
                employee_name: (link.employees && link.employees.name) || '----',
                national_id: (link.employees && link.employees.national_id) || '----',
                mobile_number: (link.employees && link.employees.mobile_number) || '----',
                basic_salary: formatLinksReportMoney(link.basic_salary_value, '----'),
                net_fee: formatLinksReportMoney(link.net_salary_value, '----'),
                refund_fee: formatLinksReportMoney(fin.refund, '----'),
                commission_fee: formatLinksReportMoney(fin.commission, '----'),
                net_income: formatLinksReportMoney(fin.income, '----'),
                link_type: link.link_type || '',
                link_status: linkStatus,
                // 🏷️ عمود "الحالة" المعروض: يُظهر ملاحظة حالة الربط لو كانت الحالة
                // "قيد المعالجة" (أو نص "قيد المعالجة" نفسه لو لم تُكتب ملاحظة)،
                // أو يكتب "تم التعيين" لو كانت الحالة "تم التعيين" — حسب طلب المستخدم صراحة.
                status_display: isPending ? (link.link_status_note || 'قيد المعالجة') : 'تم التعيين'
            };
        });

        filteredLinksReportDataset = fullLinksReportDataset;
        currentLinksReportPage = 1;

        // تحديث قوائم الاقتراحات
        allEmployeeNameOptions = distinctSorted(fullLinksReportDataset.map(r => r.employee_name));
        allCompanyNameOptions = distinctSorted(fullLinksReportDataset.map(r => r.company_name));

        renderLinksReportTable(filteredLinksReportDataset);

    } catch (error) {
        console.error("فشل تحميل بيانات تقرير ربط الشركات:", error);
        if (tableBody) {
            tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:#ef4444; padding:20px;">تعذّر تحميل بيانات التقرير: ${(error && error.message) || 'خطأ غير معروف'}</td></tr>`;
        }
    }
}

function distinctSorted(values) {
    return Array.from(new Set(values.filter(v => v && v !== '----'))).sort((a, b) => a.localeCompare(b, 'ar'));
}

// =========================================================================
// 3. تطبيق الفلاتر: اسم الموظف + اسم الشركة + حالة الربط + نوع الربط
// =========================================================================
function applyLinksReportFilters() {
    const employeeQuery = (document.getElementById('reportEmployeeSearchInput')?.value || '').toLowerCase().trim();
    const companyQuery = (document.getElementById('reportCompanySearchInput')?.value || '').toLowerCase().trim();
    const statusValue = document.getElementById('reportStatusFilter')?.value || 'all';
    // نوع الربط (اضافة / استضافة) محفوظ على ربط كل موظف بالشركة، وليس على الشركة نفسها
    const linkTypeValue = document.getElementById('reportLinkTypeFilter')?.value || 'all';

    filteredLinksReportDataset = fullLinksReportDataset.filter(row => {
        const matchesEmployee = !employeeQuery || row.employee_name.toLowerCase().includes(employeeQuery);
        const matchesCompany = !companyQuery || row.company_name.toLowerCase().includes(companyQuery);
        const matchesStatus =
            statusValue === 'all' ||
            (statusValue === 'assigned' && row.link_status === 'تم التعيين') ||
            (statusValue === 'pending' && row.link_status === 'قيد المعالجة');

        const matchesLinkType = linkTypeValue === 'all' || row.link_type === linkTypeValue;

        return matchesEmployee && matchesCompany && matchesStatus && matchesLinkType;
    });

    currentLinksReportPage = 1;
    renderLinksReportTable(filteredLinksReportDataset);
}

// =========================================================================
// 4. بناء جدول التقرير (وضع الشاشة: مع تقسيم صفحات)
// =========================================================================
function renderLinksReportTable(data) {
    const tableBody = document.getElementById('reportTableBody');
    const resultsCountEl = document.getElementById('reportResultsCount');
    if (!tableBody) return;

    if (resultsCountEl) {
        resultsCountEl.textContent = `عدد النتائج المطابقة: ${data.length}`;
    }

    if (!data || data.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:30px; color:#94a3b8;">لا توجد بيانات مطابقة لخيارات البحث الحالية.</td></tr>`;
        setupLinksReportPaginationControls(0);
        return;
    }

    const startIndex = (currentLinksReportPage - 1) * linksReportRowsPerPage;
    const endIndex = startIndex + linksReportRowsPerPage;
    const paginatedData = data.slice(startIndex, endIndex);

    tableBody.innerHTML = paginatedData.map(row => buildLinksReportRowHtml(row)).join('');

    setupLinksReportPaginationControls(data.length);
}

// تنسيق مبلغ بأرقام إنجليزية ومنزلتين عشريتين؛ القيمة الفارغة تُعاد كنص بديل
function formatLinksReportMoney(value, emptyText) {
    if (value === null || value === undefined || value === '') return emptyText;
    const num = parseFloat(value);
    if (isNaN(num)) return emptyText;
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
}

function buildLinksReportRowHtml(row) {
    const isPending = row.link_status === 'قيد المعالجة';
    const statusColor = isPending ? '#b45309' : '#15803d';

    return `
        <tr>
            <td>
                <strong style="color:#1e293b;">${row.employee_name}</strong>
                <div style="color:#64748b; font-size:0.82rem; font-weight:500; margin-top:2px;">${row.company_name}</div>
            </td>
            <td style="color:#475569; font-family: monospace; font-size:0.95rem;">
                ${row.national_id}
                <div style="color:#64748b; font-size:0.85rem; margin-top:2px;">${row.mobile_number}</div>
            </td>
            <td style="text-align:center; color:#334155; font-family: monospace; font-size:0.95rem;">${row.basic_salary}</td>
            <td style="text-align:center; color:#334155; font-family: monospace; font-size:0.95rem;">${row.net_fee}</td>
            <td style="text-align:center; color:#334155; font-family: monospace; font-size:0.95rem;">${row.refund_fee}</td>
            <td style="text-align:center; color:#334155; font-family: monospace; font-size:0.95rem;">${row.commission_fee}</td>
            <td style="text-align:center; color:#0f172a; font-weight:700; font-family: monospace; font-size:0.95rem;">${row.net_income}</td>
            <td style="text-align:center; color:${statusColor}; font-weight:600;">${row.status_display}</td>
        </tr>
    `;
}

// =========================================================================
// 5. أزرار التنقل بين صفحات التقرير
// =========================================================================
function setupLinksReportPaginationControls(totalItems) {
    const controlsContainer = document.getElementById('reportPagination');
    if (!controlsContainer) return;
    controlsContainer.innerHTML = '';

    const totalPages = Math.ceil(totalItems / linksReportRowsPerPage);
    if (totalPages <= 1) return;

    const prevBtn = document.createElement('button');
    prevBtn.innerHTML = '&rarr; السابقة';
    prevBtn.disabled = currentLinksReportPage === 1;
    prevBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;';
    if (prevBtn.disabled) prevBtn.style.opacity = '0.5';
    prevBtn.onclick = () => {
        if (currentLinksReportPage > 1) {
            currentLinksReportPage--;
            renderLinksReportTable(filteredLinksReportDataset);
        }
    };
    controlsContainer.appendChild(prevBtn);

    const countLabel = document.createElement('span');
    countLabel.style.cssText = 'font-size: 0.9rem; color: #475569; font-weight: 600; margin: 0 10px;';
    countLabel.textContent = `صفحة ${currentLinksReportPage} من ${totalPages}`;
    controlsContainer.appendChild(countLabel);

    const nextBtn = document.createElement('button');
    nextBtn.innerHTML = 'التالية &larr;';
    nextBtn.disabled = currentLinksReportPage === totalPages;
    nextBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;';
    if (nextBtn.disabled) nextBtn.style.opacity = '0.5';
    nextBtn.onclick = () => {
        if (currentLinksReportPage < totalPages) {
            currentLinksReportPage++;
            renderLinksReportTable(filteredLinksReportDataset);
        }
    };
    controlsContainer.appendChild(nextBtn);
}

// =========================================================================
// 6. تصدير التقرير الكامل (بعد الفلترة) إلى ملف Excel عبر مكتبة SheetJS
// =========================================================================
function exportLinksReportToExcel() {
    if (!filteredLinksReportDataset || filteredLinksReportDataset.length === 0) {
        alert('لا توجد بيانات لتصديرها بناءً على خيارات البحث الحالية.');
        return;
    }

    const headers = ['الشركة', 'اسم الموظف', 'رقم الهوية', 'رقم الجوال', 'الراتب', 'رسوم الموظف (الصافي)', 'رسوم الاسترداد', 'العمولة', 'صافي الدخل', 'الحالة'];

    const rows = filteredLinksReportDataset.map(row => [
        row.company_name,
        row.employee_name,
        row.national_id,
        row.mobile_number,
        row.basic_salary,
        row.net_fee,
        row.refund_fee,
        row.commission_fee,
        row.net_income,
        row.status_display
    ]);

    const worksheetData = [headers, ...rows];
    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

    worksheet['!cols'] = [
        { wch: 22 }, { wch: 22 }, { wch: 15 }, { wch: 15 }, { wch: 14 }, { wch: 20 }, { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 24 }
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'تقرير ربط الشركات');

    const now = new Date();
    const dateSuffix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    XLSX.writeFile(workbook, `تقرير_ربط_الشركات_${dateSuffix}.xlsx`);
}

// =========================================================================
// 7. طباعة التقرير: نفس تصميم الطباعة الاحترافي المشترك مع بقية التقارير
//    (ترويسة بالشركة + رمز QR + رقم مستند + جدول بترويسة زرقاء + علامة مائية
//    متكررة + تذييل برقم الصفحة)، عبر buildGenericReportPrintPagesHtml مع
//    تعريف أعمدة هذا التقرير تحديداً.
// =========================================================================
const COMPANY_LINKS_REPORT_COLUMNS = [
    // اسم الشركة يظهر تحت اسم الموظف (subKey) بدل عمود مستقل
    { key: 'employee_name', label: 'اسم الموظف', align: 'right', subKey: 'company_name' },
    // رقم الجوال يظهر تحت رقم الهوية (subKey) بدل عمود مستقل
    { key: 'national_id', label: 'رقم الهوية', align: 'center', subKey: 'mobile_number' },
    { key: 'basic_salary', label: 'الراتب', align: 'center' },
    { key: 'net_fee', label: 'رسوم الموظف (الصافي)', align: 'center' },
    { key: 'refund_fee', label: 'رسوم الاسترداد', align: 'center' },
    { key: 'commission_fee', label: 'العمولة', align: 'center' },
    { key: 'net_income', label: 'صافي الدخل', align: 'center' },
    { key: 'status_display', label: 'الحالة', align: 'center' }
];


// =========================================================================
// 7ب. اختيار الأعمدة المراد طباعتها (نافذة تظهر عند الضغط على "طباعة")
//     "اسم الشركة" يظهر تحت اسم الموظف، و"رقم الجوال" تحت رقم الهوية — إن اختير
//     أحدهما بدون الآخر يظهر كعمود مستقل. ويُحفظ الاختيار الأخير على هذا المتصفح.
// =========================================================================
const LINKS_PRINT_COLUMN_OPTIONS = [
    { id: 'employee', label: 'اسم الموظف' },
    { id: 'company', label: 'اسم الشركة' },
    { id: 'national_id', label: 'رقم الهوية' },
    { id: 'mobile', label: 'رقم الجوال' },
    { id: 'basic_salary', label: 'الراتب' },
    { id: 'net_fee', label: 'رسوم الموظف (الصافي)' },
    { id: 'refund_fee', label: 'رسوم الاسترداد' },
    { id: 'commission_fee', label: 'العمولة' },
    { id: 'net_income', label: 'صافي الدخل' },
    { id: 'status_display', label: 'الحالة' }
];
const LINKS_PRINT_COLUMNS_STORAGE_KEY = 'linksReportPrintColumns';

function loadSavedLinksPrintColumns() {
    try {
        const saved = JSON.parse(localStorage.getItem(LINKS_PRINT_COLUMNS_STORAGE_KEY) || 'null');
        if (Array.isArray(saved)) {
            const valid = saved.filter(id => LINKS_PRINT_COLUMN_OPTIONS.some(o => o.id === id));
            if (valid.length) return valid;
        }
    } catch (e) { /* التخزين المحلي غير متاح — نتجاهله */ }
    return LINKS_PRINT_COLUMN_OPTIONS.map(o => o.id);
}
function saveLinksPrintColumns(ids) {
    try { localStorage.setItem(LINKS_PRINT_COLUMNS_STORAGE_KEY, JSON.stringify(ids)); } catch (e) { /* تجاهل */ }
}

// بناء تعريف أعمدة الطباعة من الخيارات المحددة. حين تخص النتائج شركة واحدة فقط
// لا يُعرض اسم الشركة في الجدول لأنه موجود أصلاً في ترويسة الصفحة.
function buildLinksPrintColumns(selectedIds, singleCompany) {
    const sel = new Set(selectedIds);
    const includeCompany = sel.has('company') && !singleCompany;
    const cols = [];

    if (sel.has('employee')) {
        const col = { key: 'employee_name', label: 'اسم الموظف', align: 'right' };
        if (includeCompany) col.subKey = 'company_name';
        cols.push(col);
    } else if (includeCompany) {
        cols.push({ key: 'company_name', label: 'الشركة', align: 'right' });
    }

    if (sel.has('national_id')) {
        const col = { key: 'national_id', label: 'رقم الهوية', align: 'center' };
        if (sel.has('mobile')) col.subKey = 'mobile_number';
        cols.push(col);
    } else if (sel.has('mobile')) {
        cols.push({ key: 'mobile_number', label: 'رقم الجوال', align: 'center' });
    }

    COMPANY_LINKS_REPORT_COLUMNS.forEach(col => {
        if (['employee_name', 'national_id'].includes(col.key)) return;
        if (sel.has(col.key)) cols.push({ key: col.key, label: col.label, align: col.align });
    });
    return cols;
}

function openLinksPrintColumnsDialog(onConfirm) {
    const existing = document.getElementById('linksPrintColumnsOverlay');
    if (existing) existing.remove();

    const selected = new Set(loadSavedLinksPrintColumns());
    const overlay = document.createElement('div');
    overlay.id = 'linksPrintColumnsOverlay';
    overlay.setAttribute('dir', 'rtl');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;font-family:Cairo,sans-serif;';
    overlay.innerHTML = `
        <div style="background:#fff;border-radius:14px;max-width:420px;width:100%;padding:22px;box-shadow:0 20px 50px rgba(0,0,0,.25);">
            <h3 style="margin:0 0 4px;font-size:1.1rem;color:#0f172a;">اختيار الأعمدة المراد طباعتها</h3>
            <p style="margin:0 0 14px;color:#64748b;font-size:.85rem;">اسم الشركة يظهر تحت اسم الموظف، ورقم الجوال تحت رقم الهوية عند اختيارهما معًا.</p>
            <div id="linksPrintColumnsList" style="display:grid;gap:8px;max-height:50vh;overflow:auto;">
                ${LINKS_PRINT_COLUMN_OPTIONS.map(o => `
                    <label style="display:flex;align-items:center;gap:10px;cursor:pointer;color:#1e293b;">
                        <input type="checkbox" value="${o.id}" ${selected.has(o.id) ? 'checked' : ''}>
                        <span>${o.label}</span>
                    </label>`).join('')}
            </div>
            <p id="linksPrintColumnsError" style="display:none;margin:10px 0 0;color:#dc2626;font-size:.85rem;">اختر عمودًا واحدًا على الأقل.</p>
            <div style="display:flex;gap:8px;margin-top:16px;justify-content:space-between;flex-wrap:wrap;">
                <button type="button" id="linksPrintColumnsToggleAll" style="background:none;border:none;color:#2563eb;cursor:pointer;font-family:inherit;">تحديد الكل / إلغاء الكل</button>
                <span style="display:flex;gap:8px;">
                    <button type="button" id="linksPrintColumnsCancel" style="padding:8px 16px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;cursor:pointer;font-family:inherit;">إلغاء</button>
                    <button type="button" id="linksPrintColumnsOk" style="padding:8px 18px;border-radius:8px;border:none;background:#0f172a;color:#fff;cursor:pointer;font-family:inherit;">طباعة</button>
                </span>
            </div>
        </div>`;
    document.body.appendChild(overlay);

    const boxes = () => Array.from(overlay.querySelectorAll('#linksPrintColumnsList input[type="checkbox"]'));
    const close = () => overlay.remove();

    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('#linksPrintColumnsCancel').addEventListener('click', close);
    overlay.querySelector('#linksPrintColumnsToggleAll').addEventListener('click', () => {
        const all = boxes().every(b => b.checked);
        boxes().forEach(b => { b.checked = !all; });
    });
    overlay.querySelector('#linksPrintColumnsOk').addEventListener('click', () => {
        const ids = boxes().filter(b => b.checked).map(b => b.value);
        if (ids.length === 0) {
            overlay.querySelector('#linksPrintColumnsError').style.display = 'block';
            return;
        }
        saveLinksPrintColumns(ids);
        close();
        onConfirm(ids);
    });
}

// زر "طباعة": يفتح نافذة اختيار الأعمدة ثم يطبع
function printLinksReport() {
    if (!filteredLinksReportDataset || filteredLinksReportDataset.length === 0) {
        alert('لا توجد بيانات لطباعتها بناءً على خيارات البحث الحالية.');
        return;
    }
    openLinksPrintColumnsDialog(ids => { runLinksReportPrint(ids); });
}

async function runLinksReportPrint(selectedIds) {
    const printRoot = document.getElementById('printPagesRoot');
    if (!printRoot || !window.PrintReport) {
        window.print();
        return;
    }

    const docNumber = window.PrintReport.generateReportDocNumber();
    const reportDateText = window.PrintReport.formatDateDDMMYYYY(new Date());
    const singleCompanyLabel = detectSingleCompanyLabel(filteredLinksReportDataset);
    const companyLabel = singleCompanyLabel || 'بصمة الأعمال';

    // 🆕 عمود "الشركة" يُستبعَد من الجدول المطبوع تحديداً حين تخص كل نتائج
    // التقرير المفلترة حالياً شركة واحدة فقط — لأن اسمها يظهر أصلاً بعنوان
    // كبير أعلى الصفحة (الترويسة، انظر companyLabel أعلاه)، فتكراره بكل صف
    // من الجدول أصبح زائداً بلا فائدة (بناءً على طلب المستخدم صراحة). يبقى
    // العمود ظاهراً بالجدول فقط حين تشمل نتائج التقرير أكثر من شركة معاً (لا
    // يوجد حينها اسم شركة واحد محدد بالترويسة، فيصبح العمود ضرورياً لتمييز
    // كل صف). ⚠️ هذا يخص نسخة الطباعة/رمز QR فقط — عمود "الشركة" بجدول الشاشة
    // نفسه وبملف تصدير Excel يبقيان كما هما دائماً بلا أي تغيير.
    // (تحديث: اسم الشركة لم يعد عموداً مستقلاً بل سطراً ثانوياً تحت اسم الموظف؛
    //  وحين تخص النتائج شركة واحدة فقط نُسقط هذا السطر لأن اسمها بالترويسة.)
    const printColumns = buildLinksPrintColumns(selectedIds, !!singleCompanyLabel);

    const printRows = filteredLinksReportDataset.map(row => ({
        company_name: row.company_name,
        employee_name: row.employee_name,
        national_id: row.national_id,
        mobile_number: row.mobile_number,
        basic_salary: row.basic_salary,
        net_fee: row.net_fee,
        refund_fee: row.refund_fee,
        commission_fee: row.commission_fee,
        net_income: row.net_income,
        status_display: row.status_display
    }));

    let qrDataUrl = null;
    try {
        const { data: snapshot, error: snapshotError } = await dbClient
            .from('report_snapshots')
            .insert({
                doc_number: docNumber,
                report_title: 'تقرير ربط الشركات',
                report_type: 'company_links',
                columns: printColumns,
                company_name: singleCompanyLabel,
                show_company_column: !singleCompanyLabel,
                report_date_text: reportDateText,
                rows: printRows
            })
            .select('id')
            .single();

        if (snapshotError) throw snapshotError;

        const viewUrl = `${window.location.origin}${window.location.pathname.replace('companies-links-report.html', 'view_report.html')}?id=${snapshot.id}`;
        qrDataUrl = await window.PrintReport.generateReportQrDataUrl(viewUrl);
    } catch (error) {
        console.error('تعذّر إنشاء نسخة قابلة للعرض عبر رمز QR (تأكد من تنفيذ سكربت إضافة عمودي report_type/columns لجدول report_snapshots بسوبابيس):', error.message);
    }

    printRoot.innerHTML = window.PrintReport.buildGenericReportPrintPagesHtml({
        docNumber,
        companyLabel,
        subtitleText: 'تقرير ربط الشركات',
        reportDateText,
        columns: printColumns,
        rows: printRows,
        qrDataUrl,
        showWatermark: false // بلا علامة مائية بناءً على الطلب
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