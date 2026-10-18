// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================
const SUPABASE_URL = "https://mcdhxdfkuokhmhtfvjev.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_yt9V8lsNU1zN3Ix2CvovbQ_QCA2VDdM";
const dbClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// =========================================================================
// صفحة "تفاصيل الموظف ودفعات السداد" — تُفتح من شاشة "تحصيل الموظفين"
// (collections.html) بالضغط على اسم أي موظف، عبر رابط
// employee-collection-details.html?linkId=<employee_links.id>
//
// تعرض: بيانات الموظف الأساسية (الاسم/رقم الهوية/رقم الجوال/الشركة/المسمى
// الوظيفي/تاريخ الربط/تاريخ انتهاء الربط/الصافي)، شرائح ملخص، وجدول كامل بسجل
// تحصيله الشهري عبر كل الأشهر المسجّلة بجدول employee_collections (وليس
// الشهر المختار حالياً فقط بشاشة "تحصيل الموظفين") — للمراجعة فقط، بلا أي
// إجراء تعديل من هذه الصفحة.
// =========================================================================

// أسماء الأشهر العربية لعرض "الشهر" بصيغة مقروءة بدل YYYY-MM-DD الخام
const ARABIC_MONTH_NAMES = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

// جلب كامل صفوف جدول ما على دفعات (Pagination) — نفس حل باقي شاشات المنصة
const EMP_DETAILS_FETCH_PAGE_SIZE = 1000;
async function fetchAllDetailsRows(builderFactory) {
    let allRows = [];
    let from = 0;
    while (true) {
        const { data, error } = await builderFactory(from, from + EMP_DETAILS_FETCH_PAGE_SIZE - 1);
        if (error) throw error;
        allRows = allRows.concat(data || []);
        if (!data || data.length < EMP_DETAILS_FETCH_PAGE_SIZE) break;
        from += EMP_DETAILS_FETCH_PAGE_SIZE;
    }
    return allRows;
}

document.addEventListener('DOMContentLoaded', async () => {
    const allowed = await Permissions.guardPage('finance_collections');
    if (!allowed) return;

    loadEmployeeCollectionDetails();
});

// 🔎 قراءة معرّف رابط الموظف (employee_links.id) من رابط الصفحة
function getQueryParam(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name);
}

// 💰 تنسيق القيم المالية بمنزلتين عشريتين بأرقام إنجليزية دائماً
function formatDetailsCurrency(value) {
    const num = parseFloat(value);
    if (isNaN(num)) return '0.00';
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
}

// 📅 تنسيق تاريخ/وقت بصيغة DD/MM/YYYY
function formatDetailsDate(dateStr) {
    if (!dateStr) return '—';
    const datePart = String(dateStr).split('T')[0];
    const parts = datePart.split('-');
    if (parts.length !== 3) return String(dateStr);
    const [y, m, d] = parts;
    return `${d}/${m}/${y}`;
}

// 🗓️ تحويل collection_month (تاريخ أول الشهر مثل 2026-08-01) إلى تسمية عربية
// مقروءة مثل "أغسطس 2026"
function formatDetailsMonthLabel(monthDateStr) {
    if (!monthDateStr) return '—';
    const parts = String(monthDateStr).split('T')[0].split('-');
    if (parts.length < 2) return String(monthDateStr);
    const year = parts[0];
    const monthIndex = parseInt(parts[1], 10) - 1;
    const monthName = ARABIC_MONTH_NAMES[monthIndex] || parts[1];
    return `${monthName} ${year}`;
}

// 🔒 تعقيم أي نص حر (كحقل الملاحظات) قبل إدراجه بالـ innerHTML لمنع أي إدخال HTML/سكربت
function escapeDetailsHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
}

function showDetailsPageAlert(message) {
    const alertBox = document.getElementById('employeeDetailsAlert');
    if (!alertBox) return;
    alertBox.textContent = message;
    alertBox.className = 'form-alert alert-error';
    alertBox.style.display = 'flex';
}

// =========================================================================
// 🛡️ إصلاح أمني حرج (IDOR): كان أي مستخدم يملك صلاحية عرض قسم "تحصيل
// الموظفين" يستطيع فتح هذه الصفحة بتغيير رقم ?linkId= بالرابط يدوياً ورؤية
// بيانات مالية حساسة (رقم الهوية الوطنية، صافي الراتب الشهري، وكامل سجل
// المدفوعات) لأي موظف آخر بالنظام — بلا أي تحقق من ملكية هذا السجل. الدالة
// أدناه تتحقق أن سجل الربط (employee_links) المطلوب يخص المستخدم الحالي
// فعلاً قبل عرض أي بيانات: دور "موظف" لا يُسمح له إلا بسجله الشخصي هو، ودور
// "مسؤول شركة" لا يُسمح له إلا بروابط موظفي شركته/شركاته المملوكة. مدير عام
// النظام والمسؤول (admin) بلا قيود كالمعتاد.
// =========================================================================
async function verifyLinkAccessOrBlock(linkId) {
    try {
        const { data: { session } } = await dbClient.auth.getSession();
        if (!session) return true; // guardPage تكفّل أصلاً بمنع الوصول بلا جلسة صالحة

        const { data: profileRow } = await dbClient.from('users').select('role').eq('id', session.user.id).maybeSingle();
        const role = profileRow?.role || null;
        if (role !== 'employee' && role !== 'company') return true; // super_admin / admin: بلا قيود

        const { data: linkRow, error } = await dbClient
            .from('employee_links').select('employee_id, company_id').eq('id', linkId).maybeSingle();
        if (error) throw error;
        if (!linkRow) return true; // السجل غير موجود أصلاً — سيُعالَج لاحقاً برسالة "تعذّر العثور" المعتادة

        if (role === 'employee') {
            const { data: employeeRow } = await dbClient.from('employees').select('id').eq('user_id', session.user.id).maybeSingle();
            return !!employeeRow && String(employeeRow.id) === String(linkRow.employee_id);
        }

        // role === 'company'
        const { data: ownedCompanies } = await dbClient.from('companies').select('id').eq('user_id', session.user.id);
        const companyIds = (ownedCompanies || []).map(c => String(c.id));
        return companyIds.includes(String(linkRow.company_id));
    } catch (error) {
        console.error('تعذّر التحقق من صلاحية الوصول لهذا السجل:', error.message);
        return false; // بحال فشل التحقق لأي سبب، الأمان أولاً: نمنع الوصول بدل السماح به بالخطأ
    }
}

// 📊 تحميل بيانات الموظف (من رابط "اضافة" بجدول employee_links) وكامل سجل
// تحصيله الشهري (من جدول employee_collections) ثم عرضهما بالصفحة
async function loadEmployeeCollectionDetails() {
    const linkId = getQueryParam('linkId');
    if (!linkId) {
        showDetailsPageAlert('معرّف الموظف غير موجود بالرابط. الرجاء الرجوع لصفحة تحصيل الموظفين والضغط على اسم الموظف مرة أخرى.');
        return;
    }

    const hasAccess = await verifyLinkAccessOrBlock(linkId);
    if (!hasAccess) {
        showDetailsPageAlert('غير مصرح لك بعرض بيانات هذا الموظف.');
        return;
    }

    try {
        // يُجلب أيضاً رقم الجوال (employees.mobile_number) وتاريخ الربط وتاريخ
        // انتهاء الربط (employee_links.link_date / link_end_date) لعرضها مع
        // بيانات الموظف الأساسية
        const { data: linkRow, error: linkError } = await dbClient
            .from('employee_links')
            .select('id, employee_id, job_title, net_salary_value, link_date, link_end_date, employees(name, national_id, mobile_number), companies(name)')
            .eq('id', linkId)
            .single();

        if (linkError) throw linkError;
        if (!linkRow) {
            showDetailsPageAlert('تعذّر العثور على بيانات هذا الموظف.');
            return;
        }

        const employeeName = (linkRow.employees && linkRow.employees.name) ? linkRow.employees.name : '----';
        const nationalId = (linkRow.employees && linkRow.employees.national_id) ? linkRow.employees.national_id : '----';
        let mobileNumber = (linkRow.employees && linkRow.employees.mobile_number) ? linkRow.employees.mobile_number : '';

        // احتياط: إن لم يعد الربط المضمّن رقم الجوال، نطلبه مباشرة من جدول الموظفين
        if (!mobileNumber && linkRow.employee_id != null) {
            try {
                const { data: empRow } = await dbClient.from('employees').select('mobile_number').eq('id', linkRow.employee_id).maybeSingle();
                if (empRow && empRow.mobile_number) mobileNumber = empRow.mobile_number;
            } catch (e) {
                console.error('تعذّر جلب رقم الجوال:', e.message);
            }
        }
        if (!mobileNumber) mobileNumber = '----';

        const companyName = (linkRow.companies && linkRow.companies.name) ? linkRow.companies.name : '----';
        const jobTitle = linkRow.job_title || '----';
        const netSalaryValue = linkRow.net_salary_value != null ? parseFloat(linkRow.net_salary_value) : 0;

        document.title = `${employeeName} — تفاصيل التحصيل - بصمة الأعمال`;

        const infoGrid = document.getElementById('employeeDetailsInfoGrid');
        if (infoGrid) {
            infoGrid.innerHTML = `
                <div class="employee-details-info-item"><span class="info-item-label">اسم الموظف</span><span class="info-item-value">${escapeDetailsHtml(employeeName)}</span></div>
                <div class="employee-details-info-item"><span class="info-item-label">رقم الهوية</span><span class="info-item-value">${escapeDetailsHtml(nationalId)}</span></div>
                <div class="employee-details-info-item"><span class="info-item-label">رقم الجوال</span><span class="info-item-value" dir="ltr" style="text-align:right;">${escapeDetailsHtml(mobileNumber)}</span></div>
                <div class="employee-details-info-item"><span class="info-item-label">الشركة</span><span class="info-item-value">${escapeDetailsHtml(companyName)}</span></div>
                <div class="employee-details-info-item"><span class="info-item-label">المسمى الوظيفي</span><span class="info-item-value">${escapeDetailsHtml(jobTitle)}</span></div>
                <div class="employee-details-info-item"><span class="info-item-label">تاريخ الربط</span><span class="info-item-value">${formatDetailsDate(linkRow.link_date)}</span></div>
                <div class="employee-details-info-item"><span class="info-item-label">تاريخ انتهاء الربط</span><span class="info-item-value">${formatDetailsDate(linkRow.link_end_date)}</span></div>
                <div class="employee-details-info-item"><span class="info-item-label">الصافي الشهري</span><span class="info-item-value">${formatDetailsCurrency(netSalaryValue)}</span></div>
            `;
        }

        const paymentRows = await fetchAllDetailsRows((from, to) =>
            dbClient.from('employee_collections')
                .select('collection_month, amount, received_amount, status, paid_at, notes')
                .eq('employee_link_id', linkId)
                .order('collection_month', { ascending: false })
                .range(from, to)
        );

        renderEmployeeDetailsPayments(paymentRows, netSalaryValue);

        const contentBox = document.getElementById('employeeDetailsPageContent');
        if (contentBox) contentBox.style.display = 'block';

    } catch (error) {
        console.error('تعذّر تحميل تفاصيل الموظف:', error);
        showDetailsPageAlert('فشل تحميل بيانات الموظف: ' + ((error && error.message) || 'خطأ غير معروف'));
    }
}

// 📑 بناء جدول سجل دفعات الموظف الكامل (كل الأشهر) + شرائح الملخص أعلاه
function renderEmployeeDetailsPayments(paymentRows, netSalaryValue) {
    const paymentsBody = document.getElementById('employeeDetailsPaymentsBody');
    const summaryRow = document.getElementById('employeeDetailsSummaryRow');
    if (!paymentsBody) return;

    if (!paymentRows || paymentRows.length === 0) {
        paymentsBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:24px; color:#94a3b8;">لا يوجد أي سجل تحصيل سابق لهذا الموظف.</td></tr>`;
        if (summaryRow) summaryRow.innerHTML = '';
        return;
    }

    let totalReceived = 0, totalRemaining = 0, paidMonthsCount = 0;

    paymentsBody.innerHTML = paymentRows.map(payment => {
        const dueAmount = payment.amount != null ? parseFloat(payment.amount) : (parseFloat(netSalaryValue) || 0);
        const receivedAmount = payment.received_amount != null ? parseFloat(payment.received_amount) : 0;
        const remaining = Math.max(dueAmount - receivedAmount, 0);
        const isPaid = payment.status === 'paid';
        const statusBadgeClass = isPaid ? 'status-badge-active' : 'status-badge-unpaid';
        const statusLabel = isPaid ? 'مدفوع' : 'غير مدفوع';
        const remainingClass = remaining > 0.004 ? 'has-remaining' : 'no-remaining';

        totalReceived += receivedAmount;
        totalRemaining += remaining;
        if (isPaid) paidMonthsCount++;

        return `
            <tr>
                <td>${formatDetailsMonthLabel(payment.collection_month)}</td>
                <td class="collection-net-cell" style="text-align:center;">${formatDetailsCurrency(dueAmount)}</td>
                <td class="collection-received-cell" style="text-align:center;">${formatDetailsCurrency(receivedAmount)}</td>
                <td class="collection-remaining-cell ${remainingClass}" style="text-align:center;">${formatDetailsCurrency(remaining)}</td>
                <td style="text-align:center;"><span class="${statusBadgeClass}">${statusLabel}</span></td>
                <td style="text-align:center; font-family: monospace;">${payment.paid_at ? formatDetailsDate(payment.paid_at) : '—'}</td>
                <td style="color:#475569;">${payment.notes ? escapeDetailsHtml(payment.notes) : '—'}</td>
            </tr>
        `;
    }).join('');

    if (summaryRow) {
        summaryRow.innerHTML = `
            <div class="employee-details-summary-chip">عدد الأشهر المسجّلة: <strong>${paymentRows.length}</strong></div>
            <div class="employee-details-summary-chip">الأشهر المدفوعة بالكامل: <strong>${paidMonthsCount}</strong></div>
            <div class="employee-details-summary-chip chip-paid">إجمالي المستلم: <strong>${formatDetailsCurrency(totalReceived)}</strong></div>
            <div class="employee-details-summary-chip chip-remaining">إجمالي المتبقي: <strong>${formatDetailsCurrency(totalRemaining)}</strong></div>
        `;
    }
}