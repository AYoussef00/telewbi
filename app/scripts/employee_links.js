// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================

let localLinksCache = [];
let filteredLinksCache = [];

// Pagination Settings
let currentLinkPage = 1;
const linksPerPage = 7;

// 📅 تاريخ اليوم بصيغة YYYY-MM-DD حسب توقيت جهاز المستخدم — يُستخدم لتقييد جلب
// جدول هذه الشاشة على الروابط النشطة فقط (بلا تاريخ انتهاء، أو لم يأتِ تاريخ
// انتهائها بعد). ⚠️ ضروري بعد أن أصبح "إنهاء ربط موظف" يُسجِّل تاريخ انتهاء بدل
// حذف السجل فعلياً: بدون هذا الفلتر ستبقى الروابط المُنهاة ظاهرة هنا أيضاً —
// وهذه الشاشة مخصصة لإدارة الروابط النشطة (إضافة/تعديل/حذف)، وليست أرشيفاً؛
// سجل الإنهاءات السابقة له شاشته المستقلة "إنهاء ربط موظف".
function getTodayDateStringForLinks() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

document.addEventListener('DOMContentLoaded', async () => {
    const allowed = await Permissions.guardPage('employee_links');
    if (!allowed) return;

    const addBtn = document.getElementById('btnAddEmployeeLink');
    if (addBtn) addBtn.addEventListener('click', () => { window.location.href = Routes.url('link_employee'); });

    // القوائم الثلاث القابلة للبحث: تُبنى مرة واحدة، وتقرأ القيم المتاحة حياً من
    // localLinksCache في كل مرة يُفتح فيها الاقتراح (دون الحاجة لإعادة تعبئتها يدوياً)
    setupFilterSearchCombo({
        inputId: 'linkEmployeeNameSearch',
        dropdownId: 'linkEmployeeNameDropdown',
        emptyText: 'لا يوجد موظفون مطابقون',
        getOptions: () => distinctSorted(localLinksCache.map(l => l.employees && l.employees.name))
    });

    setupFilterSearchCombo({
        inputId: 'linkNationalIdSearch',
        dropdownId: 'linkNationalIdDropdown',
        emptyText: 'لا توجد أرقام هوية مطابقة',
        getOptions: () => distinctSorted(localLinksCache.map(l => l.employees && l.employees.national_id))
    });

    setupFilterSearchCombo({
        inputId: 'linkCompanySearch',
        dropdownId: 'linkCompanyDropdown',
        emptyText: 'لا توجد شركات مطابقة',
        getOptions: () => distinctSorted(localLinksCache.map(l => l.companies && l.companies.name))
    });

    const typeFilter = document.getElementById('linkTypeFilter');
    if (typeFilter) typeFilter.addEventListener('change', applyLinkFilters);

    fetchAndRenderEmployeeLinks();
});

// 📚 استخراج قيم فريدة (غير فارغة) ومرتّبة أبجدياً من مصفوفة، تُستخدم لتغذية اقتراحات البحث
function distinctSorted(values) {
    return Array.from(new Set((values || []).filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b), 'ar'));
}

// =========================================================================
// 2. مكوّن "قائمة قابلة للبحث" لخانات التصفية (اكتب لتصفية الاقتراحات + تصفية
//    الجدول فورياً معاً بنفس حرف الكتابة، مطابقةً لتجربة البحث بشاشة الموظفين)
// =========================================================================
function setupFilterSearchCombo({ inputId, dropdownId, getOptions, emptyText }) {
    const input = document.getElementById(inputId);
    const dropdown = document.getElementById(dropdownId);
    if (!input || !dropdown) return;

    function renderSuggestions(query) {
        const options = getOptions();
        const normalized = (query || '').trim().toLowerCase();
        const matches = normalized
            ? options.filter(v => String(v).toLowerCase().includes(normalized))
            : options;

        dropdown.innerHTML = '';

        // اقتراح ثابت أعلى القائمة لمسح هذا الحقل تحديداً والعودة لعرض الكل
        const clearItem = document.createElement('div');
        clearItem.className = 'combo-item combo-item-clear';
        clearItem.textContent = '✕ إلغاء هذا الفلتر';
        clearItem.addEventListener('mousedown', (e) => {
            e.preventDefault();
            input.value = '';
            closeDropdown();
            applyLinkFilters();
        });
        dropdown.appendChild(clearItem);

        if (matches.length === 0) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'combo-empty';
            emptyEl.textContent = emptyText || 'لا توجد نتائج مطابقة';
            dropdown.appendChild(emptyEl);
            return;
        }

        matches.slice(0, 30).forEach(value => {
            const item = document.createElement('div');
            item.className = 'combo-item';
            if (input.value.trim() === String(value)) item.classList.add('selected');
            item.textContent = value;
            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                input.value = value;
                closeDropdown();
                applyLinkFilters();
            });
            dropdown.appendChild(item);
        });
    }

    function openDropdown() {
        renderSuggestions(input.value);
        dropdown.classList.add('open');
    }
    function closeDropdown() { dropdown.classList.remove('open'); }

    input.addEventListener('focus', openDropdown);
    input.addEventListener('input', () => {
        renderSuggestions(input.value);
        dropdown.classList.add('open');
        applyLinkFilters(); // تصفية الجدول فورياً أثناء الكتابة، وليس فقط عند اختيار اقتراح
    });
    input.addEventListener('blur', () => setTimeout(closeDropdown, 150));
    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !dropdown.contains(e.target)) closeDropdown();
    });
}

// 📊 دالة جلب سجلات الربط حياً من سوبابيس مع أسماء الموظف والشركة عبر العلاقات (Foreign Keys)
// نجلب أيضاً رقم هوية الموظف (national_id) لدعم البحث به
//
// ⚠️ روابط نشطة فقط (بلا تاريخ انتهاء، أو لم يأتِ تاريخ انتهائها بعد) — انظر
// تعليق getTodayDateStringForLinks أعلى الملف.
async function fetchAndRenderEmployeeLinks() {
    const tableBody = document.getElementById('employeeLinksTableBody');
    if (!tableBody) return;

    const { data, error } = await dbClient
        .from('employee_links')
        .select('*, employees(name, national_id), companies(name)')
        .or(`link_end_date.is.null,link_end_date.gte.${getTodayDateStringForLinks()}`)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('خطأ في الاتصال بقاعدة البيانات:', error.message);
        tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:#ef4444; padding:20px;">فشل تحميل قائمة الموظفين المرتبطين.</td></tr>`;
        return;
    }

    localLinksCache = data || [];
    applyLinkFilters();
}

// 💰 تنسيق القيم المالية بمنزلتين عشريتين بأرقام إنجليزية (1234...) دائماً،
// بغض النظر عن لغة واجهة المتصفح — نستخدم locale 'en-US' صراحةً بدل الاعتماد
// على 'ar-SA' حتى لا تتأثر الأرقام بأي تغييرات مستقبلية بإعدادات النظام.
function formatCurrencyValue(value) {
    if (value === null || value === undefined || value === '') return '—';
    const num = parseFloat(value);
    if (isNaN(num)) return '—';
    return new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(num);
}

// 📅 تنسيق تاريخ الربط بصيغة DD/MM/YYYY بأرقام إنجليزية دائماً (نفس اتفاقية عرض
// الأرقام المعتمدة بباقي الشاشة)؛ عمود link_date بقاعدة البيانات بصيغة YYYY-MM-DD
function formatLinkDate(dateStr) {
    if (!dateStr) return '—';
    const parts = String(dateStr).split('-');
    if (parts.length !== 3) return String(dateStr);
    const [y, m, d] = parts;
    return `${d}/${m}/${y}`;
}

// 📑 بناء أسطر جدول سجلات الربط
// 🆕 عمود "الموظف": الاسم + اسم الشركة بسطر ثانوي رمادي تحته (.report-subtext
// بملف employees.css)، بدل عمود "الشركة" المنفصل السابق. عمود "تاريخ الربط":
// تاريخ الربط وتاريخ الانتهاء معاً بسطر واحد مفصولين بـ"-"، بدل عمود "تاريخ
// الانتهاء" المنفصل.
function renderEmployeeLinksTable(data) {
    const tableBody = document.getElementById('employeeLinksTableBody');
    if (!tableBody) return;

    if (!data || data.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:30px; color:#94a3b8;">لا يوجد موظفون مرتبطون مطابقون لخيارات البحث.</td></tr>`;
        setupLinkPaginationControls(0);
        return;
    }

    const startIndex = (currentLinkPage - 1) * linksPerPage;
    const endIndex = startIndex + linksPerPage;
    const paginatedData = data.slice(startIndex, endIndex);

    tableBody.innerHTML = '';

    paginatedData.forEach(link => {
        const row = document.createElement('tr');

        const employeeName = (link.employees && link.employees.name) ? link.employees.name : '----';
        const companyName = (link.companies && link.companies.name) ? link.companies.name : '----';
        const isAddition = link.link_type === 'اضافة';
        const typeBadgeClass = isAddition ? 'status-badge-active' : 'status-badge-inactive';

        // 🆕 حالة الربط: "تم التعيين" (أخضر) أو "قيد المعالجة" (كهرماني) — الافتراضي
        // "تم التعيين" للسجلات القديمة قبل إضافة هذا الحقل. عند "قيد المعالجة" نضع
        // الملاحظة (إن وجدت) كـ tooltip عبر title بدل إضافة عمود مستقل لها بالجدول.
        const linkStatus = link.link_status || 'تم التعيين';
        const isPendingStatus = linkStatus === 'قيد المعالجة';
        const statusBadgeClass = isPendingStatus ? 'status-badge-pending' : 'status-badge-active';
        const statusTitleAttr = (isPendingStatus && link.link_status_note)
            ? ` title="${String(link.link_status_note).replace(/"/g, '&quot;')}"`
            : '';

        row.innerHTML = `
            <td>
                <strong style="color: #1e293b;">${employeeName}</strong>
                <div class="report-subtext">${companyName}</div>
            </td>
            <td style="font-weight: 500; color: #334155;">${link.job_title || '----'}</td>
            <td style="text-align: center;"><span class="${typeBadgeClass}">${link.link_type || '----'}</span></td>
            <td style="text-align: center; white-space: nowrap;"><span class="${statusBadgeClass} badge-compact" style="white-space:nowrap; font-size:0.72rem; padding:3px 9px;"${statusTitleAttr}>${linkStatus}</span></td>
            <td style="text-align: center; font-family: monospace; font-size: 12px; white-space: nowrap;">${formatLinkDate(link.link_date)} - ${formatLinkDate(link.link_end_date)}</td>
            <td style="text-align: center; font-family: monospace;">${formatCurrencyValue(link.subscription_value)}</td>
            <td style="text-align: center; font-family: monospace;">${link.net_salary_value != null ? formatCurrencyValue(link.net_salary_value) : '—'}</td>
            <td style="text-align: center;">
                <button class="action-icon-btn" data-perm="view:employee_links" title="عرض بيانات الربط" onclick="viewEmployeeLink('${link.id}')" style="cursor:pointer; background:none; border:none; margin: 0 4px;">${ICONS.eye}</button>
                <button class="action-icon-btn" data-perm="edit:employee_links" title="تعديل بيانات الربط" onclick="editEmployeeLink('${link.id}')" style="cursor:pointer; background:none; border:none; margin: 0 4px;">${ICONS.edit}</button>
                <button class="action-icon-btn" data-perm="delete:employee_links" style="color:#ef4444;" title="حذف الربط" onclick="deleteEmployeeLink('${link.id}')">${ICONS.trash}</button>
            </td>
        `;
        tableBody.appendChild(row);
    });

    Permissions.applyButtonGating(tableBody);

    setupLinkPaginationControls(data.length);
}

// 👁️ الانتقال لصفحة استعراض بيانات الربط الكاملة (view_employee_link.html)
function viewEmployeeLink(id) {
    window.location.href = (Routes.url('view_employee_link') + '?id=') + encodeURIComponent(id);
}

// 📝 الانتقال لصفحة تعديل بيانات الربط الكاملة (edit_employee_link.html)
function editEmployeeLink(id) {
    window.location.href = (Routes.url('edit_employee_link') + '?id=') + encodeURIComponent(id);
}

// 🔍 دالة التصفية: تجمع البحث النصي الحر (اسم الموظف / رقم الهوية / اسم الشركة) في
//     ثلاث خانات مستقلة، مع فلتر نوع الربط
function applyLinkFilters() {
    const nameText = (document.getElementById('linkEmployeeNameSearch')?.value || '').toLowerCase().trim();
    const nationalIdText = (document.getElementById('linkNationalIdSearch')?.value || '').toLowerCase().trim();
    const companyText = (document.getElementById('linkCompanySearch')?.value || '').toLowerCase().trim();
    const typeValue = document.getElementById('linkTypeFilter')?.value || 'all';

    filteredLinksCache = localLinksCache.filter(link => {
        const employeeName = (link.employees && link.employees.name) ? link.employees.name.toLowerCase() : '';
        const nationalId = (link.employees && link.employees.national_id) ? String(link.employees.national_id).toLowerCase() : '';
        const companyName = (link.companies && link.companies.name) ? link.companies.name.toLowerCase() : '';

        const matchesName = !nameText || employeeName.includes(nameText);
        const matchesNationalId = !nationalIdText || nationalId.includes(nationalIdText);
        const matchesCompany = !companyText || companyName.includes(companyText);
        const matchesType = typeValue === 'all' || link.link_type === typeValue;

        return matchesName && matchesNationalId && matchesCompany && matchesType;
    });

    currentLinkPage = 1;
    renderEmployeeLinksTable(filteredLinksCache);
}

// 📟 بناء عداد التنقل بين صفحات سجلات الربط أسفل الجدول
function setupLinkPaginationControls(totalItems) {
    const controlsContainer = document.getElementById('employeeLinksPagination');
    if (!controlsContainer) return;
    controlsContainer.innerHTML = '';

    const totalPages = Math.ceil(totalItems / linksPerPage);
    if (totalPages <= 1) return;

    const prevBtn = document.createElement('button');
    prevBtn.innerHTML = '&rarr; السابقة';
    prevBtn.disabled = currentLinkPage === 1;
    prevBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;';
    if (prevBtn.disabled) prevBtn.style.opacity = '0.5';
    prevBtn.onclick = () => {
        if (currentLinkPage > 1) {
            currentLinkPage--;
            renderEmployeeLinksTable(filteredLinksCache);
        }
    };
    controlsContainer.appendChild(prevBtn);

    const countLabel = document.createElement('span');
    countLabel.style.cssText = 'font-size: 0.9rem; color: #475569; font-weight: 600; font-family: system-ui, sans-serif; margin: 0 10px;';
    countLabel.textContent = `صفحة ${currentLinkPage} من ${totalPages}`;
    controlsContainer.appendChild(countLabel);

    const nextBtn = document.createElement('button');
    nextBtn.innerHTML = 'التالية &larr;';
    nextBtn.disabled = currentLinkPage === totalPages;
    nextBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;';
    if (nextBtn.disabled) nextBtn.style.opacity = '0.5';
    nextBtn.onclick = () => {
        if (currentLinkPage < totalPages) {
            currentLinkPage++;
            renderEmployeeLinksTable(filteredLinksCache);
        }
    };
    controlsContainer.appendChild(nextBtn);
}

// 🗑️ دالة حذف سجل ربط موظف بشركة (لا تحذف الموظف نفسه، فقط علاقة الربط) —
// حذف نهائي فعلي (وليس تسجيل تاريخ انتهاء)، مخصص لتصحيح أخطاء إدخال الربط
// نفسه من هذه الشاشة الإدارية؛ يبقى منفصلاً عن ميزة "إنهاء ربط موظف" (التي
// تُسجِّل تاريخ انتهاء فقط للحفاظ على سجل تحصيله/حضوره التاريخي).
// عند الحذف، تُعاد حالة الموظف تلقائياً إلى "غير نشط" (الحالة تتبع نشاط الربط
// تلقائياً — كما تُصبح "نشط" تلقائياً عند إنشاء الربط من شاشة "ربط موظف").
async function deleteEmployeeLink(id) {
    if (!confirm('هل أنت متأكد من حذف هذا الربط؟')) return;

    // نحتفظ بمعرّف الموظف المرتبط قبل الحذف من الذاكرة المحلية (localLinksCache)
    // حتى نتمكن من إعادة تعيين حالته بعد إزالة الربط مباشرة.
    const linkRecord = localLinksCache.find(l => String(l.id) === String(id));
    const relatedEmployeeId = linkRecord ? linkRecord.employee_id : null;

    try {
        const { error } = await dbClient.from('employee_links').delete().eq('id', id);
        if (error) throw error;

        if (relatedEmployeeId != null) {
            const { error: statusUpdateError } = await dbClient
                .from('employees')
                .update({ status: 'inactive' })
                .eq('id', relatedEmployeeId);

            if (statusUpdateError) {
                console.error('تعذّر إعادة تعيين حالة الموظف بعد حذف الربط:', statusUpdateError.message);
            }
        }

        await fetchAndRenderEmployeeLinks();
    } catch (err) {
        alert('فشلت العملية: ' + err.message);
    }
}
