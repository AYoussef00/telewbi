// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================
const SUPABASE_URL = "https://mcdhxdfkuokhmhtfvjev.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_yt9V8lsNU1zN3Ix2CvovbQ_QCA2VDdM";
const dbClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 📅 تاريخ اليوم بصيغة YYYY-MM-DD — لتقييد استعلام employee_links بالروابط
// النشطة فقط (بلا تاريخ انتهاء، أو بتاريخ انتهاء لم يحِن بعد). بعد تحويل
// "إنهاء الربط" ليصبح تعليماً بتاريخ انتهاء (link_end_date) بدل حذف صف
// الربط فعلياً، يبقى صف الربط القديم موجوداً بالجدول حتى بعد إنهائه، فبلا
// هذا التقييد قد تُعرض شركة/مسمى وظيفي قديمَين لموظف انتهى ربطه فعلياً، أو
// يفشل .maybeSingle() لو وُجد أكثر من صف (ربط قديم منتهٍ + ربط جديد نشط).
function getTodayDateStringForLinks() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

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

// =========================================================================
// 🛡️ إصلاح أمني مهم (IDOR): كان أي مستخدم يملك صلاحية عرض قسم "الموظفين"
// يستطيع فتح هذه الصفحة بتغيير رقم ?id= بالرابط يدوياً ورؤية بيانات *أي*
// موظف آخر بالنظام (الجوال، رقم الهوية، المستندات المرفوعة...)، بلا أي تحقق
// من أن هذا السجل يخصه فعلاً — الفحص الوحيد كان صلاحية القسم نفسها (view:
// employees)، وليس ملكية السجل. الدالة أدناه تتحقق أن السجل المطلوب يخص
// المستخدم الحالي فعلاً قبل عرض أي بيانات: دور "موظف" لا يُسمح له إلا
// بسجله الشخصي هو، ودور "مسؤول شركة" لا يُسمح له إلا بموظفي شركته/شركاته
// المملوكة (عبر employee_links/employee_link_history). مدير عام النظام
// والمسؤول (admin) بلا قيود كالمعتاد.
// =========================================================================
async function verifyEmployeeAccessOrBlock(employeeId) {
    try {
        const { data: { session } } = await dbClient.auth.getSession();
        if (!session) return true; // guardPage تكفّل أصلاً بمنع الوصول بلا جلسة صالحة

        const { data: profileRow } = await dbClient.from('users').select('role').eq('id', session.user.id).maybeSingle();
        const role = profileRow?.role || null;

        if (role === 'employee') {
            const { data: employeeRow } = await dbClient.from('employees').select('id').eq('user_id', session.user.id).maybeSingle();
            return !!employeeRow && String(employeeRow.id) === String(employeeId);
        }

        if (role === 'company') {
            const { data: ownedCompanies } = await dbClient.from('companies').select('id').eq('user_id', session.user.id);
            const companyIds = (ownedCompanies || []).map(c => c.id);
            if (companyIds.length === 0) return false;

            const { data: activeLink } = await dbClient
                .from('employee_links').select('id').eq('employee_id', employeeId).in('company_id', companyIds).maybeSingle();
            if (activeLink) return true;

            try {
                const { data: historyLink, error: historyError } = await dbClient
                    .from('employee_link_history').select('id').eq('employee_id', employeeId).in('company_id', companyIds).maybeSingle();
                if (historyError) throw historyError;
                return !!historyLink;
            } catch (historyErr) {
                console.error('تعذّر التحقق من أرشيف الروابط أثناء التحقق من الصلاحية:', historyErr.message);
                return false;
            }
        }

        return true; // super_admin / admin: بلا قيود
    } catch (error) {
        console.error('تعذّر التحقق من صلاحية الوصول لهذا الموظف:', error.message);
        return false; // بحال فشل التحقق لأي سبب، الأمان أولاً: نمنع الوصول بدل السماح به بالخطأ
    }
}

// =========================================================================
// 3. جلب بيانات الموظف حسب المعرّف الممرَّر بالرابط (?id=...)
// =========================================================================
async function loadEmployeeDetails() {
    const isEnglish = document.documentElement.getAttribute('lang') === 'en';
    const urlParams = new URLSearchParams(window.location.search);
    const employeeId = urlParams.get('id');

    if (!employeeId) {
        showViewAlert(isEnglish ? 'No employee specified to display.' : 'لم يتم تحديد أي موظف لعرض بياناته.', 'error');
        return;
    }

    const hasAccess = await verifyEmployeeAccessOrBlock(employeeId);
    if (!hasAccess) {
        showViewAlert(isEnglish ? 'You are not authorized to view this employee\'s data.' : 'غير مصرح لك بعرض بيانات هذا الموظف.', 'error');
        return;
    }

    try {
        const { data: emp, error } = await dbClient
            .from('employees')
            .select('*')
            .eq('id', employeeId)
            .maybeSingle();

        if (error) throw new Error(error.message);

        if (!emp) {
            showViewAlert(isEnglish ? 'This employee could not be found. They may have been deleted.' : 'تعذّر العثور على هذا الموظف، ربما تم حذفه.', 'error');
            return;
        }

        // ⚠️ اسم الشركة والمسمى الوظيفي الفعليان يُشتقان من جدول الربط
        // employee_links (المصدر الفعلي لعلاقة الموظف بالشركة ولمسماه الوظيفي)،
        // وليس من عمودي employees.company_id / employees.job_title اللذين لم
        // يعودا يُستخدمان منذ فصل شاشة "إضافة موظف" عن شاشة "ربط الموظفين"
        // (يُحفظان دائماً كـ null / "غير محدد" عند إنشاء الموظف — لذا كان
        // الاعتماد عليهما مباشرة يجعل الشركة والمسمى الوظيفي لا يظهران أبداً
        // حتى لو كان الموظف مرتبطاً فعلياً بشركة). مُقيَّد بالروابط النشطة فقط
        // (انظر تعليق getTodayDateStringForLinks أعلاه).
        let companyName = '';
        let jobTitle = '';
        const { data: link } = await dbClient
            .from('employee_links')
            .select('job_title, companies(name)')
            .eq('employee_id', employeeId)
            .or(`link_end_date.is.null,link_end_date.gte.${getTodayDateStringForLinks()}`)
            .maybeSingle();

        if (link) {
            jobTitle = link.job_title || '';
            if (link.companies) companyName = link.companies.name || '';
        }

        // جلب الدور/الصلاحية من جدول المستخدمين المرتبط بحساب الموظف (إن وجد).
        // ⚠️ الموظفون الذين لم يُنشأ لهم حساب دخول فعلي (لم يُفعَّل خيار "إنشاء
        // حساب دخول للموظف" عند الإضافة) لا يملكون user_id إطلاقاً — وهذا وضع
        // طبيعي وليس خللاً. بدل ترك الحقل "غير محدد" في هذه الحالة، يُفترض
        // افتراضياً أن دورهم "موظف" (القيمة الافتراضية المنطقية لأي موظف
        // بالنظام، سواء ملك حساب دخول أم لا).
        let userRole = '';
        if (emp.user_id) {
            const { data: userRow } = await dbClient
                .from('users')
                .select('role')
                .eq('id', emp.user_id)
                .maybeSingle();
            if (userRow) userRole = userRow.role;
        }

        renderEmployeeDetails(emp, companyName, jobTitle, userRole, isEnglish);

    } catch (err) {
        console.error('تعذّر تحميل بيانات الموظف:', err.message);
        showViewAlert((isEnglish ? 'Failed to load employee data: ' : 'فشل تحميل بيانات الموظف: ') + err.message, 'error');
    }
}

// =========================================================================
// 4. تعبئة الحقول وعرض المحتوى
// =========================================================================
const ROLE_LABELS_AR = {
    employee: 'موظف',
    admin: 'مسؤول',
    company: 'مسؤول شركة',
    super_admin: 'مدير عام النظام'
};
const ROLE_LABELS_EN = {
    employee: 'Employee',
    admin: 'Admin',
    company: 'Company Admin',
    super_admin: 'Super Admin'
};

const STATUS_LABELS_AR = { active: 'نشط', inactive: 'غير نشط' };
const STATUS_LABELS_EN = { active: 'Active', inactive: 'Inactive' };

// الدور الافتراضي المعروض حين لا يملك الموظف حساب دخول مرتبط أصلاً (user_id فارغ)
const DEFAULT_ROLE_WHEN_NO_ACCOUNT = 'employee';

function renderEmployeeDetails(emp, companyName, jobTitle, userRole, isEnglish) {
    const notSet = isEnglish ? 'Not set' : 'غير محدد';

    document.getElementById('viewEmpName').value = emp.name || notSet;
    document.getElementById('viewEmpNationalId').value = emp.national_id || notSet;
    document.getElementById('viewEmpMobile').value = emp.mobile_number || notSet;

    document.getElementById('viewEmpBirthDate').value = emp.birth_date
        ? new Date(emp.birth_date).toLocaleDateString(isEnglish ? 'en-GB' : 'ar-EG')
        : notSet;

    document.getElementById('viewEmpEmail').value = emp.email || notSet;
    document.getElementById('viewEmpJobTitle').value = jobTitle || notSet;
    document.getElementById('viewEmpCompany').value = companyName || notSet;
    document.getElementById('viewEmpIban').value = emp.iban_number || notSet;

    const statusLabels = isEnglish ? STATUS_LABELS_EN : STATUS_LABELS_AR;
    document.getElementById('viewEmpStatus').value = statusLabels[emp.status] || emp.status || notSet;

    const roleLabels = isEnglish ? ROLE_LABELS_EN : ROLE_LABELS_AR;
    const effectiveRole = userRole || DEFAULT_ROLE_WHEN_NO_ACCOUNT;
    document.getElementById('viewEmpRole').value = roleLabels[effectiveRole] || effectiveRole;

    renderEmployeeDocs(emp, isEnglish);

    hideViewAlert();
    const content = document.getElementById('viewEmployeeContent');
    if (content) content.style.display = 'block';
}

// 📎 بناء روابط/حالة المستندات الرسمية
function renderEmployeeDocs(emp, isEnglish) {
    const grid = document.getElementById('viewEmpDocsGrid');
    if (!grid) return;

    const docs = [
        { url: emp.cv_url, label: isEnglish ? '📄 CV' : '📄 السيرة الذاتية' },
        { url: emp.id_photo_url, label: isEnglish ? '🪪 ID Photo' : '🪪 صورة الهوية' },
        { url: emp.iban_certificate_url, label: isEnglish ? '🏦 IBAN Certificate' : '🏦 شهادة الآيبان' },
        { url: emp.national_address_url, label: isEnglish ? '🏠 National Address' : '🏠 العنوان الوطني' }
    ];

    grid.innerHTML = docs.map(doc => {
        if (doc.url) {
            return `<a href="${doc.url}" target="_blank" rel="noopener" class="doc-view-link">${doc.label} ↗</a>`;
        }
        return `<div class="doc-view-missing">${doc.label} — ${isEnglish ? 'not uploaded' : 'لم يُرفع'}</div>`;
    }).join('');
}

// =========================================================================
// 5. ربط الأحداث
// =========================================================================
document.addEventListener('DOMContentLoaded', async function() {
    const allowed = await Permissions.guardPage('employees');
    if (!allowed) return;

    loadEmployeeDetails();

    const backBtn = document.getElementById('btnBackToEmployees');
    if (backBtn) {
        backBtn.addEventListener('click', function() {
            window.location.href = 'employees.html';
        });
    }
});