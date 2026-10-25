// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================

// =========================================================================
// 2. أدوات مساعدة لعرض شريط التنبيه
// =========================================================================
function showViewAlert(message, type) {
    const alertBox = document.getElementById('viewAlert');
    if (!alertBox) return;
    alertBox.textContent = message;
    alertBox.className = 'form-alert ' + (type === 'success' ? 'alert-success' : 'alert-error');
    alertBox.style.display = 'flex';
}

function hideViewAlert() {
    const alertBox = document.getElementById('viewAlert');
    if (alertBox) alertBox.style.display = 'none';
}

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

// =========================================================================
// 3. جلب بيانات الشركة حسب المعرّف الممرَّر بالرابط (?id=...)
// =========================================================================
async function loadCompanyDetails() {
    const isEnglish = document.documentElement.getAttribute('lang') === 'en';
    const urlParams = new URLSearchParams(window.location.search);
    const companyId = urlParams.get('id');

    if (!companyId) {
        showViewAlert(isEnglish ? 'No company specified to display.' : 'لم يتم تحديد أي شركة لعرض بياناتها.', 'error');
        return;
    }

    try {
        const { data: company, error } = await dbClient
            .from('companies')
            .select('*')
            .eq('id', companyId)
            .maybeSingle();

        if (error) throw new Error(error.message);

        if (!company) {
            showViewAlert(isEnglish ? 'This company could not be found. It may have been deleted.' : 'تعذّر العثور على هذه الشركة، ربما تم حذفها.', 'error');
            return;
        }

        renderCompanyDetails(company, isEnglish);

    } catch (err) {
        console.error('تعذّر تحميل بيانات الشركة:', err.message);
        showViewAlert((isEnglish ? 'Failed to load company data: ' : 'فشل تحميل بيانات الشركة: ') + err.message, 'error');
    }
}

// =========================================================================
// 4. تعبئة الحقول وعرض المحتوى
// =========================================================================
function renderCompanyDetails(company, isEnglish) {
    const notSet = isEnglish ? 'Not set' : 'غير محدد';

    document.getElementById('viewCompanyName').textContent = company.name || notSet;
    document.getElementById('viewCompanyEmail').textContent = company.email || notSet;
    document.getElementById('viewCompanyPhone').textContent = company.phone || notSet;
    document.getElementById('viewCompanyCR').textContent = company.cr_number || notSet;
    document.getElementById('viewCompanyTax').textContent = company.tax_number || notSet;
    document.getElementById('viewCompanyCity').textContent = company.city || notSet;
    document.getElementById('viewCompanySector').textContent = company.sector || notSet;
    document.getElementById('viewCompanyAddress').textContent = company.address || notSet;

    // يدعم كلا الاسمين المحتملين لعمود خطة الاشتراك بحسب ما هو مخزّن فعلياً بالجدول
    const plan = company.subscription_plan || company.subscription || (isEnglish ? 'No Subscription' : 'بدون اشتراك');
    document.getElementById('viewCompanyPlan').textContent = plan;
    document.getElementById('viewCompanyPlanBadge').textContent = plan;

    document.getElementById('viewCompanyEmployeeCount').textContent = String(company.employee_count || 0);

    // حالة الشركة (نشط/غير نشط) — تُعتبر "نشط" افتراضياً للسجلات القديمة التي
    // أُنشئت قبل إضافة هذا الحقل ولا تحمل قيمة status بعد
    const isActiveStatus = (company.status || 'active') === 'active';
    document.getElementById('viewCompanyStatus').textContent = isActiveStatus
        ? (isEnglish ? 'Active' : 'نشط')
        : (isEnglish ? 'Inactive' : 'غير نشط');

    // ملاحظة الحالة: تظهر فقط لو الشركة "غير نشط" ومسجَّل لها نص ملاحظة فعلي
    const noteGroup = document.getElementById('group-view-status_note');
    if (noteGroup) {
        if (!isActiveStatus && company.status_note) {
            document.getElementById('viewCompanyStatusNote').textContent = company.status_note;
            noteGroup.style.display = '';
        } else {
            noteGroup.style.display = 'none';
        }
    }

    // الحقول الاختيارية الجديدة: نوع العقد، تاريخ العقد، قيمة الاشتراك (مع الإشارة لشمولها الضريبة من عدمه)،
    // رقم المنشأة، رقم هوية المنشأة، الشخص المفوض ورقم جواله، اسم المندوب
    document.getElementById('viewCompanyContractType').textContent = company.contract_type || notSet;
    document.getElementById('viewCompanyContractDate').textContent = formatDisplayDate(company.contract_date) || notSet;

    const formattedSubscriptionValue = formatCurrencyValue(company.subscription_value);
    if (formattedSubscriptionValue) {
        const vatNote = company.vat_included ? ' (شامل الضريبة المضافة)' : ' (غير شامل الضريبة المضافة)';
        document.getElementById('viewCompanySubscriptionValue').textContent = formattedSubscriptionValue + vatNote;
    } else {
        document.getElementById('viewCompanySubscriptionValue').textContent = notSet;
    }

    // مسترد الشركة: القيمة الافتراضية 0 إن لم تُسجَّل
    document.getElementById('viewCompanyRefund').textContent = formatCurrencyValue(company.company_refund) || '0.00';

    document.getElementById('viewCompanyEstablishmentNumber').textContent = company.establishment_number || notSet;
    document.getElementById('viewCompanyEstablishmentId').textContent = company.establishment_national_id || notSet;
    document.getElementById('viewCompanyAuthorizedPerson').textContent = company.authorized_person || notSet;
    document.getElementById('viewCompanyAuthorizedPersonPhone').textContent = company.authorized_person_phone || notSet;
    // 🆕 اسم المندوب
    document.getElementById('viewCompanyRepresentativeName').textContent = company.representative_name || notSet;

    document.getElementById('viewCompanyNameHeading').textContent = company.name || notSet;

    const initialsSource = (company.name || '؟').trim();
    document.getElementById('companyAvatarInitial').textContent = initialsSource.substring(0, 2) || '؟';

    renderCompanyDocs(company, isEnglish);

    hideViewAlert();
    const content = document.getElementById('viewCompanyContent');
    if (content) content.style.display = 'block';
}

// 📎 بناء روابط/حالة المستندات الرسمية (العقد/العنوان الوطني/الشهادة الضريبية/شهادة السجل التجاري)
function renderCompanyDocs(company, isEnglish) {
    const grid = document.getElementById('viewCompanyDocsGrid');
    if (!grid) return;

    // 🎨 أيقونات SVG موحّدة (icons.js) بدل رموز الإيموجي القديمة — نبني كل أيقونة
    // عبر data-icon (وليس تضمين ICONS.xxx الخام مباشرة داخل innerHTML) حتى تنطبق
    // عليها قاعدة التحجيم (width/height: 1em) الموجودة بـ icons.js، ثم نستدعي
    // applyIconPlaceholders() بعد إدراج HTML لتفعيلها فعلياً
    const docs = [
        { url: company.contract_url, icon: 'document', text: isEnglish ? 'Contract' : 'العقد' },
        { url: company.national_address_url, icon: 'home', text: isEnglish ? 'National Address' : 'العنوان الوطني' },
        { url: company.tax_certificate_url, icon: 'receipt', text: isEnglish ? 'Tax Certificate' : 'الشهادة الضريبية' },
        { url: company.cr_certificate_url, icon: 'building', text: isEnglish ? 'CR Certificate' : 'شهادة السجل التجاري' }
    ];

    grid.innerHTML = docs.map(doc => {
        const labelHtml = `<span data-icon="${doc.icon}" class="icon-inline"></span> ${doc.text}`;
        if (doc.url) {
            return `<a href="${doc.url}" target="_blank" rel="noopener" class="doc-view-link">${labelHtml} ↗</a>`;
        }
        return `<div class="doc-view-missing">${labelHtml} — ${isEnglish ? 'not uploaded' : 'لم يُرفع'}</div>`;
    }).join('');

    if (window.applyIconPlaceholders) applyIconPlaceholders(grid);
}

// =========================================================================
// 5. ربط الأحداث
// =========================================================================
document.addEventListener('DOMContentLoaded', async function() {
    const allowed = await Permissions.guardPage('companies');
    if (!allowed) return;

    loadCompanyDetails();

    const backBtn = document.getElementById('btnBackToCompanies');
    if (backBtn) {
        backBtn.addEventListener('click', function() {
            window.location.href = Routes.url('companies');
        });
    }
});