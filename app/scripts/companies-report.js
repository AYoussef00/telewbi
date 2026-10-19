// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================

// 🛡️ نفس منطق نطاق الرؤية المستخدم بتقرير المهام: مسؤول الشركة (role='company')
// يرى فقط شركته/شركاته المملوكة، بينما super_admin/admin يريان كل الشركات.
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

// مخزن بيانات التقرير الكامل (بعد الربط مع عدد الموظفين الفعلي) ونسخة الفلترة الحالية
let fullCompanyReportDataset = [];
let filteredCompanyReportDataset = [];

// قوائم القيم المميزة (Distinct) لتغذية اقتراحات قوائم البحث
let allCompanyNameOptions = [];
let allCityOptions = [];

// إعدادات تقسيم الصفحات
let currentCompanyReportPage = 1;
const companyReportRowsPerPage = 10;

// 📅 تاريخ اليوم بصيغة YYYY-MM-DD حسب توقيت جهاز المستخدم — يُستخدم لتقييد جلب
// روابط الموظفين (لحساب عدد الموظفين/الاستضافة/الإضافة لكل شركة) على الروابط
// النشطة فقط. ⚠️ ضروري بعد أن أصبح "إنهاء ربط موظف" يُسجِّل تاريخ انتهاء بدل
// حذف السجل فعلياً: بدون هذا الفلتر كانت أعداد الموظفين ستشمل موظفين انتهى
// ربطهم بالفعل، فتظهر أعلى من الواقع.
function getTodayDateStringForLinks() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

document.addEventListener('DOMContentLoaded', async () => {
    const allowed = await Permissions.guardPage('reports_companies');
    if (!allowed) return;

    // قائمتا بحث قابلتان للكتابة فيها (Searchable Combobox) لاسم الشركة والمدينة
    setupSearchCombo({
        inputId: 'reportCompanyNameSearchInput',
        dropdownId: 'reportCompanyNameDropdown',
        clearLabel: 'كل الشركات',
        emptyText: 'لا توجد شركات مطابقة',
        getOptions: () => allCompanyNameOptions,
        onQueryChange: applyCompanyReportFilters
    });

    setupSearchCombo({
        inputId: 'reportCitySearchInput',
        dropdownId: 'reportCityDropdown',
        clearLabel: 'كل المدن',
        emptyText: 'لا توجد مدن مطابقة',
        getOptions: () => allCityOptions,
        onQueryChange: applyCompanyReportFilters
    });

    // نطاق تاريخ العقد (من/إلى) — يُفلتر حسب company.contract_date
    const fromDate = document.getElementById('reportFromDateInput');
    const toDate = document.getElementById('reportToDateInput');
    if (fromDate) fromDate.addEventListener('change', applyCompanyReportFilters);
    if (toDate) toDate.addEventListener('change', applyCompanyReportFilters);

    // فلتر الحالة (نشط/غير نشط) — خيار بحث/تصفية فقط، لا يُضاف كعمود بجدول التقرير
    // ولا بالطباعة/تصدير Excel، فقط يُقيِّد النتائج المعروضة والمُصدَّرة
    const statusFilter = document.getElementById('reportStatusFilter');
    if (statusFilter) statusFilter.addEventListener('change', applyCompanyReportFilters);

    const btnExport = document.getElementById('btnExportExcel');
    if (btnExport) btnExport.addEventListener('click', exportCompanyReportToExcel);

    const btnPrint = document.getElementById('btnPrintReport');
    if (btnPrint) btnPrint.addEventListener('click', printCompanyReport);

    await loadCurrentUserScope();
    await loadCompanyReportData();
});

// =========================================================================
// 1ب. مكوّن قائمة بحث قابلة للكتابة فيها (Searchable Filter Combobox)
//     أداة تصفية حرة للتقرير: كتابة حرة للبحث الفوري أو اختيار اقتراح جاهز
//     من القائمة المنسدلة أسفل الحقل (نفس منطق تقرير الموظفين).
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
        setTimeout(closeDropdown, 150);
    });

    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !dropdown.contains(e.target)) {
            closeDropdown();
        }
    });
}

// 📅 تنسيق تاريخ بصيغة DD/MM/YYYY بأرقام إنجليزية دائماً؛ الأعمدة بقاعدة البيانات بصيغة YYYY-MM-DD
function formatDisplayDate(dateStr) {
    if (!dateStr) return null;
    const datePart = String(dateStr).split('T')[0];
    const parts = datePart.split('-');
    if (parts.length !== 3) return String(dateStr);
    const [y, m, d] = parts;
    return `${d}/${m}/${y}`;
}

// =========================================================================
// 1ج. جلب كامل صفوف جدول ما على دفعات (Pagination) — سوبابيس (PostgREST)
//     يفرض حداً افتراضياً 1000 صف كحد أقصى لكل طلب، وأي طلب select('*') بلا
//     .range() صريح كان يُقتطع صامتاً عند تجاوز هذا الحد فلا تظهر كل البيانات
//     بالجدول (نفس المشكلة التي أُصلحت بتقارير الحضور والمهام والموظفين).
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
// 2. جلب بيانات الشركات + احتساب عدد الموظفين الفعلي المرتبط بكل شركة
// =========================================================================
async function loadCompanyReportData() {
    const tableBody = document.getElementById('reportTableBody');

    try {
        // 🛡️ مسؤول الشركة بلا شركات مملوكة أصلاً — لا داعي لأي طلب شبكة، التقرير فارغ
        if (currentUserScope.companyIds !== null && currentUserScope.companyIds.length === 0) {
            fullCompanyReportDataset = [];
            filteredCompanyReportDataset = [];
            allCompanyNameOptions = [];
            allCityOptions = [];
            currentCompanyReportPage = 1;
            renderCompanyReportTable(filteredCompanyReportDataset);
            return;
        }

        // ⚠️ عدد الموظفين لكل شركة يُحتسب من جدول الربط employee_links (المصدر
        // الفعلي لعلاقة الموظف بالشركة)، وليس من عمود employees.company_id الذي
        // لم يعد يُستخدم منذ فصل شاشة "إضافة موظف" عن شاشة "ربط الموظفين".
        //
        // كلا الجدولين يُجلبان الآن على دفعات (fetchAllRows) بدل طلب واحد،
        // لضمان تحميل كل السجلات مهما بلغ عددها (وليس أول 1000 صف فقط).
        //
        // ⚠️ روابط نشطة فقط (بلا تاريخ انتهاء، أو لم يأتِ تاريخ انتهائها بعد):
        // بعد أن أصبح "إنهاء ربط موظف" يُسجِّل تاريخ انتهاء بدل حذف السجل
        // فعلياً، تبقى روابط الموظفين المُنهاة محفوظة بجدول employee_links —
        // بدون هذا الفلتر كانت أعداد الموظفين/الاستضافة/الإضافة ستشمل موظفين
        // منتهي ربطهم فتظهر أعلى من الواقع.
        //
        // 🛡️ نطاق الرؤية: لمسؤول الشركة (companyIds مصفوفة محددة)، تُقيَّد
        // استعلامات الشركات (.in('id', ...)) والربط (.in('company_id', ...))
        // بشركاته المملوكة فقط.
        //
        // 🏷️ link_type يُجلب أيضاً هنا لاحتساب عدد روابط "استضافة" و"اضافة"
        // لكل شركة على حدة — تُستخدمان الآن كعمودين مستقلين بجدول الشاشة (🆕
        // "عدد الإضافة"/"عدد الاستضافة" قبل عمود "عدد الموظفين")، وأيضاً
        // بعمودي طباعة التقرير "استضافة"/"إضافة" (انظر COMPANIES_REPORT_COLUMNS أسفل).
        const todayStr = getTodayDateStringForLinks();
        const [companies, links] = await Promise.all([
            fetchAllRows((from, to) => {
                let query = dbClient.from('companies').select('*')
                    .order('id', { ascending: true });
                if (currentUserScope.companyIds !== null) query = query.in('id', currentUserScope.companyIds);
                return query.range(from, to);
            }),
            fetchAllRows((from, to) => {
                let query = dbClient.from('employee_links').select('employee_id, company_id, link_type')
                    .or(`link_end_date.is.null,link_end_date.gte.${todayStr}`)
                    .order('employee_id', { ascending: true })
                    .order('company_id', { ascending: true });
                if (currentUserScope.companyIds !== null) query = query.in('company_id', currentUserScope.companyIds);
                return query.range(from, to);
            })
        ]);

        // احتساب عدد الموظفين الإجمالي، وعدد روابط "استضافة" و"اضافة" على حدة، لكل شركة
        const employeeCountByCompanyId = new Map();
        const hostingCountByCompanyId = new Map();
        const additionCountByCompanyId = new Map();
        links.forEach(link => {
            if (link.company_id == null) return;
            const key = String(link.company_id);
            employeeCountByCompanyId.set(key, (employeeCountByCompanyId.get(key) || 0) + 1);
            if (link.link_type === 'استضافة') {
                hostingCountByCompanyId.set(key, (hostingCountByCompanyId.get(key) || 0) + 1);
            } else if (link.link_type === 'اضافة') {
                additionCountByCompanyId.set(key, (additionCountByCompanyId.get(key) || 0) + 1);
            }
        });

        fullCompanyReportDataset = companies.map(company => {
            const idKey = String(company.id);
            return {
                id: company.id,
                // 🔗 user_id: يُستخدم فقط لتجميع "الشركات المربوطة ببعض" (نفس حساب
                // الدخول عبر خيار "ربط هذه الشركة بحساب دخول موجود" بشاشة إضافة شركة)
                // عند الطباعة — انظر groupLinkedCompaniesForPrint أسفل قسم الطباعة.
                user_id: company.user_id || null,
                name: company.name || '----',
                email: company.email || '----',
                phone: company.phone || '----',
                city: company.city || '----',
                contract_type: company.contract_type || 'إستضافة',
                // contract_date_raw بصيغة YYYY-MM-DD الأصلية (للفلترة الحسابية بالنطاق)،
                // contract_date بصيغة DD/MM/YYYY (للعرض بالجدول/التصدير/الطباعة)
                contract_date_raw: company.contract_date || null,
                contract_date: formatDisplayDate(company.contract_date) || '—',
                employee_count: employeeCountByCompanyId.get(idKey) || 0,
                // 🏷️ عدد روابط الموظفين حسب نوع الربط تحديداً لهذه الشركة — 🆕 تُعرض
                // الآن كعمودين مستقلين بجدول الشاشة (قبل عمود "عدد الموظفين")،
                // وتُستخدم أيضاً بعمودي طباعة التقرير "استضافة"/"إضافة".
                hosting_count: hostingCountByCompanyId.get(idKey) || 0,
                addition_count: additionCountByCompanyId.get(idKey) || 0,
                // 🟢🔴 حالة الشركة (نشط/غير نشط) — تُستخدم فقط لتصفية النتائج عبر
                // فلتر "الحالة" بشريط البحث، وليست عموداً بجدول/طباعة/تصدير التقرير.
                // تُعتبر "نشط" افتراضياً للسجلات القديمة التي لا تحمل قيمة status بعد.
                status: company.status || 'active'
            };
        });

        filteredCompanyReportDataset = fullCompanyReportDataset;
        currentCompanyReportPage = 1;

        // تحديث قوائم الاقتراحات
        allCompanyNameOptions = distinctSorted(fullCompanyReportDataset.map(r => r.name));
        allCityOptions = distinctSorted(fullCompanyReportDataset.map(r => r.city).filter(c => c && c !== '----'));

        renderCompanyReportTable(filteredCompanyReportDataset);

    } catch (error) {
        console.error("فشل تحميل بيانات تقرير الشركات:", error);
        if (tableBody) {
            tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#ef4444; padding:20px;">تعذّر تحميل بيانات التقرير: ${(error && error.message) || 'خطأ غير معروف'}</td></tr>`;
        }
    }
}

function distinctSorted(values) {
    return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ar'));
}

// =========================================================================
// 3. تطبيق الفلاتر: اسم الشركة + المدينة + نطاق تاريخ العقد + الحالة
// =========================================================================
function applyCompanyReportFilters() {
    const nameQuery = (document.getElementById('reportCompanyNameSearchInput')?.value || '').toLowerCase().trim();
    const cityQuery = (document.getElementById('reportCitySearchInput')?.value || '').toLowerCase().trim();
    const fromDate = document.getElementById('reportFromDateInput')?.value || '';
    const toDate = document.getElementById('reportToDateInput')?.value || '';
    const statusValue = document.getElementById('reportStatusFilter')?.value || 'all';

    filteredCompanyReportDataset = fullCompanyReportDataset.filter(row => {
        const matchesName = !nameQuery || row.name.toLowerCase().includes(nameQuery);
        const matchesCity = !cityQuery || row.city.toLowerCase().includes(cityQuery);
        const matchesFromDate = !fromDate || (row.contract_date_raw && row.contract_date_raw >= fromDate);
        const matchesToDate = !toDate || (row.contract_date_raw && row.contract_date_raw <= toDate);
        const matchesStatus = statusValue === 'all' || row.status === statusValue;

        return matchesName && matchesCity && matchesFromDate && matchesToDate && matchesStatus;
    });

    currentCompanyReportPage = 1;
    renderCompanyReportTable(filteredCompanyReportDataset);
}

// =========================================================================
// 4. بناء جدول التقرير (وضع الشاشة: مع تقسيم صفحات)
// =========================================================================
function renderCompanyReportTable(data) {
    const tableBody = document.getElementById('reportTableBody');
    const resultsCountEl = document.getElementById('reportResultsCount');
    if (!tableBody) return;

    if (resultsCountEl) {
        resultsCountEl.textContent = `عدد النتائج المطابقة: ${data.length}`;
    }

    if (!data || data.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; color:#94a3b8;">لا توجد بيانات مطابقة لخيارات البحث الحالية.</td></tr>`;
        setupCompanyReportPaginationControls(0);
        return;
    }

    const startIndex = (currentCompanyReportPage - 1) * companyReportRowsPerPage;
    const endIndex = startIndex + companyReportRowsPerPage;
    const paginatedData = data.slice(startIndex, endIndex);

    tableBody.innerHTML = paginatedData.map(row => buildCompanyReportRowHtml(row)).join('');
    if (window.applyIconPlaceholders) applyIconPlaceholders(tableBody); // تعبئة أيقونات SVG بالاستايل الجديد بدل الإيموجي

    setupCompanyReportPaginationControls(data.length);
}

// 🆕 عمود "اسم الشركة" يعرض الآن البريد الإلكتروني تحته بسطر ثانوي رمادي
// (.report-subtext بملف companies-report.css)، بدل عمود "البريد الإلكتروني"
// المنفصل السابق.
function buildCompanyReportRowHtml(row) {
    return `
        <tr>
            <td>
                <strong style="color:#1e293b;">${row.name}</strong>
                <div class="report-subtext">${row.email}</div>
            </td>
            <td style="color:#475569; font-family: monospace; font-size:0.95rem;">${row.phone}</td>
            <td style="color:#334155;">${row.city}</td>
            <td style="text-align:center; color:#334155;">${row.contract_date}</td>
            <td style="text-align:center; font-weight:600; color:#64748b;">${row.addition_count}</td>
            <td style="text-align:center; font-weight:600; color:#64748b;">${row.hosting_count}</td>
            <td style="text-align:center; font-weight:600; color:#64748b;"><span data-icon="people"></span> ${row.employee_count}</td>
        </tr>
    `;
}

// =========================================================================
// 5. أزرار التنقل بين صفحات التقرير
// =========================================================================
function setupCompanyReportPaginationControls(totalItems) {
    const controlsContainer = document.getElementById('reportPagination');
    if (!controlsContainer) return;
    controlsContainer.innerHTML = '';

    const totalPages = Math.ceil(totalItems / companyReportRowsPerPage);
    if (totalPages <= 1) return;

    const prevBtn = document.createElement('button');
    prevBtn.innerHTML = '&rarr; السابقة';
    prevBtn.disabled = currentCompanyReportPage === 1;
    prevBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;';
    if (prevBtn.disabled) prevBtn.style.opacity = '0.5';
    prevBtn.onclick = () => {
        if (currentCompanyReportPage > 1) {
            currentCompanyReportPage--;
            renderCompanyReportTable(filteredCompanyReportDataset);
        }
    };
    controlsContainer.appendChild(prevBtn);

    const countLabel = document.createElement('span');
    countLabel.style.cssText = 'font-size: 0.9rem; color: #475569; font-weight: 600; margin: 0 10px;';
    countLabel.textContent = `صفحة ${currentCompanyReportPage} من ${totalPages}`;
    controlsContainer.appendChild(countLabel);

    const nextBtn = document.createElement('button');
    nextBtn.innerHTML = 'التالية &larr;';
    nextBtn.disabled = currentCompanyReportPage === totalPages;
    nextBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;';
    if (nextBtn.disabled) nextBtn.style.opacity = '0.5';
    nextBtn.onclick = () => {
        if (currentCompanyReportPage < totalPages) {
            currentCompanyReportPage++;
            renderCompanyReportTable(filteredCompanyReportDataset);
        }
    };
    controlsContainer.appendChild(nextBtn);
}

// =========================================================================
// 6. تصدير التقرير الكامل (بعد الفلترة) إلى ملف Excel عبر مكتبة SheetJS
//    ⚠️ يبقى بعمودين منفصلين لاسم الشركة والبريد الإلكتروني (بلا دمج) — بيانات
//    جدولية مسطّحة يُفضَّل فيها الفصل الكامل بين الأعمدة، بخلاف عرض الشاشة.
// =========================================================================
function exportCompanyReportToExcel() {
    if (!filteredCompanyReportDataset || filteredCompanyReportDataset.length === 0) {
        alert('لا توجد بيانات لتصديرها بناءً على خيارات البحث الحالية.');
        return;
    }

    const headers = ['اسم الشركة', 'البريد الإلكتروني', 'رقم الهاتف', 'المدينة', 'تاريخ العقد', 'عدد الموظفين'];

    const rows = filteredCompanyReportDataset.map(row => [
        row.name,
        row.email,
        row.phone,
        row.city,
        row.contract_date,
        row.employee_count
    ]);

    const worksheetData = [headers, ...rows];
    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

    worksheet['!cols'] = [
        { wch: 24 }, { wch: 26 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 14 }
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'تقرير الشركات');

    const now = new Date();
    const dateSuffix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    XLSX.writeFile(workbook, `تقرير_الشركات_${dateSuffix}.xlsx`);
}

// =========================================================================
// 7. طباعة التقرير: نفس تصميم الطباعة الاحترافي المشترك مع تقريري الموظفين
//    والمهام والحضور (ترويسة بالشركة + رمز QR + رقم مستند + جدول بترويسة
//    زرقاء + علامة مائية متكررة + تذييل برقم الصفحة)، عبر
//    buildGenericReportPrintPagesHtml مع تعريف أعمدة تقرير الشركات تحديداً.
//
//    🧮 أعمدة نسخة الطباعة تحديداً (تختلف عن جدول الشاشة وتصدير Excel، اللذين
//    يبقيان كما كانا: اسم الشركة/البريد الإلكتروني/رقم الهاتف/المدينة/تاريخ
//    العقد/عدد الموظفين): اسم الشركة، تاريخ العقد، المدينة، رقم الهاتف، نوع
//    العقد، استضافة، إضافة، إجمالي الموظفين — حسب طلب المستخدم
//    صراحة لنسخة الطباعة فقط (المدينة أُضيفت قبل رقم الهاتف، ثم نوع العقد
//    أُضيف قبل عمودي الاستضافة/الإضافة، ثم اختُصر عنوانا هذين العمودين من
//    "عدد الاستضافة"/"عدد الإضافة" إلى "استضافة"/"إضافة" فقط، بناءً على طلبات لاحقة).
//    عمودا "استضافة"/"إضافة" يُحتسبان من نوع الربط (link_type)
//    بجدول employee_links لكل شركة (انظر loadCompanyReportData أعلاه)، بينما
//    عمود "نوع العقد" يُقرأ مباشرة من company.contract_type.
//
//    🔗 ترتيب خاص بالطباعة فقط: الشركات "المربوطة ببعض" (تشترك بنفس حساب
//    الدخول user_id عبر خيار "ربط هذه الشركة بحساب دخول موجود") تُجمَّع
//    متتالية بعضها بجانب بعض في المطبوعة، بدل تفرقها حسب ترتيب المعرّف/الفلترة
//    الافتراضي. الترتيب العام (أي مجموعة تظهر أولاً) يبقى كما هو — فقط كل
//    مجموعة مرتبطة تُسحَب لتكون متجاورة عند أول ظهور لها (انظر
//    groupLinkedCompaniesForPrint). لا يؤثر هذا على ترتيب جدول الشاشة أو
//    تصدير Excel، فقط على نسخة الطباعة/رمز QR.
//
//    ⚠️ فلتر "الحالة" (نشط/غير نشط) يؤثر فقط على أي الشركات تدخل ضمن
//    filteredCompanyReportDataset أصلاً (نفس مصدر بيانات الطباعة والتصدير)،
//    لكن الحالة نفسها لا تُطبَع كعمود ولا تُصدَّر كعمود — بحسب طلب المستخدم.
//
//    ⚠️ عدد الصفوف بالصفحة: يُحسب تلقائياً بالقياس الفعلي داخل
//    buildGenericReportPrintPagesHtml (انظر packRowsIntoPrintPages بملف
//    print-report.js) — تُملأ كل صفحة بأقصى عدد صفوف يسعها ارتفاعها الحقيقي،
//    لذا لا يُمرَّر هنا أي رقم ثابت (rowsPerPage) عمداً.
//
//    🆕 صف إجمالي أسفل الجدول المطبوع: يُضاف صف أخير إضافي (بعد كل صفوف
//    الشركات) يحمل إجمالي عدد روابط "استضافة" وإجمالي "إضافة" وإجمالي عدد
//    الموظفين (مجموع الأعمدة الثلاثة عبر كل الشركات الظاهرة بالتقرير حسب
//    الفلترة الحالية)، بعمود "اسم الشركة" فيه "الإجمالي" بدل اسم شركة فعلي.
//    يُميَّز هذا الصف بصرياً (خط عريض + خط علوي) عبر المفتاح __isTotalRow
//    الذي تتعرف عليه buildGenericRowHtml بملف print-report.js تحديداً لهذا
//    الغرض (انظر التعليق هناك) — لا يؤثر على أي تقرير آخر يستخدم نفس الدالة
//    المشتركة. يُضاف هذا الصف أيضاً ضمن rows المحفوظة بجدول report_snapshots
//    كي تظهر نفس الإجماليات عند عرض التقرير عبر رمز QR (view_report.html).
// =========================================================================
const COMPANIES_REPORT_COLUMNS = [
    { key: 'name', label: 'اسم الشركة', align: 'right' },
    { key: 'contract_date', label: 'تاريخ العقد', align: 'center' },
    { key: 'city', label: 'المدينة', align: 'center' },
    { key: 'phone', label: 'رقم الهاتف', align: 'center' },
    { key: 'contract_type', label: 'نوع العقد', align: 'center' },
    { key: 'hosting_count', label: 'استضافة', align: 'center' },
    { key: 'addition_count', label: 'إضافة', align: 'center' },
    { key: 'employee_count', label: 'إجمالي الموظفين', align: 'center' }
];

// 🔗 يجمّع الشركات التي تشترك بنفس user_id (نفس حساب الدخول) متتالية بعضها
// بجانب بعض، مع الحفاظ على ترتيب أول ظهور لكل مجموعة كما كان بالمصفوفة
// الأصلية (فرز مستقر بالتجميع، وليس فرزاً أبجدياً/عشوائياً بمعرّف الحساب).
// الشركات غير المرتبطة بأي حساب مشترك (user_id فريد أو فارغ) تُعامَل كل واحدة
// كمجموعة مستقلة فتبقى في مكانها تقريباً دون أي تغيير ملحوظ بالترتيب.
function groupLinkedCompaniesForPrint(rows) {
    const groupOrder = [];
    const groups = new Map();

    rows.forEach(row => {
        // شركة بلا حساب مربوط (user_id فارغ) تُعامَل كمجموعة مستقلة خاصة بها
        // فقط (مفتاح فريد بمعرّف الشركة) حتى لا تُجمَّع خطأً مع شركات أخرى.
        const key = row.user_id ? `u:${row.user_id}` : `single:${row.id}`;
        if (!groups.has(key)) {
            groups.set(key, []);
            groupOrder.push(key);
        }
        groups.get(key).push(row);
    });

    return groupOrder.flatMap(key => groups.get(key));
}

async function printCompanyReport() {
    if (!filteredCompanyReportDataset || filteredCompanyReportDataset.length === 0) {
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

    // ترتيب خاص بالطباعة فقط: تجميع الشركات المربوطة بنفس حساب الدخول متجاورة
    const printOrderedRows = groupLinkedCompaniesForPrint(filteredCompanyReportDataset);

    const printRows = printOrderedRows.map(row => ({
        name: row.name,
        contract_date: row.contract_date,
        city: row.city,
        phone: row.phone,
        contract_type: row.contract_type,
        hosting_count: row.hosting_count,
        addition_count: row.addition_count,
        employee_count: row.employee_count
    }));

    // 🆕 صف الإجمالي: مجموع الاستضافة/الإضافة/عدد الموظفين عبر كل الشركات
    // الظاهرة بالتقرير المطبوع (نفس مجموعة printOrderedRows بالضبط — لا يتأثر
    // الترتيب أعلاه بإضافة هذا الصف، فهو يُضاف لنهاية printRows بعد بنائها).
    const totalHostingCount = printOrderedRows.reduce((sum, row) => sum + (row.hosting_count || 0), 0);
    const totalAdditionCount = printOrderedRows.reduce((sum, row) => sum + (row.addition_count || 0), 0);
    const totalEmployeeCount = printOrderedRows.reduce((sum, row) => sum + (row.employee_count || 0), 0);

    printRows.push({
        name: 'الإجمالي',
        contract_date: '',
        city: '',
        phone: '',
        contract_type: '',
        hosting_count: totalHostingCount,
        addition_count: totalAdditionCount,
        employee_count: totalEmployeeCount,
        __isTotalRow: true // 🏷️ علامة يتعرف عليها buildGenericRowHtml بملف print-report.js لتمييز الصف بصرياً (خط عريض + خط علوي)
    });

    let qrDataUrl = null;
    try {
        const { data: snapshot, error: snapshotError } = await dbClient
            .from('report_snapshots')
            .insert({
                doc_number: docNumber,
                report_title: 'تقرير الشركات',
                report_type: 'companies',
                columns: COMPANIES_REPORT_COLUMNS,
                company_name: null,
                show_company_column: false,
                report_date_text: reportDateText,
                rows: printRows
            })
            .select('id')
            .single();

        if (snapshotError) throw snapshotError;

        const viewUrl = `${window.location.origin}${window.location.pathname.replace('companies-report.html', 'view_report.html')}?id=${snapshot.id}`;
        qrDataUrl = await window.PrintReport.generateReportQrDataUrl(viewUrl);
    } catch (error) {
        console.error('تعذّر إنشاء نسخة قابلة للعرض عبر رمز QR (تأكد من تنفيذ سكربت إضافة عمودي report_type/columns لجدول report_snapshots بسوبابيس):', error.message);
    }

    printRoot.innerHTML = window.PrintReport.buildGenericReportPrintPagesHtml({
        docNumber,
        companyLabel: 'بصمة الأعمال',
        subtitleText: 'تقرير الشركات',
        reportDateText,
        columns: COMPANIES_REPORT_COLUMNS,
        rows: printRows,
        qrDataUrl
    });

    window.print();
}

window.addEventListener('afterprint', () => {
    const printRoot = document.getElementById('printPagesRoot');
    if (printRoot) printRoot.innerHTML = '';
});
