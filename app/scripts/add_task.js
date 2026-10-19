// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================

// حالات الحضور التي تُعتبر غياباً (لا يجوز إسناد مهمة للموظف بفترة تتضمن
// يوماً مسجَّلاً بإحدى هاتين الحالتين)
const ABSENCE_STATUSES = ['غائب', 'إجازة سنوية'];

// =========================================================================
// 🛡️ نطاق رؤية المستخدم الحالي: نفس منطق شاشة "إدارة المهام" — مسؤول الشركة
// (role='company') يمكنه فقط إسناد مهام لشركته/شركاته المملوكة
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
        console.error('تعذّر تحديد نطاق صلاحيات المستخدم الحالي:', error.message);
    }
}

// =========================================================================
// 2. مكوّن قائمة قابلة للبحث (Searchable Combobox) — الشركة والموظف المُسنَد إليه
// =========================================================================
function setupSearchableCombobox({ inputId, hiddenId, dropdownId, options, emptyText, onSelectExtra }) {
    const input = document.getElementById(inputId);
    const hidden = document.getElementById(hiddenId);
    const dropdown = document.getElementById(dropdownId);

    function renderOptions(filterText) {
        const normalized = (filterText || '').trim().toLowerCase();
        const filtered = normalized ? options.filter(opt => opt.label.toLowerCase().includes(normalized)) : options;

        dropdown.innerHTML = '';
        if (filtered.length === 0) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'combo-empty';
            emptyEl.textContent = emptyText || 'لا توجد نتائج مطابقة';
            dropdown.appendChild(emptyEl);
            return;
        }

        filtered.forEach(opt => {
            const item = document.createElement('div');
            item.className = 'combo-item';
            if (String(hidden.value) === String(opt.value)) item.classList.add('selected');
            item.textContent = opt.label;
            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                hidden.value = opt.value;
                input.value = opt.label;
                closeDropdown();
                hidden.dispatchEvent(new Event('change'));
                if (onSelectExtra) onSelectExtra(opt);
            });
            dropdown.appendChild(item);
        });
    }

    function openDropdown() { renderOptions(''); dropdown.classList.add('open'); }
    function closeDropdown() { dropdown.classList.remove('open'); }

    input.addEventListener('focus', () => { input.select(); openDropdown(); });
    input.addEventListener('input', () => { renderOptions(input.value); dropdown.classList.add('open'); });
    input.addEventListener('blur', () => setTimeout(closeDropdown, 150));
    document.addEventListener('click', (e) => { if (!input.contains(e.target) && !dropdown.contains(e.target)) closeDropdown(); });

    return {
        enable(placeholderText) { input.disabled = false; input.placeholder = placeholderText || 'ابحث أو اختر...'; },
        setOptions(newOptions) { options = newOptions; }
    };
}

let companyCombobox = null;
let assigneeCombobox = null;
// يُخزَّن هنا لكل شركة: قائمة موظفيها المرتبطين مع مسمّاهم الوظيفي وفترة ربطهم
// الفعلية (link_date / link_end_date) — نحتاج فترة الربط لاحقاً عند التحقق
// من صلاحية فترة المهمة المُدخَلة دون الحاجة لاستعلام إضافي عند الحفظ
let employeeLinksByCompanyId = new Map();

async function loadCompaniesForCombobox() {
    companyCombobox = setupSearchableCombobox({
        inputId: 'taskCompanySearch',
        hiddenId: 'taskCompanyId',
        dropdownId: 'taskCompanyDropdown',
        options: [],
        emptyText: 'لا توجد شركات مطابقة',
        onSelectExtra: (opt) => handleCompanySelected(opt.value)
    });

    try {
        let query = dbClient.from('companies').select('id, name').order('name', { ascending: true });
        if (currentUserScope.companyIds !== null) {
            if (currentUserScope.companyIds.length === 0) {
                companyCombobox.enable('لا توجد شركات مملوكة لحسابك بعد');
                return;
            }
            query = query.in('id', currentUserScope.companyIds);
        }

        const { data, error } = await query;
        if (error) throw new Error(error.message);

        const options = (data || []).map(c => ({ value: String(c.id), label: c.name || '----' }));
        companyCombobox.setOptions(options);
        companyCombobox.enable(options.length ? 'ابحث عن شركة...' : 'لا توجد شركات مضافة بعد');

        // لو مسؤول الشركة يملك شركة واحدة فقط، اخترها تلقائياً وحمّل موظفيها مباشرة
        if (currentUserScope.companyIds && options.length === 1) {
            const only = options[0];
            document.getElementById('taskCompanyId').value = only.value;
            document.getElementById('taskCompanySearch').value = only.label;
            handleCompanySelected(only.value);
        }
    } catch (error) {
        console.error('تعذّر تحميل قائمة الشركات:', error.message);
        document.getElementById('taskCompanySearch').placeholder = 'تعذّر تحميل القائمة';
    }
}

async function loadEmployeesForCompany(companyId) {
    if (employeeLinksByCompanyId.has(companyId)) return employeeLinksByCompanyId.get(companyId);

    try {
        const { data, error } = await dbClient
            .from('employee_links')
            .select('employee_id, job_title, link_date, link_end_date, employees(id, name)')
            .eq('company_id', companyId);
        if (error) throw error;

        const list = (data || [])
            .filter(row => row.employees)
            .map(row => ({
                employee_id: row.employees.id,
                name: row.employees.name,
                job_title: row.job_title || '',
                link_date: row.link_date || null,
                link_end_date: row.link_end_date || null
            }));

        employeeLinksByCompanyId.set(companyId, list);
        return list;
    } catch (error) {
        console.error('تعذّر تحميل موظفي الشركة المحددة:', error.message);
        return [];
    }
}

async function handleCompanySelected(companyId) {
    const assigneeInput = document.getElementById('taskAssigneeSearch');
    const assigneeHidden = document.getElementById('taskAssignedTo');
    assigneeInput.value = '';
    assigneeHidden.value = '';
    setFieldError('start_date', null);
    setFieldError('due_date', null);

    if (!companyId) {
        assigneeInput.disabled = true;
        assigneeInput.placeholder = 'اختر الشركة أولاً...';
        assigneeCombobox && assigneeCombobox.setOptions([]);
        return;
    }

    assigneeInput.disabled = true;
    assigneeInput.placeholder = 'جاري تحميل الموظفين...';

    const employees = await loadEmployeesForCompany(companyId);
    const options = employees.map(e => ({
        value: String(e.employee_id),
        label: e.job_title ? `${e.name} — ${e.job_title}` : e.name
    }));

    if (!assigneeCombobox) {
        assigneeCombobox = setupSearchableCombobox({
            inputId: 'taskAssigneeSearch',
            hiddenId: 'taskAssignedTo',
            dropdownId: 'taskAssigneeDropdown',
            options,
            emptyText: 'لا يوجد موظفون مرتبطون بهذه الشركة',
            onSelectExtra: () => { setFieldError('start_date', null); setFieldError('due_date', null); }
        });
    } else {
        assigneeCombobox.setOptions(options);
    }

    assigneeInput.disabled = false;
    assigneeInput.placeholder = options.length ? 'ابحث عن موظف...' : 'لا يوجد موظفون مرتبطون بهذه الشركة';
}

// =========================================================================
// 2ب. التحقق من صلاحية فترة المهمة قبل إسنادها لموظف — ثلاثة شروط مجتمعة:
//     1) الفترة ضمن فترة ربط الموظف الفعلية بالشركة (لا تبدأ قبل ربطه، ولا
//        تتجاوز تاريخ انتهاء ربطه إن وُجد).
//     2) لا يوجد ضمن الفترة أي يوم مسجَّل غياباً أو إجازة سنوية للموظف.
//     3) لا تتقاطع الفترة مع فترة مهمة أخرى مُسندة له مسبقاً (بأي حالة وبأي
//        شركة) — يمكن إسناد مهمة جديدة بتاريخ بعد انتهاء المهمة الحالية مباشرة.
//     ⚠️ هذا التحقق يُطبَّق فقط عند إنشاء مهمة جديدة؛ لا يُعاد فحص أو تعديل
//     أي مهام قديمة محفوظة مسبقاً بأي شكل.
// =========================================================================
async function findOverlappingTask(employeeId, periodStart, periodEnd) {
    const { data, error } = await dbClient
        .from('tasks')
        .select('id, title, start_date, due_date')
        .eq('assigned_to', Number(employeeId))
        .gte('due_date', periodStart);
    if (error) throw new Error(error.message);

    return (data || []).find(t => (t.start_date || t.due_date) <= periodEnd) || null;
}

async function validateAssignmentPeriod(employeeId, companyId, periodStart, periodEnd) {
    // 1) فترة الربط بالشركة
    const employees = employeeLinksByCompanyId.get(companyId) || [];
    const empInfo = employees.find(e => String(e.employee_id) === String(employeeId));
    if (empInfo) {
        if (empInfo.link_date && periodStart < empInfo.link_date) {
            return { ok: false, message: `الموظف غير مرتبط بالشركة إلا اعتباراً من ${empInfo.link_date}، لا يمكن إسناد مهمة قبل هذا التاريخ.` };
        }
        if (empInfo.link_end_date && periodEnd > empInfo.link_end_date) {
            return { ok: false, message: `انتهى ربط الموظف بالشركة بتاريخ ${empInfo.link_end_date}، لا يمكن إسناد مهمة بفترة تتجاوز هذا التاريخ.` };
        }
    }

    // 2) أيام الغياب/الإجازة السنوية ضمن الفترة
    const { data: absenceRows, error: absError } = await dbClient
        .from('attendance')
        .select('date, status')
        .eq('employee_id', Number(employeeId))
        .in('status', ABSENCE_STATUSES)
        .gte('date', periodStart)
        .lte('date', periodEnd)
        .limit(1);
    if (absError) throw new Error(absError.message);
    if (absenceRows && absenceRows.length > 0) {
        return { ok: false, message: `يوجد يوم غياب/إجازة سنوية مسجَّل لهذا الموظف بتاريخ ${absenceRows[0].date}، ضمن فترة المهمة المحددة.` };
    }

    // 3) تعارض مع مهمة أخرى مُسندة له مسبقاً
    const overlap = await findOverlappingTask(employeeId, periodStart, periodEnd);
    if (overlap) {
        return { ok: false, message: `الموظف مُسند إليه بالفعل مهمة "${overlap.title}" بفترة تتقاطع مع هذه (${overlap.start_date || overlap.due_date} ← ${overlap.due_date}). يمكن إسناد المهمة بتاريخ بعد انتهاء تلك المهمة مباشرة.` };
    }

    return { ok: true };
}

// =========================================================================
// 3. أدوات مساعدة لعرض شريط التنبيه ورسائل الحقول
// =========================================================================
function showFormAlert(message, type) {
    const alertBox = document.getElementById('formAlert');
    alertBox.textContent = message;
    alertBox.className = 'form-alert ' + (type === 'success' ? 'alert-success' : 'alert-error');
    alertBox.style.display = 'flex';
    alertBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function hideFormAlert() {
    document.getElementById('formAlert').style.display = 'none';
}
function setFieldError(fieldName, message) {
    const group = document.getElementById('group-' + fieldName);
    const errorEl = document.getElementById('error-' + fieldName);
    if (!group || !errorEl) return;
    if (message) { group.classList.add('has-error'); errorEl.textContent = message; }
    else { group.classList.remove('has-error'); errorEl.textContent = ''; }
}

// =========================================================================
// 4. ربط الأحداث + الحفظ
//    🔒 التحكم بالوصول للصفحة بأكملها وبإظهار زر "حفظ المهمة" أصبح الآن عبر
//    محرك الصلاحيات الموحّد (permissions.js — Permissions.guardPage / data-perm).
// =========================================================================
document.addEventListener('DOMContentLoaded', async () => {
    const allowed = await Permissions.guardPage('tasks');
    if (!allowed) return;

    await loadCurrentUserScope();
    await loadCompaniesForCombobox();

    document.getElementById('btnCancel').addEventListener('click', () => {
        if (confirm('هل أنت متأكد من إلغاء العملية؟ لن يتم حفظ البيانات.')) {
            window.location.href = Routes.url('tasks');
        }
    });

    const form = document.getElementById('addTaskForm');
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        hideFormAlert();

        const title = document.getElementById('taskTitle').value.trim();
        const notes = document.getElementById('taskNotes').value.trim();
        const type = document.getElementById('taskType').value;
        const status = document.getElementById('taskStatus').value;
        const companyId = document.getElementById('taskCompanyId').value;
        const assignedTo = document.getElementById('taskAssignedTo').value;
        const startDate = document.getElementById('taskStartDate').value;
        const dueDate = document.getElementById('taskDueDate').value;

        ['company_id', 'title', 'start_date', 'due_date'].forEach(f => setFieldError(f, null));
        let hasError = false;

        if (!title) { setFieldError('title', 'الرجاء إدخال عنوان المهمة.'); hasError = true; }
        if (!companyId) { setFieldError('company_id', 'الرجاء اختيار الشركة.'); hasError = true; }
        // فترة المهمة (على الأقل "من تاريخ") إلزامية فقط عند إسناد المهمة لموظف —
        // لازمة لفحص تعارضها مع فترات مهامه الأخرى وفترة ربطه وأيام غيابه
        if (assignedTo && !startDate) { setFieldError('start_date', 'الرجاء تحديد "من تاريخ" عند إسناد المهمة لموظف.'); hasError = true; }
        if (startDate && dueDate && startDate > dueDate) { setFieldError('due_date', 'يجب أن يكون "إلى تاريخ" بعد "من تاريخ" أو يساويه.'); hasError = true; }

        if (hasError) {
            showFormAlert('الرجاء تصحيح الحقول المظللة أدناه.', 'error');
            return;
        }

        const submitBtn = form.querySelector('.btn-submit');
        const originalText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = 'جاري الحفظ...';

        try {
            // 📌 إن لم يُحدَّد تاريخ للمهمة (لعدم إسنادها لموظف)، يُعتمَد تاريخ اليوم
            // كتاريخ استحقاق افتراضي بدل تركه فارغاً. ثم يُسجَّل created_at دائماً
            // بنفس قيمة due_date نفسها حتى يتطابق ترتيب المهام حسب created_at مع
            // ترتيبها حسب تاريخ الاستحقاق الفعلي.
            const todayIsoDate = new Date().toISOString().slice(0, 10);
            const effectiveStartDate = startDate || null;
            const effectiveDueDate = dueDate || startDate || todayIsoDate;

            if (assignedTo) {
                const validation = await validateAssignmentPeriod(assignedTo, companyId, effectiveStartDate, effectiveDueDate);
                if (!validation.ok) {
                    setFieldError('start_date', validation.message);
                    showFormAlert('تعذّر إسناد المهمة: ' + validation.message, 'error');
                    submitBtn.disabled = false;
                    submitBtn.textContent = originalText;
                    return;
                }
            }

            const payload = {
                title,
                type,
                status,
                company_id: Number(companyId),
                assigned_to: assignedTo ? Number(assignedTo) : null,
                start_date: effectiveStartDate,
                due_date: effectiveDueDate,
                created_at: effectiveDueDate,
                notes: notes || null
            };

            const { error } = await dbClient.from('tasks').insert(payload);
            if (error) throw new Error(error.message);

            showFormAlert('تم إنشاء المهمة بنجاح! جاري التحويل...', 'success');
            setTimeout(() => { window.location.href = Routes.url('tasks'); }, 1200);

        } catch (error) {
            console.error('Task Creation Error:', error);
            showFormAlert('فشلت العملية: ' + error.message, 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
        }
    });
});