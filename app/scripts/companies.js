let localCompaniesCache = [];
let filteredCompaniesCache = []; // حفظ نتائج البحث الحالية لمزامنة الصفحات بشكل صحيح
// 📊 إعدادات تقسيم الصفحات (15 سطراً لكل صفحة)
let currentPage = 1;
const rowsPerPage = 15;

// =========================================================================
// جلب كامل صفوف جدول ما على دفعات (Pagination) — سوبابيس (PostgREST) يفرض
// حداً افتراضياً 1000 صف كحد أقصى لكل طلب، وأي طلب select('*') بلا .range()
// صريح كان يُقتطع صامتاً عند تجاوز هذا الحد فلا تظهر كل البيانات بالجدول
// (نفس المشكلة التي أُصلحت بتقارير الحضور/المهام/الموظفين/الشركات وشاشة إدارة
// الحضور والانصراف). builderFactory(from, to) يجب أن يُعيد استعلام سوبابيس
// جاهزاً (Promise) مع .range(from, to) مُطبّق عليه بالفعل.
// =========================================================================
const COMPANIES_FETCH_PAGE_SIZE = 1000;

async function fetchAllRows(builderFactory) {
    let allRows = [];
    let from = 0;

    while (true) {
        const { data, error } = await builderFactory(from, from + COMPANIES_FETCH_PAGE_SIZE - 1);
        if (error) throw error;

        allRows = allRows.concat(data || []);

        if (!data || data.length < COMPANIES_FETCH_PAGE_SIZE) break; // آخر صفحة
        from += COMPANIES_FETCH_PAGE_SIZE;
    }

    return allRows;
}

// companies.js
document.addEventListener("DOMContentLoaded", async () => {
    const allowed = await Permissions.guardPage('companies');
    if (!allowed) return;

    // Fail-safe: Wait for dbClient to exist globally before executing
    if (window.dbClient || typeof dbClient !== 'undefined') {
        fetchAndRenderCompanies();
    } else {
        const waitForClient = setInterval(() => {
            if (window.dbClient || typeof dbClient !== 'undefined') {
                clearInterval(waitForClient);
                fetchAndRenderCompanies();
            }
        }, 30); // Checks every 30ms until app-core.js is active
    }
});

// 💰 تنسيق القيم المالية بمنزلتين عشريتين بأرقام إنجليزية دائماً
function formatCurrencyValue(value) {
    if (value === null || value === undefined || value === '') return null;
    const num = parseFloat(value);
    if (isNaN(num)) return null;
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
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

// 📊 دالة جلب الشركات حياً من سوبابيس (على دفعات — انظر fetchAllRows أعلاه)
async function fetchAndRenderCompanies() {
    const tableBody = document.getElementById('companiesTableBody');
    if (!tableBody) return;

    let companies;
    try {
        companies = await fetchAllRows((from, to) =>
            dbClient.from('companies').select('*')
                .order('created_at', { ascending: false })
                .order('id', { ascending: false }) // ترتيب ثانوي حاسم لضمان تسلسل صفحات ثابت بلا تكرار أو نقص
                .range(from, to)
        );
    } catch (error) {
        console.error("خطأ في الاتصال بقاعدة البيانات:", error.message);
        tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:#ef4444; padding:20px;">فشل تحميل البيانات.</td></tr>`;
        return;
    }

    localCompaniesCache = companies;
    filteredCompaniesCache = companies; // المزامنة المبدئية للبيانات
    currentPage = 1; // العودة للصفحة الأولى دائماً عند التحديث

    renderCompaniesTable(filteredCompaniesCache);
}

// 📑 بناء الخلايا والصفوف وتلوين أول الكلمات تلقائياً مع تفعيل أقصى حد 15 صفاً
function renderCompaniesTable(data) {
    const tableBody = document.getElementById('companiesTableBody');
    if (!tableBody) return;
    if (window.RowActions) RowActions.closeMenu();
    tableBody.innerHTML = '';

    if (data.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:30px; color:#94a3b8;">لا توجد شركات مطابقة للبحث.</td></tr>`;
        setupPaginationControls(0);
        return;
    }

    // ✂️ حساب وحصر الأسطر لعرض 15 فقط بناءً على الصفحة النشطة
    const startIndex = (currentPage - 1) * rowsPerPage;
    const endIndex = startIndex + rowsPerPage;
    const paginatedData = data.slice(startIndex, endIndex);

    paginatedData.forEach(company => {
        const row = document.createElement('tr');

        const words = (company.name || '').trim().split(' ');
        const firstWord = words[0] || '';
        const restOfName = words.slice(1).join(' ');

        const idNumericFallback = typeof company.id === 'number'
            ? company.id
            : [...String(company.id)].reduce((acc, char) => acc + char.charCodeAt(0), 0);

        let prefixColorClass = 'prefix-blue';
        if (idNumericFallback % 2 === 0) prefixColorClass = 'prefix-yellow';
        if (idNumericFallback % 3 === 0) prefixColorClass = 'prefix-orange';

        const establishmentId = company.establishment_national_id || '—';
        const authorizedPersonPhone = company.authorized_person_phone || '—';
        const contractTypeDisplay = company.contract_type || '—';
        const contractDateDisplay = formatDisplayDate(company.contract_date) || '—';
        const subscriptionValueDisplay = formatCurrencyValue(company.subscription_value);
        const subscriptionValueText = subscriptionValueDisplay
            ? subscriptionValueDisplay + (company.vat_included ? ' (شامل الضريبة)' : '')
            : '—';

        // حالة الشركة (نشط/غير نشط) — تُعتبر "نشط" افتراضياً للسجلات القديمة التي
        // أُنشئت قبل إضافة هذا الحقل ولا تحمل قيمة status بعد
        const isActiveStatus = (company.status || 'active') === 'active';
        const statusBadgeClass = isActiveStatus ? 'status-badge-active' : 'status-badge-inactive';
        const statusLabel = isActiveStatus ? 'نشط' : 'غير نشط';

        row.innerHTML = `
            <td>
                <span class="company-prefix ${prefixColorClass}">${firstWord}</span>
                <strong>${restOfName}</strong>
            </td>
            <td style="color: #475569; font-family: monospace;">${establishmentId}</td>
            <td style="color: #475569; font-family: monospace; direction: ltr; text-align: right;">${authorizedPersonPhone}</td>
            <td style="color: #475569;">${contractTypeDisplay}</td>
            <td style="color: #475569;">${contractDateDisplay}</td>
            <td style="color: #475569; font-family: monospace;">${subscriptionValueText}</td>
            <td style="text-align: center;"><span class="${statusBadgeClass}">${statusLabel}</span></td>
            <td style="text-align: center;"><div class="ra-actions-cell">${RowActions.viewBtnHtml('view:companies', 'عرض بيانات الشركة')}${RowActions.moreBtnHtml('edit:companies,delete:companies')}</div></td>
        `;

        // الصف كله قابل للنقر لعرض بيانات الشركة؛ أيقونة العين تفعل نفس الشيء،
        // وقائمة الثلاث نقاط (⋮) تضم تعديل بيانات الشركة وحذفها (انظر row-actions.js)
        RowActions.bindRow(row, {
            rowTitle: 'عرض بيانات الشركة',
            onView: () => viewCompany(company.id),
            getMenuItems: () => [
                { perm: 'edit:companies', icon: ICONS.edit, label: 'تعديل بيانات الشركة', run: () => editCompany(company.id) },
                { divider: true, perm: 'delete:companies' },
                { perm: 'delete:companies', icon: ICONS.trash, label: 'حذف الشركة', danger: true, run: () => deleteCompany(company.id) }
            ]
        });

        tableBody.appendChild(row);
    });

    // 📟 تحديث لوحة التحكم بالصفحات بالأسفل تلقائياً
    setupPaginationControls(data.length);

    // 🛡️ العناصر أعلاه (أزرار عرض والثلاث نقاط بالصف) بُنيت للتو ديناميكياً وتحمل
    // السمة data-perm — يجب تطبيق حارس الصلاحيات عليها يدوياً هنا لإظهارها فقط لمن
    // يملك الصلاحية المطابقة (تُستدعى هذه الدالة أيضاً بكل إعادة رسم عبر البحث/
    // الفلترة/التنقل بين الصفحات، فتغطي كل حالات إعادة الرسم تلقائياً).
    Permissions.applyButtonGating(tableBody);
}

// 📟 بناء وتحديث أزرار الصفحات وعرض الإجمالي والعد الحالي حياً بالأسفل
function setupPaginationControls(totalItems) {
    const controlsContainer = document.getElementById('paginationControls');
    if (!controlsContainer) return;
    controlsContainer.innerHTML = '';

    const totalPages = Math.ceil(totalItems / rowsPerPage);
    if (totalPages <= 1) return; // إخفاء عناصر التحكم إن كان الإجمالي أقل من أو يساوي 15 صفاً

    const isEnglish = document.documentElement.getAttribute('lang') === 'en';

    // 1. زر الانتقال للصفحة السابقة
    const prevBtn = document.createElement('button');
    prevBtn.innerHTML = isEnglish ? '&larr; Prev' : '&rarr; السابقة';
    prevBtn.className = 'pagination-btn';
    prevBtn.disabled = currentPage === 1;
    prevBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;';
    if (prevBtn.disabled) prevBtn.style.opacity = '0.5';
    prevBtn.onclick = () => {
        if (currentPage > 1) {
            currentPage--;
            renderCompaniesTable(filteredCompaniesCache);
        }
    };
    controlsContainer.appendChild(prevBtn);

    // 2. نص العداد الرقمي لعرض الصفحة الحالية من إجمالي الصفحات (مثل: صفحة 1 من 4)
    const countLabel = document.createElement('span');
    countLabel.style.cssText = 'font-size: 0.9rem; color: #475569; font-weight: 600; font-family: system-ui, sans-serif;';
    countLabel.textContent = isEnglish
        ? `Page ${currentPage} of ${totalPages}`
        : `صفحة ${currentPage} من ${totalPages}`;
    controlsContainer.appendChild(countLabel);

    // 3. زر الانتقال للصفحة التالية
    const nextBtn = document.createElement('button');
    nextBtn.innerHTML = isEnglish ? 'Next &rarr;' : 'التالية &larr;';
    nextBtn.className = 'pagination-btn';
    nextBtn.disabled = currentPage === totalPages;
    nextBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;';
    if (nextBtn.disabled) nextBtn.style.opacity = '0.5';
    nextBtn.onclick = () => {
        if (currentPage < totalPages) {
            currentPage++;
            renderCompaniesTable(filteredCompaniesCache);
        }
    };
    controlsContainer.appendChild(nextBtn);
}

// 🔍 دالة البحث الفوري داخل جدول الشركات مع إعادة تعيين معايير التقسيم
// تجمع البحث النصي الحر مع فلتر الحالة (نشط/غير نشط) معاً
function searchCompanies() {
    const text = document.getElementById('companySearchInput').value.toLowerCase();
    const statusFilterEl = document.getElementById('statusFilter');
    const statusValue = statusFilterEl ? statusFilterEl.value : 'all';

    // فلترة السجلات المخبأة محلياً بناءً على حقول الاسم أو البريد أو رقم هوية المنشأة، مع فلتر الحالة
    filteredCompaniesCache = localCompaniesCache.filter(c => {
        const matchesText = (c.name && c.name.toLowerCase().includes(text))
            || (c.email && c.email.toLowerCase().includes(text))
            || (c.establishment_national_id && c.establishment_national_id.toLowerCase().includes(text));

        const companyStatus = c.status || 'active';
        const matchesStatus = statusValue === 'all' || companyStatus === statusValue;

        return matchesText && matchesStatus;
    });

    currentPage = 1; // العودة للصفحة الأولى دائماً عند تفعيل فلتر بحث جديد لضمان تكامل العرض
    renderCompaniesTable(filteredCompaniesCache);
}

// ➕ زر "+ إضافة شركة" الرئيسي العلوي ينقل الآن لصفحة مستقلة كاملة (add_company.html)
// بدل فتح نافذة منبثقة، لتطابق نفس أسلوب إضافة موظف (صفحة وليس Modal).
const addCompanyBtn = document.querySelector('.btn-add-company');
if (addCompanyBtn) {
    addCompanyBtn.addEventListener('click', () => {
        window.location.href = Routes.url('add_company');
    });
}

// 📝 دالة الانتقال لصفحة تعديل بيانات الشركة الكاملة (edit_company.html)
function editCompany(id) {
    window.location.href = (Routes.url('edit_company') + '?id=') + encodeURIComponent(id);
}

// 🗑️ دالة حذف الشركة نهائياً من قاعدة البيانات بعد تأكيد المستخدم
async function deleteCompany(id) {
    const isEnglish = document.documentElement.getAttribute('lang') === 'en';

    try {
        // 0. فحص مسبق: هل يوجد موظفون مرتبطون بهذه الشركة؟ نمنع الحذف فوراً
        //    برسالة واضحة بدل محاولة الحذف والاصطدام بخطأ قيد مفتاح أجنبي غامض.
        const { data: linkedEmployees, error: linkCheckError } = await dbClient
            .from('employees')
            .select('id', { count: 'exact' })
            .eq('company_id', id);

        if (linkCheckError) throw linkCheckError;

        const linkedCount = linkedEmployees ? linkedEmployees.length : 0;
        if (linkedCount > 0) {
            alert(isEnglish
                ? `This company cannot be deleted because ${linkedCount} employee(s) are still linked to it. Please reassign or delete those employees first.`
                : `لا يمكن حذف هذه الشركة لأنها مرتبطة بـ ${linkedCount} موظف/موظفين حالياً. الرجاء نقل هؤلاء الموظفين لشركة أخرى أو حذفهم أولاً من صفحة الموظفين.`);
            return;
        }
    } catch (error) {
        console.error("Error checking linked employees before delete:", error);
        const rawMsg = error && (error.message || error.details || error.hint);
        alert((isEnglish ? "Could not verify linked employees: " : "تعذّر التحقق من الموظفين المرتبطين: ") + (rawMsg || (isEnglish ? 'Unknown error' : 'خطأ غير معروف')));
        return;
    }

    const confirmMessage = isEnglish
        ? "Are you sure you want to completely delete this company?"
        : "هل أنت متأكد من رغبتك في حذف هذه الشركة نهائياً؟";

    if (!confirm(confirmMessage)) return;

    try {
        // نطلب .select() على الحذف حتى نعرف بالضبط هل تم حذف أي سجل فعلياً؛
        // فبعض إعدادات RLS بسوبابيس تمنع الحذف بصمت (تُرجع نجاحاً بدون أي صف محذوف
        // فعلياً) بدل رسالة خطأ صريحة، فيبدو للمستخدم أن الزر "لا يعمل".
        const { data: deletedRows, error } = await dbClient
            .from('companies')
            .delete()
            .eq('id', id)
            .select();

        if (error) throw error;

        if (!deletedRows || deletedRows.length === 0) {
            alert(isEnglish
                ? "The company was not deleted. This usually means either a Row Level Security (RLS) DELETE policy is missing on the 'companies' table in Supabase, or employees are still linked to this company."
                : "لم يتم حذف الشركة فعلياً. الأسباب الشائعة: عدم وجود سياسة حذف (RLS DELETE Policy) على جدول 'companies' في سوبابيس، أو وجود موظفين ما زالوا مرتبطين بهذه الشركة.");
            return;
        }

        // لا نعرض alert نجاح هنا: اختفاء الصف من الجدول بعد إعادة التحميل هو
        // التأكيد الكافي للمستخدم بأن عملية الحذف تمّت.
        await fetchAndRenderCompanies();
    } catch (error) {
        console.error("Error deleting company:", error);
        const rawMsg = error && (error.message || error.details || error.hint);
        const isForeignKeyError = error && (error.code === '23503' || /foreign key/i.test(rawMsg || ''));
        const displayMsg = isForeignKeyError
            ? (isEnglish
                ? "This company still has employees (or other records) linked to it and cannot be deleted. Reassign or delete those first."
                : "هذه الشركة لا تزال مرتبطة بموظفين (أو سجلات أخرى) ولا يمكن حذفها. الرجاء نقل أو حذف تلك السجلات أولاً.")
            : (rawMsg || (isEnglish ? 'Unknown error' : 'خطأ غير معروف'));
        alert((isEnglish ? "Delete failed: " : "فشل الحذف: ") + displayMsg);
    }
}

// 👁️ دالة الانتقال لصفحة استعراض بيانات الشركة الكاملة (view_company.html)
function viewCompany(id) {
    window.location.href = (Routes.url('view_company') + '?id=') + encodeURIComponent(id);
}
