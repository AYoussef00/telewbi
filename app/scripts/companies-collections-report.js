// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================

// =========================================================================
// تقرير "تحصيل الشركات": لكل شركة ضمن نطاق رؤية المستخدم — عدد الفواتير
// الصادرة لها، إجمالي قيمتها، المحصَّل منها (الفواتير التي status = 'paid')،
// والمتبقي (status = 'unpaid' أو 'overdue')، ضمن نطاق تاريخ الفواتير المحدد
// (أو كل الفواتير إن تُرك النطاق فارغاً). يعتمد على جدولي 'companies'
// و'invoices' الموجودين أصلاً (شاشتا "الشركات" و"الفواتير")، بلا أي جدول جديد.
// =========================================================================

// 🛡️ نفس منطق نطاق الرؤية المستخدم ببقية التقارير: مسؤول الشركة (role='company')
// يرى فقط شركته/شركاته المملوكة، بينما super_admin/admin يريان الجميع.
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
const COMP_COLL_FETCH_PAGE_SIZE = 1000;

async function fetchAllRows(builderFactory) {
    let allRows = [];
    let from = 0;
    while (true) {
        const { data, error } = await builderFactory(from, from + COMP_COLL_FETCH_PAGE_SIZE - 1);
        if (error) throw error;
        allRows = allRows.concat(data || []);
        if (!data || data.length < COMP_COLL_FETCH_PAGE_SIZE) break;
        from += COMP_COLL_FETCH_PAGE_SIZE;
    }
    return allRows;
}

// البيانات الخام المحمَّلة مرة واحدة (ضمن نطاق الرؤية)
let compCollCompaniesRaw = [];   // [{id, name, user_id}]
let compCollInvoicesRaw = [];    // [{company_id, invoice_date, total_amount, status}]

// النتائج بعد التجميع لكل شركة (قبل فلترة الاسم/الحالة) وبعدها
let compCollAggregatedRows = [];
let compCollFilteredRows = [];

// قائمة أسماء الشركات المميزة لتغذية اقتراحات البحث
let allCompCollNameOptions = [];

let currentCompCollPage = 1;
const compCollRowsPerPage = 10;

document.addEventListener('DOMContentLoaded', async () => {
    const allowed = await Permissions.guardPage('reports_companies_collections');
    if (!allowed) return;

    setupCompCollSearchCombo({
        inputId: 'compCollNameSearchInput',
        dropdownId: 'compCollNameDropdown',
        clearLabel: 'كل الشركات',
        emptyText: 'لا توجد شركات مطابقة',
        getOptions: () => allCompCollNameOptions,
        onQueryChange: applyCompCollFilters
    });

    const fromDate = document.getElementById('compCollFromDateInput');
    const toDate = document.getElementById('compCollToDateInput');
    if (fromDate) fromDate.addEventListener('change', applyCompCollFilters);
    if (toDate) toDate.addEventListener('change', applyCompCollFilters);

    const statusFilter = document.getElementById('compCollStatusFilter');
    if (statusFilter) statusFilter.addEventListener('change', applyCompCollFilters);

    const btnExport = document.getElementById('btnExportCompanyCollectionsExcel');
    if (btnExport) btnExport.addEventListener('click', exportCompCollReportToExcel);

    const btnPrint = document.getElementById('btnPrintCompanyCollectionsReport');
    if (btnPrint) btnPrint.addEventListener('click', printCompCollReport);

    await loadCurrentUserScope();
    await loadCompCollReportData();
});

// =========================================================================
// مكوّن قائمة بحث قابلة للكتابة فيها (Searchable Filter Combobox) — نفس مكوّن
// بقية ملفات التقارير، بمعرّف دوال منفصل تفادياً لأي تعارض أسماء مستقبلاً
// =========================================================================
function setupCompCollSearchCombo({ inputId, dropdownId, clearLabel, emptyText, getOptions, onQueryChange }) {
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
    input.addEventListener('blur', () => setTimeout(closeDropdown, 150));
    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !dropdown.contains(e.target)) closeDropdown();
    });
}

// 💰 تنسيق القيم المالية بمنزلتين عشريتين بأرقام إنجليزية دائماً
function formatCompCollCurrency(value) {
    const num = parseFloat(value);
    if (isNaN(num)) return '0.00';
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
}

// 📅 تنسيق تاريخ بصيغة DD/MM/YYYY؛ الأعمدة بقاعدة البيانات بصيغة YYYY-MM-DD
function formatCompCollDate(dateStr) {
    if (!dateStr) return '—';
    const datePart = String(dateStr).split('T')[0];
    const parts = datePart.split('-');
    if (parts.length !== 3) return String(dateStr);
    const [y, m, d] = parts;
    return `${d}/${m}/${y}`;
}

// =========================================================================
// 2. جلب الشركات والفواتير (مرة واحدة ضمن نطاق الرؤية)، ثم بناء التجميع الأول
// =========================================================================
async function loadCompCollReportData() {
    const tableBody = document.getElementById('compCollTableBody');

    try {
        // 🛡️ مسؤول الشركة بلا شركات مملوكة أصلاً — لا داعي لأي طلب شبكة، التقرير فارغ
        if (currentUserScope.companyIds !== null && currentUserScope.companyIds.length === 0) {
            compCollCompaniesRaw = [];
            compCollInvoicesRaw = [];
            allCompCollNameOptions = [];
            currentCompCollPage = 1;
            applyCompCollFilters();
            return;
        }

        const [companies, invoices] = await Promise.all([
            fetchAllRows((from, to) => {
                // 🆕 user_id مطلوب أيضاً هنا (وليس فقط id/name كما كان سابقاً) —
                // يُستخدم فقط بترتيب نسخة الطباعة (انظر groupLinkedCompaniesForPrint
                // أسفل الملف) لتجميع الشركات "المربوطة ببعض" (تشترك بنفس حساب
                // الدخول) متجاورة، بنفس منطق تقرير الشركات (companies-report.js).
                let query = dbClient.from('companies').select('id, name, user_id').order('name', { ascending: true });
                if (currentUserScope.companyIds !== null) query = query.in('id', currentUserScope.companyIds);
                return query.range(from, to);
            }),
            fetchAllRows((from, to) => {
                let query = dbClient.from('invoices').select('company_id, invoice_date, total_amount, status');
                if (currentUserScope.companyIds !== null) query = query.in('company_id', currentUserScope.companyIds);
                return query.range(from, to);
            })
        ]);

        compCollCompaniesRaw = companies;
        compCollInvoicesRaw = invoices;

        allCompCollNameOptions = Array.from(new Set(companies.map(c => c.name).filter(Boolean)))
            .sort((a, b) => a.localeCompare(b, 'ar'));

        currentCompCollPage = 1;
        applyCompCollFilters();

    } catch (error) {
        console.error('تعذّر تحميل بيانات تقرير تحصيل الشركات:', error);
        if (tableBody) {
            tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#ef4444; padding:20px;">تعذّر تحميل بيانات التقرير: ${(error && error.message) || 'خطأ غير معروف'}</td></tr>`;
        }
    }
}

// =========================================================================
// 3. التجميع: تصفية الفواتير حسب نطاق التاريخ أولاً، ثم تجميعها لكل شركة —
//    هذا يُعاد حسابه بالكامل محلياً (بلا أي طلب شبكة جديد) عند أي تغيير
//    بنطاق التاريخ، لأن كل الفواتير الخام محمَّلة مسبقاً بالذاكرة.
// =========================================================================
function computeCompCollAggregatedRows() {
    const fromDate = document.getElementById('compCollFromDateInput')?.value || '';
    const toDate = document.getElementById('compCollToDateInput')?.value || '';

    const invoicesInRange = compCollInvoicesRaw.filter(inv => {
        const d = inv.invoice_date;
        if (fromDate && (!d || d < fromDate)) return false;
        if (toDate && (!d || d > toDate)) return false;
        return true;
    });

    const statsByCompanyId = new Map();
    invoicesInRange.forEach(inv => {
        if (inv.company_id == null) return;
        const key = String(inv.company_id);
        if (!statsByCompanyId.has(key)) {
            statsByCompanyId.set(key, { count: 0, total: 0, paid: 0, remaining: 0, lastDate: null });
        }
        const stat = statsByCompanyId.get(key);
        const amount = parseFloat(inv.total_amount) || 0;
        stat.count += 1;
        stat.total += amount;
        if (inv.status === 'paid') {
            stat.paid += amount;
        } else {
            stat.remaining += amount; // 'unpaid' أو 'overdue' كلاهما مبلغ لم يُحصَّل بعد
        }
        if (!stat.lastDate || (inv.invoice_date && inv.invoice_date > stat.lastDate)) {
            stat.lastDate = inv.invoice_date || stat.lastDate;
        }
    });

    return compCollCompaniesRaw.map(company => {
        const key = String(company.id);
        const stat = statsByCompanyId.get(key) || { count: 0, total: 0, paid: 0, remaining: 0, lastDate: null };
        const collectionRate = stat.total > 0 ? Math.round((stat.paid / stat.total) * 1000) / 10 : null; // null = لا توجد فواتير أصلاً

        return {
            companyId: company.id,
            userId: company.user_id, // 🆕 يُستخدم فقط بترتيب نسخة الطباعة (تجميع الشركات المربوطة ببعض)
            companyName: company.name || '----',
            invoiceCount: stat.count,
            totalAmount: stat.total,
            paidAmount: stat.paid,
            remainingAmount: stat.remaining,
            collectionRate,
            lastInvoiceDateRaw: stat.lastDate
        };
    });
}

// =========================================================================
// 4. تطبيق الفلاتر: بحث اسم الشركة + حالة التحصيل (فوق التجميع المُعاد حسابه
//    حسب نطاق التاريخ الحالي)
// =========================================================================
function applyCompCollFilters() {
    compCollAggregatedRows = computeCompCollAggregatedRows();

    const nameQuery = (document.getElementById('compCollNameSearchInput')?.value || '').toLowerCase().trim();
    const statusValue = document.getElementById('compCollStatusFilter')?.value || 'all';

    compCollFilteredRows = compCollAggregatedRows.filter(row => {
        const matchesName = !nameQuery || row.companyName.toLowerCase().includes(nameQuery);

        const hasRemaining = row.remainingAmount > 0.004;
        const matchesStatus =
            statusValue === 'all' ||
            (statusValue === 'outstanding' && hasRemaining) ||
            (statusValue === 'fully_paid' && !hasRemaining && row.invoiceCount > 0);

        return matchesName && matchesStatus;
    });

    currentCompCollPage = 1;
    updateCompCollStats();
    renderCompCollTable(compCollFilteredRows);
}

// 📈 تحديث بطاقات الإحصائيات بناءً على النتائج المفلترة حالياً
function updateCompCollStats() {
    let totalAmount = 0, paidAmount = 0, remainingAmount = 0;
    compCollFilteredRows.forEach(row => {
        totalAmount += row.totalAmount;
        paidAmount += row.paidAmount;
        remainingAmount += row.remainingAmount;
    });

    const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    setText('statCompCollCount', compCollFilteredRows.length);
    setText('statCompCollTotal', formatCompCollCurrency(totalAmount));
    setText('statCompCollPaid', formatCompCollCurrency(paidAmount));
    setText('statCompCollRemaining', formatCompCollCurrency(remainingAmount));
}

// =========================================================================
// 5. بناء جدول التقرير (وضع الشاشة: مع تقسيم صفحات)
// =========================================================================
function renderCompCollTable(data) {
    const tableBody = document.getElementById('compCollTableBody');
    const resultsCountEl = document.getElementById('compCollResultsCount');
    if (!tableBody) return;

    if (resultsCountEl) {
        resultsCountEl.textContent = `عدد النتائج المطابقة: ${data.length}`;
    }

    if (!data || data.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; color:#94a3b8;">لا توجد بيانات مطابقة لخيارات البحث الحالية.</td></tr>`;
        setupCompCollPaginationControls(0);
        return;
    }

    const startIndex = (currentCompCollPage - 1) * compCollRowsPerPage;
    const endIndex = startIndex + compCollRowsPerPage;
    const paginatedData = data.slice(startIndex, endIndex);

    tableBody.innerHTML = paginatedData.map(row => buildCompCollRowHtml(row)).join('');

    setupCompCollPaginationControls(data.length);
}

function getCompCollRateBadgeClass(rate) {
    if (rate === null) return 'comp-coll-rate-none';
    if (rate >= 99.95) return 'comp-coll-rate-full';
    if (rate >= 40) return 'comp-coll-rate-partial';
    return 'comp-coll-rate-low';
}

function buildCompCollRowHtml(row) {
    const hasRemaining = row.remainingAmount > 0.004;
    const remainingClass = hasRemaining ? 'has-remaining' : 'no-remaining';
    const rateLabel = row.collectionRate === null ? '—' : `${row.collectionRate}%`;
    const rateBadgeClass = getCompCollRateBadgeClass(row.collectionRate);

    return `
        <tr>
            <td><strong style="color:#1e293b;">${row.companyName}</strong></td>
            <td style="text-align:center; color:#334155;">${row.invoiceCount}</td>
            <td class="comp-coll-amount-cell" style="text-align:center;">${formatCompCollCurrency(row.totalAmount)}</td>
            <td class="comp-coll-amount-cell" style="text-align:center;">${formatCompCollCurrency(row.paidAmount)}</td>
            <td class="comp-coll-amount-cell comp-coll-remaining-cell ${remainingClass}" style="text-align:center;">${formatCompCollCurrency(row.remainingAmount)}</td>
            <td style="text-align:center;"><span class="comp-coll-rate-badge ${rateBadgeClass}">${rateLabel}</span></td>
            <td style="text-align:center; font-family: monospace;">${row.lastInvoiceDateRaw ? formatCompCollDate(row.lastInvoiceDateRaw) : '—'}</td>
        </tr>
    `;
}

// =========================================================================
// 6. أزرار التنقل بين صفحات التقرير
// =========================================================================
function setupCompCollPaginationControls(totalItems) {
    const controlsContainer = document.getElementById('compCollPagination');
    if (!controlsContainer) return;
    controlsContainer.innerHTML = '';

    const totalPages = Math.ceil(totalItems / compCollRowsPerPage);
    if (totalPages <= 1) return;

    const prevBtn = document.createElement('button');
    prevBtn.innerHTML = '&rarr; السابقة';
    prevBtn.disabled = currentCompCollPage === 1;
    prevBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;';
    if (prevBtn.disabled) prevBtn.style.opacity = '0.5';
    prevBtn.onclick = () => {
        if (currentCompCollPage > 1) {
            currentCompCollPage--;
            renderCompCollTable(compCollFilteredRows);
        }
    };
    controlsContainer.appendChild(prevBtn);

    const countLabel = document.createElement('span');
    countLabel.style.cssText = 'font-size: 0.9rem; color: #475569; font-weight: 600; margin: 0 10px;';
    countLabel.textContent = `صفحة ${currentCompCollPage} من ${totalPages}`;
    controlsContainer.appendChild(countLabel);

    const nextBtn = document.createElement('button');
    nextBtn.innerHTML = 'التالية &larr;';
    nextBtn.disabled = currentCompCollPage === totalPages;
    nextBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;';
    if (nextBtn.disabled) nextBtn.style.opacity = '0.5';
    nextBtn.onclick = () => {
        if (currentCompCollPage < totalPages) {
            currentCompCollPage++;
            renderCompCollTable(compCollFilteredRows);
        }
    };
    controlsContainer.appendChild(nextBtn);
}

// =========================================================================
// 7. تصدير التقرير الكامل (بعد الفلترة) إلى ملف Excel عبر مكتبة SheetJS —
//    يبقى بكل أعمدته السبعة كما هو بلا أي تغيير (التعديل التالي يخص نسخة
//    الطباعة فقط، بناءً على طلب المستخدم صراحة)
// =========================================================================
function exportCompCollReportToExcel() {
    if (!compCollFilteredRows || compCollFilteredRows.length === 0) {
        alert('لا توجد بيانات لتصديرها بناءً على خيارات البحث الحالية.');
        return;
    }

    const headers = ['الشركة', 'عدد الفواتير', 'إجمالي الفواتير', 'المحصَّل', 'المتبقي', 'نسبة التحصيل', 'تاريخ آخر فاتورة'];

    const rows = compCollFilteredRows.map(row => [
        row.companyName,
        row.invoiceCount,
        formatCompCollCurrency(row.totalAmount),
        formatCompCollCurrency(row.paidAmount),
        formatCompCollCurrency(row.remainingAmount),
        row.collectionRate === null ? '—' : `${row.collectionRate}%`,
        row.lastInvoiceDateRaw ? formatCompCollDate(row.lastInvoiceDateRaw) : '—'
    ]);

    const worksheetData = [headers, ...rows];
    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

    worksheet['!cols'] = [
        { wch: 26 }, { wch: 13 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 13 }, { wch: 15 }
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'تحصيل الشركات');

    const now = new Date();
    const dateSuffix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    XLSX.writeFile(workbook, `تقرير_تحصيل_الشركات_${dateSuffix}.xlsx`);
}

// =========================================================================
// 8. طباعة التقرير: نفس تصميم الطباعة الاحترافي المشترك مع بقية تقارير
//    المنصة (ترويسة بالشركة + رمز QR + رقم مستند + جدول بترويسة زرقاء +
//    علامة مائية متكررة + تذييل برقم الصفحة)، عبر buildGenericReportPrintPagesHtml.
//
//    🆕 بناءً على طلب المستخدم صراحة: نسخة الطباعة (ورمز QR) تحديداً —
//    بخلاف جدول الشاشة وتصدير Excel، اللذين يبقيان بكامل أعمدتهما كما كانا —
//    لا تعرض عمودي "عدد الفواتير" و"نسبة التحصيل" (أُبقي عليهما فقط بالشاشة
//    والتصدير)، وتُرتَّب الشركات فيها حسب ارتباطها ببعضها (الشركات التي
//    تشترك بنفس حساب الدخول عبر خيار "ربط هذه الشركة بحساب دخول موجود" تظهر
//    متتالية بجانب بعضها) بدل ترتيبها السابق حسب المبلغ المتبقي.
// =========================================================================
const COMPANIES_COLLECTIONS_REPORT_COLUMNS = [
    { key: 'companyName', label: 'الشركة', align: 'right' },
    { key: 'totalAmount', label: 'إجمالي الفواتير', align: 'center' },
    { key: 'paidAmount', label: 'المحصَّل', align: 'center' },
    { key: 'remainingAmount', label: 'المتبقي', align: 'center' },
    { key: 'lastInvoiceDate', label: 'آخر فاتورة', align: 'center' }
];

// 🔗 يجمّع الشركات التي تشترك بنفس user_id (نفس حساب الدخول) متتالية بعضها
// بجانب بعض بنسخة الطباعة، مع الحفاظ على ترتيب أول ظهور لكل مجموعة كما كان
// بالمصفوفة الأصلية (فرز مستقر بالتجميع، وليس فرزاً أبجدياً/عشوائياً بمعرّف
// الحساب) — نفس الدالة المستخدمة تماماً بتقرير الشركات (companies-report.js).
// الشركات غير المرتبطة بأي حساب مشترك (user_id فارغ) تُعامَل كل واحدة كمجموعة
// مستقلة خاصة بها فقط (مفتاح فريد بمعرّف الشركة) حتى لا تُجمَّع خطأً مع شركات أخرى.
function groupLinkedCompaniesForPrint(rows) {
    const groupOrder = [];
    const groups = new Map();

    rows.forEach(row => {
        const key = row.userId ? `u:${row.userId}` : `single:${row.companyId}`;
        if (!groups.has(key)) {
            groups.set(key, []);
            groupOrder.push(key);
        }
        groups.get(key).push(row);
    });

    return groupOrder.flatMap(key => groups.get(key));
}

async function printCompCollReport() {
    if (!compCollFilteredRows || compCollFilteredRows.length === 0) {
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

    // 🔗 ترتيب خاص بالطباعة فقط: تجميع الشركات المربوطة بنفس حساب الدخول
    // متجاورة بعضها ببعض (بدل الترتيب تنازلياً حسب المبلغ المتبقي كما كان
    // سابقاً) — جدول الشاشة وتصدير Excel يبقيان بترتيبهما الأصلي بلا تغيير
    const sortedForPrint = groupLinkedCompaniesForPrint(compCollFilteredRows);

    const printRows = sortedForPrint.map(row => ({
        companyName: row.companyName,
        totalAmount: formatCompCollCurrency(row.totalAmount),
        paidAmount: formatCompCollCurrency(row.paidAmount),
        remainingAmount: formatCompCollCurrency(row.remainingAmount),
        lastInvoiceDate: row.lastInvoiceDateRaw ? formatCompCollDate(row.lastInvoiceDateRaw) : '—'
    }));

    let qrDataUrl = null;
    try {
        const { data: snapshot, error: snapshotError } = await dbClient
            .from('report_snapshots')
            .insert({
                doc_number: docNumber,
                report_title: 'تقرير تحصيل الشركات',
                report_type: 'company_collections',
                columns: COMPANIES_COLLECTIONS_REPORT_COLUMNS,
                company_name: null,
                show_company_column: false,
                report_date_text: reportDateText,
                rows: printRows
            })
            .select('id')
            .single();

        if (snapshotError) throw snapshotError;

        const viewUrl = `${window.location.origin}${window.location.pathname.replace('companies-collections-report.html', 'view_report.html')}?id=${snapshot.id}`;
        qrDataUrl = await window.PrintReport.generateReportQrDataUrl(viewUrl);
    } catch (error) {
        console.error('تعذّر إنشاء نسخة قابلة للعرض عبر رمز QR (تأكد من تنفيذ سكربت إضافة عمودي report_type/columns لجدول report_snapshots بسوبابيس):', error.message);
    }

    printRoot.innerHTML = window.PrintReport.buildGenericReportPrintPagesHtml({
        docNumber,
        companyLabel: 'بصمة الأعمال',
        subtitleText: 'تقرير تحصيل الشركات',
        reportDateText,
        columns: COMPANIES_COLLECTIONS_REPORT_COLUMNS,
        rows: printRows,
        qrDataUrl
    });

    window.print();
}

window.addEventListener('afterprint', () => {
    const printRoot = document.getElementById('printPagesRoot');
    if (printRoot) printRoot.innerHTML = '';
});
