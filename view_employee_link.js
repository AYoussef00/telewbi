// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================
const SUPABASE_URL = "https://mcdhxdfkuokhmhtfvjev.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_yt9V8lsNU1zN3Ix2CvovbQ_QCA2VDdM";
const dbClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentLinkId = null;

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
    if (value === null || value === undefined || value === '') return '—';
    const num = parseFloat(value);
    if (isNaN(num)) return '—';
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
}

// 📅 تنسيق تاريخ بصيغة DD/MM/YYYY بأرقام إنجليزية دائماً؛ الأعمدة بقاعدة البيانات بصيغة YYYY-MM-DD
function formatDisplayDate(dateStr) {
    if (!dateStr) return '—';
    const datePart = String(dateStr).split('T')[0];
    const parts = datePart.split('-');
    if (parts.length !== 3) return String(dateStr);
    const [y, m, d] = parts;
    return `${d}/${m}/${y}`;
}

// =========================================================================
// 3. جلب بيانات الربط حسب المعرّف الممرَّر بالرابط (?id=...)
// =========================================================================
async function loadLinkDetails() {
    const urlParams = new URLSearchParams(window.location.search);
    currentLinkId = urlParams.get('id');

    if (!currentLinkId) {
        showViewAlert('لم يتم تحديد أي ربط لعرض بياناته.', 'error');
        return;
    }

    try {
        const { data: link, error } = await dbClient
            .from('employee_links')
            .select('*, employees(name, national_id), companies(name)')
            .eq('id', currentLinkId)
            .maybeSingle();

        if (error) throw new Error(error.message);

        if (!link) {
            showViewAlert('تعذّر العثور على سجل الربط هذا، ربما تم حذفه.', 'error');
            return;
        }

        renderLinkDetails(link);

    } catch (err) {
        console.error('تعذّر تحميل بيانات الربط:', err.message);
        showViewAlert('فشل تحميل بيانات الربط: ' + err.message, 'error');
    }
}

// =========================================================================
// 4. تعبئة الحقول وعرض المحتوى
// =========================================================================
function renderLinkDetails(link) {
    const notSet = 'غير محدد';

    document.getElementById('viewLinkEmployeeName').value = (link.employees && link.employees.name) ? link.employees.name : notSet;
    document.getElementById('viewLinkNationalId').value = (link.employees && link.employees.national_id) ? link.employees.national_id : notSet;
    document.getElementById('viewLinkCompany').value = (link.companies && link.companies.name) ? link.companies.name : notSet;
    document.getElementById('viewLinkJobTitle').value = link.job_title || notSet;
    document.getElementById('viewLinkType').value = link.link_type || notSet;

    // 🆕 حالة الربط — الافتراضي "تم التعيين" إن لم تُسجَّل قيمة (سجلات قديمة قبل
    // إضافة هذا الحقل)؛ وتظهر بطاقة الملاحظة فقط عندما تكون الحالة "قيد المعالجة"
    // وتوجد ملاحظة مسجّلة فعلاً.
    const viewLinkStatus = link.link_status || 'تم التعيين';
    document.getElementById('viewLinkStatus').value = viewLinkStatus;
    const noteGroup = document.getElementById('group-view-link_status_note');
    const noteField = document.getElementById('viewLinkStatusNote');
    if (viewLinkStatus === 'قيد المعالجة' && link.link_status_note) {
        noteField.value = link.link_status_note;
        noteGroup.style.display = '';
    } else {
        noteGroup.style.display = 'none';
    }

    document.getElementById('viewLinkDate').value = formatDisplayDate(link.link_date);
    document.getElementById('viewLinkEndDate').value = formatDisplayDate(link.link_end_date);
    document.getElementById('viewLinkSubscriptionValue').value = formatCurrencyValue(link.subscription_value);
    document.getElementById('viewLinkSalaryValue').value = link.salary_value != null ? formatCurrencyValue(link.salary_value) : '—';
    document.getElementById('viewLinkBasicSalaryValue').value = link.basic_salary_value != null ? formatCurrencyValue(link.basic_salary_value) : '—';
    document.getElementById('viewLinkNetSalaryValue').value = link.net_salary_value != null ? formatCurrencyValue(link.net_salary_value) : '—';
    document.getElementById('viewLinkCreatedAt').value = formatDisplayDate(link.created_at);

    hideViewAlert();
    const content = document.getElementById('viewLinkContent');
    if (content) content.style.display = 'block';

    const editBtn = document.getElementById('btnEditThisLink');
    if (editBtn) editBtn.style.display = 'inline-flex';
}

// =========================================================================
// 5. ربط الأحداث
// =========================================================================
document.addEventListener('DOMContentLoaded', async function() {
    const allowed = await Permissions.guardPage('employee_links');
    if (!allowed) return;

    loadLinkDetails();

    const backBtn = document.getElementById('btnBackToLinks');
    if (backBtn) {
        backBtn.addEventListener('click', function() {
            window.location.href = 'employee_links.html';
        });
    }

    const editBtn = document.getElementById('btnEditThisLink');
    if (editBtn) {
        editBtn.addEventListener('click', function() {
            if (currentLinkId) window.location.href = 'edit_employee_link.html?id=' + encodeURIComponent(currentLinkId);
        });
    }
});