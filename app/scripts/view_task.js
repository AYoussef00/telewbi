// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================

// =========================================================================
// صفحة "بيانات المهمة" — تُفتح بالضغط على عنوان أي مهمة (من جدول "مهامي" بلوحة
// تحكم الموظف حالياً)، عبر رابط view_task.html?id=<tasks.id>، وتعرض كامل
// تفاصيل المهمة للقراءة فقط (بلا أي إجراء تعديل من هذه الصفحة).
//
// ⚠️ لا تُحرَس هذه الصفحة بصلاحية قسم "المهام" (data-perm/guardPage) عمداً —
// لوحة تحكم الموظف (dashboard.html) متاحة دائماً لأي مستخدم مسجّل دخوله بغض
// النظر عن صلاحياته المحفوظة (نفس استثناء dashboard بملف permissions.js)،
// فلو رُبطت هذه الصفحة بصلاحية "tasks" لَحُجب موظف لا يملك تلك الصلاحية عن
// عرض تفاصيل مهمته الخاصة رغم رؤيته لها أصلاً بلوحة تحكمه. بدل ذلك، الحماية
// هنا مبنية على "ملكية السجل" مباشرة (نفس أسلوب view_employee.js وصفحة
// "تفاصيل الموظف ودفعات السداد"): دور "موظف" لا يرى إلا مهامه المُسندة إليه
// هو فقط، ودور "مسؤول شركة" لا يرى إلا مهام شركته/شركاته المملوكة، بينما
// مدير عام النظام والمسؤول (admin) بلا قيود.
// =========================================================================

const TASK_TYPE_BADGE = {
    'مسندة': 'badge-type-assigned',
    'مستقلة': 'badge-type-standalone',
    'روتينية': 'badge-type-routine'
};
const TASK_STATUS_BADGE = {
    'قيد الانتظار': 'badge-status-pending',
    'قيد التنفيذ': 'badge-status-inprogress',
    'مكتملة': 'badge-status-done'
};

function escapeViewTaskHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
}

function showViewTaskAlert(message) {
    const alertBox = document.getElementById('viewTaskAlert');
    if (!alertBox) return;
    alertBox.textContent = message;
    alertBox.className = 'form-alert alert-error';
    alertBox.style.display = 'flex';
}

// 🔎 تنسيق تاريخ/وقت الإنشاء (timestamptz) بصيغة عربية مقروءة
function formatViewTaskDateTime(value) {
    if (!value) return '—';
    try {
        return new Date(value).toLocaleString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) {
        return String(value);
    }
}

// 🛡️ التحقق من ملكية المهمة قبل عرض أي بيانات — انظر التعليق أعلى الملف
async function verifyTaskAccessOrBlock(task) {
    try {
        const { data: { session } } = await dbClient.auth.getSession();
        if (!session) return true; // تُعالَج حالة غياب الجلسة بمكان آخر (تحويل لصفحة الدخول)

        const { data: profileRow } = await dbClient.from('users').select('role').eq('id', session.user.id).maybeSingle();
        const role = profileRow?.role || null;

        if (role === 'employee') {
            const { data: employeeRow } = await dbClient.from('employees').select('id').eq('user_id', session.user.id).maybeSingle();
            return !!employeeRow && task.assigned_to != null && String(employeeRow.id) === String(task.assigned_to);
        }

        if (role === 'company') {
            if (task.company_id == null) return false;
            const { data: ownedCompanies } = await dbClient.from('companies').select('id').eq('user_id', session.user.id);
            const companyIds = (ownedCompanies || []).map(c => String(c.id));
            return companyIds.includes(String(task.company_id));
        }

        return true; // super_admin / admin: بلا قيود
    } catch (error) {
        console.error('تعذّر التحقق من صلاحية الوصول لهذه المهمة:', error.message);
        return false; // بحال فشل التحقق لأي سبب، الأمان أولاً: نمنع الوصول بدل السماح به بالخطأ
    }
}

// =========================================================================
// 2. جلب بيانات المهمة حسب المعرّف الممرَّر بالرابط (?id=...) + اسم الشركة
// والموظف المُسند إليه (استعلامان منفصلان بسيطان، بلا حاجة لتعقيد إضافي
// بما أن هذه صفحة عرض واحدة فقط وليست جدولاً بعشرات الصفوف)
// =========================================================================
async function loadTaskDetails() {
    const urlParams = new URLSearchParams(window.location.search);
    const taskId = urlParams.get('id');

    if (!taskId) {
        showViewTaskAlert('لم يتم تحديد أي مهمة لعرض بياناتها.');
        return;
    }

    try {
        const { data: task, error } = await dbClient
            .from('tasks')
            .select('*')
            .eq('id', taskId)
            .maybeSingle();

        if (error) throw new Error(error.message);

        if (!task) {
            showViewTaskAlert('تعذّر العثور على هذه المهمة، ربما تم حذفها.');
            return;
        }

        const hasAccess = await verifyTaskAccessOrBlock(task);
        if (!hasAccess) {
            showViewTaskAlert('غير مصرح لك بعرض بيانات هذه المهمة.');
            return;
        }

        let companyName = '—';
        if (task.company_id != null) {
            const { data: companyRow } = await dbClient.from('companies').select('name').eq('id', task.company_id).maybeSingle();
            if (companyRow) companyName = companyRow.name || '—';
        }

        let assigneeName = '—';
        if (task.assigned_to != null) {
            const { data: empRow } = await dbClient.from('employees').select('name').eq('id', task.assigned_to).maybeSingle();
            if (empRow && empRow.name) {
                assigneeName = empRow.name;
            } else {
                // 🔗 احتياط: لو تعذّر الوصول لسجل الموظف مباشرة (مثلاً بسبب سياسات
                // RLS تعتمد على ربط نشط)، نحاول أرشيف الروابط المُنهاة كمصدر بديل
                // لاسم الموظف — نفس أسلوب tasks.js لضمان عدم ظهور "غير معروف" بلا داعٍ
                const { data: historyRow } = await dbClient
                    .from('employee_link_history')
                    .select('employee_name')
                    .eq('employee_id', task.assigned_to)
                    .order('end_date', { ascending: false })
                    .limit(1)
                    .maybeSingle();
                assigneeName = (historyRow && historyRow.employee_name) ? historyRow.employee_name : '—';
            }
        }

        renderTaskDetails(task, companyName, assigneeName);

    } catch (err) {
        console.error('تعذّر تحميل بيانات المهمة:', err.message);
        showViewTaskAlert('فشل تحميل بيانات المهمة: ' + err.message);
    }
}

// =========================================================================
// 3. تعبئة الحقول وعرض المحتوى
// =========================================================================
function renderTaskDetails(task, companyName, assigneeName) {
    document.getElementById('viewTaskTitle').textContent = task.title || '—';

    const typeBadge = document.getElementById('viewTaskTypeBadge');
    typeBadge.textContent = task.type || '—';
    typeBadge.className = 'badge-task-type ' + (TASK_TYPE_BADGE[task.type] || 'badge-type-standalone');

    const statusBadge = document.getElementById('viewTaskStatusBadge');
    statusBadge.textContent = task.status || '—';
    statusBadge.className = 'badge-task-status ' + (TASK_STATUS_BADGE[task.status] || 'badge-status-pending');

    document.getElementById('viewTaskCompany').value = companyName;
    document.getElementById('viewTaskAssignee').value = assigneeName;
    document.getElementById('viewTaskStartDate').value = task.start_date || '—';
    document.getElementById('viewTaskDueDate').value = task.due_date || '—';
    document.getElementById('viewTaskCreatedAt').value = formatViewTaskDateTime(task.created_at);
    document.getElementById('viewTaskNotes').textContent = task.notes || 'لا توجد ملاحظات.';

    const alertBox = document.getElementById('viewTaskAlert');
    if (alertBox) alertBox.style.display = 'none';
    const content = document.getElementById('viewTaskContent');
    if (content) content.style.display = 'block';
}

// =========================================================================
// 4. ربط الأحداث
// =========================================================================
document.addEventListener('DOMContentLoaded', async () => {
    // فحص جلسة بسيط (بلا حراسة صلاحيات قسم — انظر التعليق أعلى الملف): لو لم
    // تكن هناك جلسة دخول فعلية أصلاً، نُحوِّل مباشرة لصفحة الدخول
    const { data: { session } } = await dbClient.auth.getSession();
    if (!session) {
        window.location.href = Routes.url('login');
        return;
    }

    loadTaskDetails();

    const backBtn = document.getElementById('btnBackFromTask');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            // رجوع لنفس الصفحة التي فتحت منها هذه الشاشة إن أمكن تحديدها، وإلا للوحة التحكم افتراضياً
            if (document.referrer && document.referrer.includes(window.location.origin)) {
                window.history.back();
            } else {
                window.location.href = Routes.url('dashboard');
            }
        });
    }
});
