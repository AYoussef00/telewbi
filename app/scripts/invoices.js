// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================

// حالات الفاتورة: تسميات وأصناف شارات لونية (unpaid: كهرماني، paid: أخضر
// [تُعيد استخدام status-badge-active]، overdue: أحمر [status-badge-inactive])
const INVOICE_STATUS_LABELS_AR = { unpaid: 'غير مدفوعة', paid: 'مدفوعة', overdue: 'متأخرة' };
const INVOICE_STATUS_BADGE_CLASS = { unpaid: 'status-badge-unpaid', paid: 'status-badge-active', overdue: 'status-badge-inactive' };

let localInvoicesCache = [];
let filteredInvoicesCache = [];
let currentInvoicePage = 1;
const invoicesPerPage = 7;

// =========================================================================
// 🛡️ نطاق رؤية المستخدم الحالي: مسؤول الشركة (role='company') يجب أن يرى
// فقط الفواتير الصادرة لشركته/شركاته المملوكة له، وليس كل فواتير كل الشركات
// بالنظام كما كان يحدث سابقاً (كانت هذه الشاشة تجلب كل صفوف جدول invoices
// بلا أي تقييد بمعزل عن الدور). بقية الأدوار (مدير عام النظام...) تبقى بلا
// أي تقييد (companyIds=null يعني "بلا تقييد").
// =========================================================================
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
        console.error('تعذّر تحديد نطاق صلاحيات المستخدم الحالي (الفواتير):', error.message);
    }
}

// =========================================================================
// جلب كامل صفوف جدول ما على دفعات (Pagination) — سوبابيس (PostgREST) يفرض
// حداً افتراضياً 1000 صف كحد أقصى لكل طلب (نفس الحل المعتمد بباقي شاشات المنصة)
// =========================================================================
const INVOICES_FETCH_PAGE_SIZE = 1000;
async function fetchAllRows(builderFactory) {
    let allRows = [];
    let from = 0;
    while (true) {
        const { data, error } = await builderFactory(from, from + INVOICES_FETCH_PAGE_SIZE - 1);
        if (error) throw error;
        allRows = allRows.concat(data || []);
        if (!data || data.length < INVOICES_FETCH_PAGE_SIZE) break;
        from += INVOICES_FETCH_PAGE_SIZE;
    }
    return allRows;
}

document.addEventListener('DOMContentLoaded', async () => {
    const allowed = await Permissions.guardPage('finance_invoices');
    if (!allowed) return;

    const goBtn = document.getElementById('btnGoToIssueInvoice');
    if (goBtn) goBtn.addEventListener('click', () => { window.location.href = Routes.url('add_invoice'); });

    await loadCurrentUserScope();
    fetchAndRenderInvoices();
});

// 💰 تنسيق القيم المالية بمنزلتين عشريتين بأرقام إنجليزية دائماً
function formatInvoiceCurrency(value) {
    const num = parseFloat(value);
    if (isNaN(num)) return '0.00';
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
}

// 📅 تنسيق تاريخ بصيغة DD/MM/YYYY؛ الأعمدة بقاعدة البيانات بصيغة YYYY-MM-DD
function formatInvoiceDate(dateStr) {
    if (!dateStr) return '—';
    const datePart = String(dateStr).split('T')[0];
    const parts = datePart.split('-');
    if (parts.length !== 3) return String(dateStr);
    const [y, m, d] = parts;
    return `${d}/${m}/${y}`;
}

// 🔢 رقم الفاتورة المعروض: INV-<سنة الفاتورة>-<الرقم التسلسلي> مبني على معرّف
// الفاتورة الفعلي بقاعدة البيانات (فريد تلقائياً بلا احتمال تعارض)
function formatInvoiceDisplayNumber(invoiceRow) {
    if (!invoiceRow) return '—';
    const year = invoiceRow.invoice_date ? String(invoiceRow.invoice_date).slice(0, 4) : String(new Date().getFullYear());
    const seq = String(invoiceRow.id).padStart(6, '0');
    return `INV-${year}-${seq}`;
}

// 📊 جلب الفواتير حياً من سوبابيس مع اسم الشركة عبر العلاقة (Foreign Key)
async function fetchAndRenderInvoices() {
    const tableBody = document.getElementById('invoicesTableBody');
    if (!tableBody) return;

    // 🛡️ مسؤول شركة بلا أي شركة مملوكة له (حالة استثنائية) يرى قائمة فارغة
    // فوراً بدل تنفيذ استعلام بلا فائدة
    if (currentUserScope.role === 'company' && currentUserScope.companyIds && currentUserScope.companyIds.length === 0) {
        localInvoicesCache = [];
        filteredInvoicesCache = [];
        currentInvoicePage = 1;
        renderInvoicesTable(filteredInvoicesCache);
        return;
    }

    let invoices;
    try {
        invoices = await fetchAllRows((from, to) => {
            let query = dbClient.from('invoices').select('*, companies(name)')
                .order('created_at', { ascending: false })
                .order('id', { ascending: false })
                .range(from, to);
            // 🛡️ تقييد الاستعلام بشركات مسؤول الشركة الحالي فقط — انظر تعليق
            // currentUserScope أعلى الملف
            if (currentUserScope.role === 'company' && currentUserScope.companyIds) {
                query = query.in('company_id', currentUserScope.companyIds);
            }
            return query;
        });
    } catch (error) {
        console.error('خطأ في الاتصال بقاعدة البيانات:', error.message);
        tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#ef4444; padding:20px;">فشل تحميل قائمة الفواتير. تأكد من إنشاء جدول 'invoices' بقاعدة بيانات سوبابيس.</td></tr>`;
        return;
    }

    localInvoicesCache = invoices;
    filteredInvoicesCache = invoices;
    currentInvoicePage = 1;
    renderInvoicesTable(filteredInvoicesCache);
}

// 📑 بناء صفوف جدول الفواتير
function renderInvoicesTable(data) {
    const tableBody = document.getElementById('invoicesTableBody');
    if (!tableBody) return;
    tableBody.innerHTML = '';

    if (!data || data.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:30px; color:#94a3b8;">لا توجد فواتير مطابقة للبحث.</td></tr>`;
        setupInvoicesPaginationControls(0);
        return;
    }

    const startIndex = (currentInvoicePage - 1) * invoicesPerPage;
    const endIndex = startIndex + invoicesPerPage;
    const paginatedData = data.slice(startIndex, endIndex);

    paginatedData.forEach(invoice => {
        const row = document.createElement('tr');

        const companyName = (invoice.companies && invoice.companies.name) ? invoice.companies.name : '—';
        const status = invoice.status || 'unpaid';
        const statusBadgeClass = INVOICE_STATUS_BADGE_CLASS[status] || 'status-badge-unpaid';
        const statusLabel = INVOICE_STATUS_LABELS_AR[status] || 'غير مدفوعة';

        row.innerHTML = `
            <td class="invoice-number-cell">${formatInvoiceDisplayNumber(invoice)}</td>
            <td><strong>${companyName}</strong></td>
            <td style="color: #475569; font-family: monospace;">${formatInvoiceDate(invoice.invoice_date)}</td>
            <td style="text-align: center; font-family: monospace;">${formatInvoiceCurrency(invoice.total_amount)}</td>
            <td style="text-align: center;"><span class="${statusBadgeClass}">${statusLabel}</span></td>
            <td style="text-align: center;">
                <button class="action-icon-btn" data-perm="view:finance_invoices" title="عرض وطباعة الفاتورة" onclick="viewInvoice('${invoice.id}')">${ICONS.eye}</button>
                ${status !== 'paid' ? `<button class="action-icon-btn" data-perm="edit:finance_invoices" style="color:#059669;" title="تعليم كمدفوعة" onclick="markInvoicePaid('${invoice.id}')">${ICONS['check-circle']}</button>` : ''}
                <button class="action-icon-btn" data-perm="delete:finance_invoices" style="color:#ef4444;" title="حذف الفاتورة" onclick="deleteInvoice('${invoice.id}')">${ICONS.trash}</button>
            </td>
        `;
        tableBody.appendChild(row);
    });

    setupInvoicesPaginationControls(data.length);

    // 🛡️ الأزرار أعلاه (عرض/تعليم كمدفوعة/حذف الصف) بُنيت للتو ديناميكياً وتحمل
    // السمة data-perm — يجب تطبيق حارس الصلاحيات عليها يدوياً هنا لإظهارها فقط
    // لمن يملك الصلاحية المطابقة (تُستدعى هذه الدالة أيضاً بكل إعادة رسم عبر
    // البحث/الفلترة/التنقل بين الصفحات، فتغطي كل حالات إعادة الرسم تلقائياً).
    Permissions.applyButtonGating(tableBody);
}

// 📟 بناء وتحديث أزرار الصفحات
function setupInvoicesPaginationControls(totalItems) {
    const controlsContainer = document.getElementById('invoicesPaginationControls');
    if (!controlsContainer) return;
    controlsContainer.innerHTML = '';

    const totalPages = Math.ceil(totalItems / invoicesPerPage);
    if (totalPages <= 1) return;

    const prevBtn = document.createElement('button');
    prevBtn.innerHTML = '&rarr; السابقة';
    prevBtn.disabled = currentInvoicePage === 1;
    prevBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;';
    if (prevBtn.disabled) prevBtn.style.opacity = '0.5';
    prevBtn.onclick = () => {
        if (currentInvoicePage > 1) {
            currentInvoicePage--;
            renderInvoicesTable(filteredInvoicesCache);
        }
    };
    controlsContainer.appendChild(prevBtn);

    const countLabel = document.createElement('span');
    countLabel.style.cssText = 'font-size: 0.9rem; color: #475569; font-weight: 600; font-family: system-ui, sans-serif;';
    countLabel.textContent = `صفحة ${currentInvoicePage} من ${totalPages}`;
    controlsContainer.appendChild(countLabel);

    const nextBtn = document.createElement('button');
    nextBtn.innerHTML = 'التالية &larr;';
    nextBtn.disabled = currentInvoicePage === totalPages;
    nextBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;';
    if (nextBtn.disabled) nextBtn.style.opacity = '0.5';
    nextBtn.onclick = () => {
        if (currentInvoicePage < totalPages) {
            currentInvoicePage++;
            renderInvoicesTable(filteredInvoicesCache);
        }
    };
    controlsContainer.appendChild(nextBtn);
}

// 🔍 دالة البحث: تجمع البحث النصي الحر (اسم الشركة أو رقم الفاتورة المعروض)
// مع فلتر الحالة
function searchInvoices() {
    const text = (document.getElementById('invoiceSearchInput').value || '').toLowerCase().trim();
    const statusValue = document.getElementById('invoiceStatusFilter').value || 'all';

    filteredInvoicesCache = localInvoicesCache.filter(invoice => {
        const companyName = (invoice.companies && invoice.companies.name) ? invoice.companies.name.toLowerCase() : '';
        const displayNumber = formatInvoiceDisplayNumber(invoice).toLowerCase();
        const matchesText = !text || companyName.includes(text) || displayNumber.includes(text);

        const status = invoice.status || 'unpaid';
        const matchesStatus = statusValue === 'all' || status === statusValue;

        return matchesText && matchesStatus;
    });

    currentInvoicePage = 1;
    renderInvoicesTable(filteredInvoicesCache);
}

// 👁️ الانتقال لصفحة عرض/طباعة الفاتورة الكاملة
function viewInvoice(id) {
    window.location.href = (Routes.url('view_invoice') + '?id=') + encodeURIComponent(id);
}

// ✅ تعليم الفاتورة كمدفوعة مباشرة من الجدول (اختصار سريع بدل فتح صفحة العرض)
async function markInvoicePaid(id) {
    // 🛡️ دفاع بعمق: الزر المؤدي لهذه الدالة مخفي أصلاً عمن لا يملك صلاحية
    // "edit:finance_invoices" (data-perm)، لكن هذه دالة عامة (global) يمكن
    // استدعاؤها مباشرة من أدوات المطوّر بالمتصفح بمعزل عن ظهور الزر — هذا
    // التحقق يمنع تنفيذ العملية فعلياً حتى لو استُدعيت الدالة مباشرة.
    if (!Permissions.can('edit', 'finance_invoices')) {
        alert('ليست لديك صلاحية تعليم الفواتير كمدفوعة.');
        return;
    }
    if (!confirm('هل تريد تعليم هذه الفاتورة كمدفوعة؟')) return;
    try {
        const { data: updatedRows, error } = await dbClient
            .from('invoices')
            .update({ status: 'paid' })
            .eq('id', id)
            .select();
        if (error) throw error;
        if (!updatedRows || updatedRows.length === 0) {
            alert('لم يتم تحديث حالة الفاتورة فعلياً. تحقق من وجود سياسة تعديل (RLS UPDATE Policy) على جدول invoices في سوبابيس.');
            return;
        }
        await fetchAndRenderInvoices();
    } catch (error) {
        alert('فشلت العملية: ' + error.message);
    }
}

// 🗑️ حذف فاتورة نهائياً بعد تأكيد المستخدم
async function deleteInvoice(id) {
    // 🛡️ دفاع بعمق — انظر تعليق نفس الفحص أعلى markInvoicePaid
    if (!Permissions.can('delete', 'finance_invoices')) {
        alert('ليست لديك صلاحية حذف الفواتير.');
        return;
    }
    if (!confirm('هل أنت متأكد من حذف هذه الفاتورة نهائياً؟ لا يمكن التراجع عن هذا الإجراء.')) return;

    try {
        const { data: deletedRows, error } = await dbClient
            .from('invoices')
            .delete()
            .eq('id', id)
            .select();

        if (error) throw error;

        if (!deletedRows || deletedRows.length === 0) {
            alert('لم يتم حذف الفاتورة فعلياً. تحقق من وجود سياسة حذف (RLS DELETE Policy) على جدول invoices في سوبابيس.');
            return;
        }

        await fetchAndRenderInvoices();
    } catch (error) {
        console.error('Error deleting invoice:', error);
        alert('فشل الحذف: ' + error.message);
    }
}