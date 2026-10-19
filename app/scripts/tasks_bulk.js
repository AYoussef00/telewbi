// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================

let companiesOptionsCache = [];
let currentUserScope = { role: null, companyIds: null };
let currentCompanyEmployees = []; // [{employee_id, name, job_title, link_date, link_end_date}] للشركة المختارة حالياً

// حالات الحضور التي تُعتبر "يوم حضور فعلي" عند التوليد التلقائي للمهام —
// الغياب والإجازة السنوية لا تُحتسب، فقط الحضور الفعلي (حاضر) أو المتأخر
// (متأخر يعني الموظف حضر فعلياً رغم التأخير)
const ATTENDED_STATUSES = ['حاضر', 'متأخر'];

// حالات الحضور التي تُعتبر "غياب" — لا يجوز إسناد مهمة (بالوضع اليدوي) لموظف
// خلال فترة تتضمن يوماً مسجَّلاً بإحدى هاتين الحالتين
const ABSENCE_STATUSES = ['غائب', 'إجازة سنوية'];

// الحد الأقصى لعدد الأيام المتتالية للمهمة الواحدة عند التوليد التلقائي —
// أي سلسلة أيام حضور متتالية أطول من ذلك تُقسَّم لعدة مهام متتالية بحد أقصى
// هذا العدد لكل مهمة
const MAX_AUTO_TASK_PERIOD_DAYS = 4;

// عدد المهام التي تبقى "قيد الانتظار" عشوائياً ضمن كل عملية توليد تلقائي
// (البقية جميعها تُنشأ مباشرة بحالة "مكتملة") — محاكاة واقعية لسجل مهام حقيقي
const RANDOM_PENDING_MIN = 3;
const RANDOM_PENDING_MAX = 4;

// خلط عشوائي لمصفوفة (Fisher-Yates) — يُستخدم لاختيار المهام العشوائية
// التي تبقى "قيد الانتظار" من إجمالي المهام المولّدة
function shuffleArray(arr) {
    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

// =========================================================================
// 📅 تقسيم مصفوفة تواريخ مُرتَّبة تصاعدياً (نصوص ISO "YYYY-MM-DD") إلى مجموعات
// من أيام متتالية فقط (انقطاع يوم واحد على الأقل بين تاريخين يبدأ مجموعة
// جديدة)، بحد أقصى maxDays يوماً لكل مجموعة — تُستخدم بالتوليد التلقائي
// لتحويل أيام الحضور الفردية إلى مهام تغطي فترات متتالية بدل مهمة يومية واحدة.
// =========================================================================
function chunkConsecutiveDates(sortedDates, maxDays) {
    const chunks = [];
    let current = [];
    for (const dateStr of sortedDates) {
        if (current.length === 0) {
            current.push(dateStr);
        } else {
            const prevDate = new Date(current[current.length - 1] + 'T00:00:00');
            const curDate = new Date(dateStr + 'T00:00:00');
            const diffDays = Math.round((curDate - prevDate) / 86400000);
            if (diffDays === 1 && current.length < maxDays) {
                current.push(dateStr);
            } else {
                chunks.push(current);
                current = [dateStr];
            }
        }
    }
    if (current.length) chunks.push(current);
    return chunks;
}

// =========================================================================
// 🛡️ نفس منطق نطاق الرؤية المستخدم بشاشة "إدارة المهام": مسؤول الشركة
// (role='company') يمكنه فقط إسناد مهام لموظفي شركته/شركاته المملوكة
// =========================================================================
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
// 2. مكوّن قائمة قابلة للبحث (Searchable Combobox) — اختيار الشركة حصرياً
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

async function loadCompaniesForCombobox() {
    companyCombobox = setupSearchableCombobox({
        inputId: 'bulkTaskCompanySearch',
        hiddenId: 'bulkTaskCompanyId',
        dropdownId: 'bulkTaskCompanyDropdown',
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

        companiesOptionsCache = (data || []).map(c => ({ value: String(c.id), label: c.name || '----' }));
        companyCombobox.setOptions(companiesOptionsCache);
        companyCombobox.enable(companiesOptionsCache.length ? 'ابحث عن شركة...' : 'لا توجد شركات مضافة بعد');

        // لو مسؤول الشركة يملك شركة واحدة فقط، اخترها تلقائياً وحمّل موظفيها مباشرة
        if (currentUserScope.companyIds && companiesOptionsCache.length === 1) {
            const only = companiesOptionsCache[0];
            document.getElementById('bulkTaskCompanyId').value = only.value;
            document.getElementById('bulkTaskCompanySearch').value = only.label;
            handleCompanySelected(only.value);
        }
    } catch (error) {
        console.error('تعذّر تحميل قائمة الشركات:', error.message);
        document.getElementById('bulkTaskCompanySearch').placeholder = 'تعذّر تحميل القائمة';
    }
}

// =========================================================================
// 3. جلب موظفي الشركة المختارة (عبر employee_links) وعرضهم كشرائح قابلة للتحديد
//    نجلب أيضاً تاريخ الربط وتاريخ انتهاء الربط لكل موظف (وليس فقط اسمه
//    ومسمّاه الوظيفي)، لاستخدامهما لاحقاً في تحديد الفترة الصحيحة لتوليد
//    المهام التلقائي، وكذلك في التحقق من صحة فترة الإسناد بالوضع اليدوي:
//    لا تُسنَد مهام لأي موظف خارج فترة ربطه الفعلية بالشركة.
// =========================================================================
async function handleCompanySelected(companyId) {
    const listContainer = document.getElementById('employeesPickerList');
    const searchInput = document.getElementById('employeesPickerSearch');
    const selectAllCheckbox = document.getElementById('selectAllEmployeesCheckbox');

    listContainer.innerHTML = `<p class="employees-picker-empty">جاري تحميل موظفي الشركة...</p>`;
    searchInput.disabled = true;
    selectAllCheckbox.disabled = true;
    selectAllCheckbox.checked = false;

    try {
        const { data, error } = await dbClient
            .from('employee_links')
            .select('employee_id, job_title, link_date, link_end_date, employees(id, name)')
            .eq('company_id', companyId);
        if (error) throw new Error(error.message);

        currentCompanyEmployees = (data || [])
            .filter(row => row.employees)
            .map(row => ({
                employee_id: row.employees.id,
                name: row.employees.name,
                job_title: row.job_title || '',
                link_date: row.link_date || null,
                link_end_date: row.link_end_date || null
            }))
            .sort((a, b) => a.name.localeCompare(b.name, 'ar'));

        if (currentCompanyEmployees.length === 0) {
            listContainer.innerHTML = `<p class="employees-picker-empty">لا يوجد موظفون مرتبطون بهذه الشركة. اربط الموظفين بها أولاً من شاشة "ربط الموظفين".</p>`;
            return;
        }

        listContainer.innerHTML = currentCompanyEmployees.map(emp => `
            <label class="employee-picker-chip" data-emp-name="${emp.name.toLowerCase()}">
                <input type="checkbox" class="employee-picker-checkbox" value="${emp.employee_id}">
                <span class="chip-box"></span>
                <span class="chip-text">${emp.name}</span>
                ${emp.job_title ? `<span class="chip-job-title">— ${emp.job_title}</span>` : ''}
            </label>
        `).join('');

        wireEmployeeChipsToggle();
        searchInput.disabled = false;
        searchInput.value = '';
        selectAllCheckbox.disabled = false;

    } catch (error) {
        console.error('تعذّر تحميل موظفي الشركة:', error.message);
        listContainer.innerHTML = `<p class="employees-picker-empty">تعذّر تحميل الموظفين: ${error.message}</p>`;
    }
}

function wireEmployeeChipsToggle() {
    document.querySelectorAll('.employee-picker-chip').forEach(chip => {
        const checkbox = chip.querySelector('input[type="checkbox"]');
        const syncActive = () => chip.classList.toggle('active', checkbox.checked);
        syncActive();
        checkbox.addEventListener('change', syncActive);
    });
}

function getSelectedEmployeeIds() {
    return Array.from(document.querySelectorAll('.employee-picker-checkbox:checked')).map(cb => Number(cb.value));
}

// =========================================================================
// 3ب. وضع "التوليد التلقائي حسب الحضور": تبديل ظهور الحقول المرتبطة
//     (العنوان/الملاحظات/النوع/الحالة تُخفى بالكامل لأنها تُحسب تلقائياً)
// =========================================================================
function isAutoGenerateMode() {
    return document.getElementById('bulkTaskAutoGenerate').checked;
}

function applyAutoGenerateModeUI() {
    const isAuto = isAutoGenerateMode();

    document.getElementById('autoGenerateBox').classList.toggle('active', isAuto);

    document.getElementById('titleFieldRow').style.display = isAuto ? 'none' : '';
    document.getElementById('descriptionFieldRow').style.display = isAuto ? 'none' : '';
    document.getElementById('typeStatusFieldRow').style.display = isAuto ? 'none' : '';

    if (isAuto) {
        setFieldError('title', null);
        document.getElementById('bulkTaskTitle').value = '';
    }

    document.getElementById('rangeSectionTitle').classList.toggle('required-in-auto-mode', isAuto);
    // 📌 "من تاريخ" أصبح إلزامياً بكلا الوضعين: اختيار موظف واحد على الأقل
    // إلزامي أصلاً بهذه الشاشة (على عكس شاشة "إضافة مهمة جديدة" التي يكون
    // فيها الإسناد اختيارياً)، وبما أن الإسناد يحدث دائماً هنا فلا بد من
    // فترة فعلية للتحقق من عدم تعارضها مع مهام الموظفين الحاليين.
    document.getElementById('dueDateOptionalTag').textContent = isAuto ? '(إلزامي)' : '(اختياري)';
}

// =========================================================================
// 4. ربط الأحداث + التحقق + الحفظ الجماعي
//    🔒 التحكم بالوصول للصفحة بأكملها وبإظهار زر "متابعة" أصبح الآن عبر
//    محرك الصلاحيات الموحّد (permissions.js — Permissions.guardPage / data-perm).
// =========================================================================
document.addEventListener('DOMContentLoaded', async () => {
    const allowed = await Permissions.guardPage('tasks');
    if (!allowed) return;

    await loadCurrentUserScope();

    // 🛡️ حماية فعلية (وليست مجرد إخفاء زر) بمعزل عن نظام صلاحيات menus:
    // مسؤول الشركة لا يجب أن يستخدم "إضافة مهام متعددة" حتى لو وصل لهذا
    // الرابط مباشرة عبر العنوان (وليس فقط عبر زر tasks.html المُخفى عنه).
    // انظر التعليق المطابق بـ tasks.js عند applyCompanyRoleTasksUiRestrictions().
    if (currentUserScope.role === 'company') {
        renderPermissionsUnauthorizedView();
        return;
    }

    await loadCompaniesForCombobox();

    document.getElementById('bulkTaskAutoGenerate').addEventListener('change', applyAutoGenerateModeUI);
    applyAutoGenerateModeUI();

    document.getElementById('btnCancel').addEventListener('click', () => {
        if (confirm('هل أنت متأكد من إلغاء العملية؟ لن يتم حفظ أي بيانات.')) {
            window.location.href = Routes.url('tasks');
        }
    });

    document.getElementById('selectAllEmployeesCheckbox').addEventListener('change', (e) => {
        const visibleCheckboxes = document.querySelectorAll('.employee-picker-chip:not(.hidden-by-search) .employee-picker-checkbox');
        visibleCheckboxes.forEach(cb => {
            cb.checked = e.target.checked;
            cb.dispatchEvent(new Event('change'));
        });
    });

    document.getElementById('employeesPickerSearch').addEventListener('input', (e) => {
        const query = e.target.value.trim().toLowerCase();
        document.querySelectorAll('.employee-picker-chip').forEach(chip => {
            const matches = !query || chip.getAttribute('data-emp-name').includes(query);
            chip.classList.toggle('hidden-by-search', !matches);
        });
    });

    const form = document.getElementById('bulkTaskForm');
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        hideFormAlert();

        const isAuto = isAutoGenerateMode();
        const companyId = document.getElementById('bulkTaskCompanyId').value;
        const title = document.getElementById('bulkTaskTitle').value.trim();
        const description = document.getElementById('bulkTaskDescription').value.trim();
        const type = document.getElementById('bulkTaskType').value;
        const status = document.getElementById('bulkTaskStatus').value;
        const startDate = document.getElementById('bulkTaskStartDate').value;
        const dueDate = document.getElementById('bulkTaskDueDate').value;
        const selectedEmployeeIds = getSelectedEmployeeIds();

        ['company_id', 'title', 'employees', 'start_date', 'due_date'].forEach(f => setFieldError(f, null));
        let hasError = false;

        if (!companyId) { setFieldError('company_id', 'الرجاء اختيار الشركة.'); hasError = true; }
        if (!isAuto && !title) { setFieldError('title', 'الرجاء إدخال عنوان المهمة.'); hasError = true; }
        if (selectedEmployeeIds.length === 0) { setFieldError('employees', 'الرجاء اختيار موظف واحد على الأقل.'); hasError = true; }
        // 📌 "من تاريخ" إلزامي دائماً بهذه الشاشة (الإسناد لموظفين يحدث دائماً)
        if (!startDate) { setFieldError('start_date', 'الرجاء تحديد "من تاريخ" — إلزامي عند إسناد المهمة للموظفين.'); hasError = true; }
        if (isAuto && !dueDate) { setFieldError('due_date', 'فترة المهمة إلزامية في وضع التوليد التلقائي.'); hasError = true; }
        if (startDate && dueDate && startDate > dueDate) { setFieldError('due_date', 'يجب أن يكون "إلى تاريخ" بعد "من تاريخ" أو يساويه.'); hasError = true; }

        if (hasError) {
            showFormAlert('الرجاء تصحيح الحقول المظللة أدناه.', 'error');
            return;
        }

        const submitBtn = form.querySelector('.btn-submit');
        const originalText = submitBtn.textContent;

        if (isAuto) {
            await runAutoGenerateFlow({
                companyId, startDate, dueDate,
                selectedEmployeeIds, submitBtn, originalText
            });
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'جاري التحقق...';

        try {
            const effectiveStartDate = startDate;
            const effectiveDueDate = dueDate || startDate;

            // 🛡️ التحقق من صحة فترة الإسناد لكل الموظفين المحددين قبل أي حفظ:
            // فترة ربطهم بالشركة، أيام الغياب/الإجازة المسجَّلة لهم، وعدم
            // تقاطع الفترة مع أي مهمة أخرى مُسندة لأي منهم مسبقاً (بأي شركة
            // وبأي حالة). إن وُجد أي تعارض لأي موظف، تُرفض الدفعة كاملة —
            // لا تُحفظ أي مهمة جزئياً — ويظهر تنبيه يوضح الموظف والسبب.
            const validation = await validateBulkAssignmentPeriod(selectedEmployeeIds, effectiveStartDate, effectiveDueDate);
            if (!validation.ok) {
                setFieldError('start_date', validation.message);
                showFormAlert('تعذّر إسناد المهام: ' + validation.message, 'error');
                submitBtn.disabled = false;
                submitBtn.textContent = originalText;
                return;
            }

            submitBtn.textContent = 'جاري الحفظ...';

            // 📌 created_at يُسجَّل بنفس قيمة due_date (بدل وقت الحفظ الفعلي)
            // حتى يتطابق ترتيب المهام حسب created_at مع ترتيبها حسب تاريخ
            // الاستحقاق الفعلي بشاشة "إدارة المهام".
            const payloads = selectedEmployeeIds.map(employeeId => ({
                title,
                type,
                status,
                company_id: Number(companyId),
                assigned_to: employeeId,
                start_date: effectiveStartDate,
                due_date: effectiveDueDate,
                created_at: effectiveDueDate,
                notes: description || null
            }));

            const { error: insertError } = await dbClient.from('tasks').insert(payloads);
            if (insertError) throw new Error(insertError.message);

            showFormAlert(`تم إنشاء ${payloads.length} مهمة بنجاح وإسنادها للموظفين المحددين! جاري التحويل...`, 'success');
            setTimeout(() => { window.location.href = Routes.url('tasks'); }, 1500);

        } catch (error) {
            console.error('Bulk Task Creation Error:', error);
            showFormAlert('فشلت العملية: ' + error.message, 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
        }
    });
});

// =========================================================================
// 4ب. 🛡️ التحقق من صحة إسناد فترة موحّدة (من/إلى) لمجموعة موظفين دفعة واحدة
//     (الوضع اليدوي بشاشة "إضافة مهام متعددة") — يُطابق نفس منطق التحقق
//     المستخدم بشاشة "إضافة مهمة جديدة" (validateAssignmentPeriod)، لكنه
//     يفحص كل الموظفين المحددين بأقل عدد ممكن من الاستعلامات (استعلام واحد
//     للغياب واستعلام واحد للمهام المتقاطعة يغطيان كل الموظفين معاً)، ويوقف
//     العملية عند أول تعارض يجده لأي موظف.
//
//     ⚠️ لا تُعدَّل أو تُفحَص أي مهام/بيانات قديمة بهذا التحقق — يُستخدم فقط
//     لمنع إنشاء تعارض جديد عند الحفظ، ولا يمسّ السجلات الحالية إطلاقاً.
// =========================================================================
async function validateBulkAssignmentPeriod(employeeIds, periodStart, periodEnd) {
    // 1. فترة ربط كل موظف بالشركة (بيانات مُحمَّلة مسبقاً بذاكرة الصفحة، بلا استعلام إضافي)
    for (const empId of employeeIds) {
        const empInfo = currentCompanyEmployees.find(e => String(e.employee_id) === String(empId));
        if (!empInfo) continue;
        if (empInfo.link_date && periodStart < empInfo.link_date) {
            return { ok: false, message: `الموظف "${empInfo.name}" غير مرتبط بالشركة إلا اعتباراً من ${empInfo.link_date}، لا يمكن إسناد مهمة قبل هذا التاريخ.` };
        }
        if (empInfo.link_end_date && periodEnd > empInfo.link_end_date) {
            return { ok: false, message: `انتهى ربط الموظف "${empInfo.name}" بالشركة بتاريخ ${empInfo.link_end_date}، لا يمكن إسناد مهمة بفترة تتجاوز هذا التاريخ.` };
        }
    }

    // 2. أيام الغياب/الإجازة السنوية المسجَّلة لأي من الموظفين المحددين ضمن الفترة (استعلام واحد للجميع)
    const { data: absenceRows, error: absError } = await dbClient
        .from('attendance')
        .select('employee_id, date, status')
        .in('employee_id', employeeIds)
        .in('status', ABSENCE_STATUSES)
        .gte('date', periodStart)
        .lte('date', periodEnd)
        .limit(1);
    if (absError) throw new Error(absError.message);
    if (absenceRows && absenceRows.length > 0) {
        const row = absenceRows[0];
        const empInfo = currentCompanyEmployees.find(e => String(e.employee_id) === String(row.employee_id));
        const empName = empInfo ? empInfo.name : `#${row.employee_id}`;
        return { ok: false, message: `يوجد يوم غياب/إجازة سنوية مسجَّل للموظف "${empName}" بتاريخ ${row.date}، ضمن فترة المهمة المحددة.` };
    }

    // 3. مهام أخرى مُسندة مسبقاً لأي من الموظفين المحددين (بأي شركة وبأي حالة) بفترة تتقاطع مع الفترة المطلوبة
    const { data: existingTasks, error: tasksError } = await dbClient
        .from('tasks')
        .select('id, title, assigned_to, start_date, due_date')
        .in('assigned_to', employeeIds)
        .gte('due_date', periodStart);
    if (tasksError) throw new Error(tasksError.message);

    const overlap = (existingTasks || []).find(t => (t.start_date || t.due_date) <= periodEnd);
    if (overlap) {
        const empInfo = currentCompanyEmployees.find(e => String(e.employee_id) === String(overlap.assigned_to));
        const empName = empInfo ? empInfo.name : `#${overlap.assigned_to}`;
        return { ok: false, message: `الموظف "${empName}" مُسند إليه بالفعل مهمة "${overlap.title}" بفترة تتقاطع مع هذه (${overlap.start_date || overlap.due_date} ← ${overlap.due_date}). يمكن إسناد المهمة بتاريخ بعد انتهاء تلك المهمة مباشرة.` };
    }

    return { ok: true };
}

// =========================================================================
// 5. 🎲 التوليد التلقائي: مهمة عشوائية واحدة من قائمة مهام المسمى الوظيفي
//    عن كل مجموعة أيام حضور فعلي متتالية (حاضر/متأخر) لكل موظف محدد ضمن
//    الفترة المحددة، بحد أقصى MAX_AUTO_TASK_PERIOD_DAYS (4) أيام متتالية
//    لكل مهمة — أي انقطاع بالتتالي (كيوم غياب، أو نهاية فترة الربط، أو مجرد
//    عدم وجود سجل حضور بذلك اليوم) يُنهي المجموعة الحالية ويبدأ مجموعة جديدة.
//
//    ⚠️ الفترة الفعلية المسموح توليد مهام ضمنها لكل موظف = تقاطع الفترة
//    المُدخَلة بالفورم (من/إلى) مع فترة ربط هذا الموظف الفعلية بالشركة
//    تحديداً (من تاريخ ربطه link_date، وحتى تاريخ انتهاء ربطه link_end_date):
//    - أي يوم حضور مسجَّل قبل تاريخ ربط الموظف بالشركة لا يُولَّد له مهمة
//      (لم يكن موظفاً بها بعد أصلاً وقتها).
//    - أي يوم حضور بعد تاريخ انتهاء الربط لا يُولَّد له مهمة أيضاً.
//    - أيام الغياب (غائب/إجازة سنوية) مُستبعدة تماماً من الأساس، لأن مصدر
//      الأيام المؤهلة هو استعلام جدول attendance المُصفَّى مسبقاً على
//      الحالات "حاضر"/"متأخر" فقط (ATTENDED_STATUSES) — وبما أن يوم الغياب
//      لا يظهر أصلاً بقائمة الأيام المرشَّحة، فهو يُشكِّل تلقائياً فجوة
//      تقطع تتالي الأيام وتُنهي المجموعة الحالية عند تجميعها بـ
//      chunkConsecutiveDates، فلا حاجة لأي فحص تعارض إضافي بهذا المسار
//      تحديداً (لا مع الغياب ولا مع فترة الربط ولا مع مهام أخرى — راجع
//      ملاحظة التصميم أدناه).
//
//    قواعد ثابتة بهذا الوضع (لا تُقرأ من الفورم، تُحسب دائماً كالتالي):
//    - النوع: "مسندة" دائماً.
//    - الملاحظات: اسم المسمى الوظيفي لصاحب المهمة (وليس نص حر من المستخدم).
//    - تاريخ المهمة: "من تاريخ" = أول يوم بمجموعة الأيام المتتالية،
//      "إلى تاريخ" = آخر يوم بها (بحد أقصى 4 أيام بالمجموعة الواحدة).
//    - الحالة: "مكتملة" لكل المهام المولّدة، ما عدا 3 أو 4 مهام تُختار
//      عشوائياً من إجمالي الدفعة وتبقى "قيد الانتظار" (محاكاة واقعية).
//    - created_at: يُسجَّل بنفس تاريخ "إلى تاريخ" لكل مهمة (آخر يوم بمجموعتها)
//      بدل وقت التوليد الفعلي، حتى تتوزع المهام المولَّدة بشاشة "إدارة
//      المهام" (المرتبة حسب created_at) على تواريخها الحقيقية بدل التجمّع
//      كلها عند وقت الضغط على زر التوليد.
//
//    📌 فحص التعارض: كل مجموعة أيام متتالية (chunk) تُفحَص مقابل أي مهمة
//    موجودة فعلاً لنفس الموظف (مولَّدة تلقائياً بتشغيل سابق، أو مُسندة يدوياً
//    — بأي شركة وبأي حالة) عبر chunkConflictsWithExisting؛ أي مجموعة تتقاطع
//    فترتها مع مهمة موجودة تُستبعَد بالكامل من التوليد بدل إنشاء مهمة تتقاطع
//    تواريخها مع أخرى (راجع القسم 3ب أعلاه). ⚠️ كان هذا المسار سابقاً لا يفحص
//    أي تعارض إطلاقاً، وهو ما كان يُنتج مهاماً بفترات متقاطعة فعلياً عند
//    تشغيل التوليد التلقائي أكثر من مرة لنفس الموظف/فترة متقاربة — تم إصلاحه.
// =========================================================================
async function runAutoGenerateFlow({ companyId, startDate, dueDate, selectedEmployeeIds, submitBtn, originalText }) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'جاري التحضير...';

    try {
        // 1. موظفو الشركة المحددون فقط (مع مسمّاهم الوظيفي وتواريخ ربطهم المحمَّلة مسبقاً)
        const selectedEmployees = currentCompanyEmployees.filter(emp => selectedEmployeeIds.includes(emp.employee_id));

        // 2. أيام الحضور الفعلي لهؤلاء الموظفين ضمن الفترة المحددة بالفورم (فلترة أولية
        //    عامة على مستوى النطاق الزمني الكامل؛ التقييد الدقيق بفترة ربط كل موظف
        //    تحديداً يتم لاحقاً بالخطوة 4 لكل موظف على حدة)
        const { data: attendanceRows, error: attError } = await dbClient
            .from('attendance')
            .select('employee_id, date, status')
            .in('employee_id', selectedEmployeeIds)
            .in('status', ATTENDED_STATUSES)
            .gte('date', startDate)
            .lte('date', dueDate);
        if (attError) throw new Error(attError.message);

        const attendedDatesByEmployeeId = new Map();
        (attendanceRows || []).forEach(row => {
            if (!attendedDatesByEmployeeId.has(row.employee_id)) attendedDatesByEmployeeId.set(row.employee_id, []);
            attendedDatesByEmployeeId.get(row.employee_id).push(row.date);
        });

        // 3. قوالب المهام الجاهزة (من شاشة "قائمة المهام") لكل مسمى وظيفي مستخدَم بين الموظفين المحددين
        const uniqueJobTitles = Array.from(new Set(selectedEmployees.map(e => e.job_title).filter(Boolean)));
        let templatesByJobTitle = new Map();
        if (uniqueJobTitles.length > 0) {
            const { data: templateRows, error: templatesError } = await dbClient
                .from('job_task_templates')
                .select('job_title, title')
                .in('job_title', uniqueJobTitles);
            if (templatesError) throw new Error(templatesError.message);

            (templateRows || []).forEach(row => {
                if (!templatesByJobTitle.has(row.job_title)) templatesByJobTitle.set(row.job_title, []);
                templatesByJobTitle.get(row.job_title).push(row.title);
            });
        }

        // =====================================================================
        // 3ب. 🛡️ المهام الموجودة مسبقاً لهؤلاء الموظفين (أي شركة، أي حالة) —
        // نفس فكرة التحقق المستخدَم بالوضع اليدوي (validateBulkAssignmentPeriod)
        // لكن مُطبَّقة هنا على كل مجموعة أيام متتالية على حدة بدل فترة واحدة
        // موحّدة، حتى لا يُرفَض التوليد بالكامل بسبب تعارض جزئي بسيط. هذا هو
        // الإصلاح الفعلي لسبب "تداخل التواريخ" بمهام الموظفين: تشغيل التوليد
        // التلقائي أكثر من مرة لنفس الموظف/فترة متقاربة كان يُنتج مهاماً
        // بفترات متقاطعة فعلياً لأن هذا المسار لم يكن يفحص تعارضه مع أي مهمة
        // أخرى (لا مولَّدة تلقائياً سابقاً ولا مُسندة يدوياً) — الآن يُستبعَد
        // أي مجموعة أيام تتقاطع فترتها مع مهمة موجودة فعلاً بدل توليدها.
        // =====================================================================
        const { data: existingTasksRows, error: existingTasksError } = await dbClient
            .from('tasks')
            .select('assigned_to, start_date, due_date')
            .in('assigned_to', selectedEmployeeIds)
            .gte('due_date', startDate);
        if (existingTasksError) throw new Error(existingTasksError.message);

        const existingTasksByEmployeeId = new Map();
        (existingTasksRows || []).forEach(t => {
            if (!existingTasksByEmployeeId.has(t.assigned_to)) existingTasksByEmployeeId.set(t.assigned_to, []);
            existingTasksByEmployeeId.get(t.assigned_to).push({
                start: t.start_date || t.due_date,
                end: t.due_date || t.start_date
            });
        });

        // فترة مجموعة أيام متتالية (chunk) تتعارض مع مهمة موجودة فعلاً لنفس
        // الموظف لو تقاطعت الفترتان (chunkStart ≤ نهاية الموجودة و chunkEnd ≥ بداية الموجودة)
        function chunkConflictsWithExisting(employeeId, chunkStart, chunkEnd) {
            const existingList = existingTasksByEmployeeId.get(employeeId) || [];
            return existingList.some(t => chunkStart <= t.end && t.start <= chunkEnd);
        }

        // 4. بناء سجلات المهام: مهمة واحدة عشوائية لكل مجموعة أيام حضور فعلي متتالية
        //    (بحد أقصى 4 أيام بالمجموعة) لكل موظف، بعد تقييد أيام حضوره بفترة ربطه
        //    الفعلية بالشركة (من link_date وحتى link_end_date) — راجع الشرح
        //    التفصيلي بتعليق القسم رقم 5 أعلاه. النوع ثابت "مسندة"، والملاحظات
        //    هي اسم المسمى الوظيفي، وتاريخ كل مهمة (من/إلى) هو أول/آخر يوم
        //    بمجموعتها (وكذلك created_at = آخر يوم). الحالة تُحسب لاحقاً بعد
        //    تجميع الدفعة كاملة (كلها "مكتملة" ما عدا 3-4 عشوائية).
        const payloads = [];
        let skippedNoAttendance = 0;
        let skippedNoJobTitle = 0;
        let skippedNoTemplates = 0;
        let outsideLinkPeriodDaysSkipped = 0;
        let skippedConflictChunksCount = 0; // 🛡️ عدد مجموعات الأيام المتتالية التي أُلغي توليدها لتعارضها مع مهمة موجودة فعلاً
        let conflictDaysSkipped = 0;        // إجمالي عدد أيام الحضور ضمن هذه المجموعات الملغاة
        let generatedTasksCount = 0;
        let coveredDaysCount = 0;

        selectedEmployees.forEach(emp => {
            const rawAttendedDates = attendedDatesByEmployeeId.get(emp.employee_id) || [];

            // 🛡️ تقييد أيام الحضور المؤهلة للتوليد بفترة ربط هذا الموظف الفعلية:
            // من تاريخ ربطه (link_date) وحتى تاريخ انتهاء ربطه (link_end_date) —
            // أي يوم حضور خارج هذا النطاق (سابق لتاريخ الربط، أو لاحق لتاريخ
            // انتهائه) يُستبعد من التوليد حتى لو كان مسجَّلاً فعلياً بجدول الحضور.
            const attendedDates = rawAttendedDates
                .filter(date =>
                    (!emp.link_date || date >= emp.link_date) &&
                    (!emp.link_end_date || date <= emp.link_end_date)
                )
                .sort();
            outsideLinkPeriodDaysSkipped += (rawAttendedDates.length - attendedDates.length);

            if (attendedDates.length === 0) { skippedNoAttendance++; return; }

            if (!emp.job_title) { skippedNoJobTitle++; return; }

            const templates = templatesByJobTitle.get(emp.job_title) || [];
            if (templates.length === 0) { skippedNoTemplates++; return; }

            // 📅 تقسيم أيام الحضور المؤهلة لهذا الموظف إلى مجموعات متتالية،
            // بحد أقصى MAX_AUTO_TASK_PERIOD_DAYS يوماً لكل مجموعة — مهمة واحدة لكل مجموعة
            const chunks = chunkConsecutiveDates(attendedDates, MAX_AUTO_TASK_PERIOD_DAYS);

            chunks.forEach(chunk => {
                const chunkStart = chunk[0];
                const chunkEnd = chunk[chunk.length - 1];

                // 🛡️ تخطَّ هذه المجموعة كاملة لو تعارضت فترتها مع مهمة موجودة
                // فعلاً لهذا الموظف (سواء مولَّدة تلقائياً بتشغيل سابق، أو
                // مُسندة يدوياً) — بدل توليد مهمة تتقاطع تواريخها مع أخرى
                if (chunkConflictsWithExisting(emp.employee_id, chunkStart, chunkEnd)) {
                    skippedConflictChunksCount++;
                    conflictDaysSkipped += chunk.length;
                    return;
                }

                const randomTitle = templates[Math.floor(Math.random() * templates.length)];
                payloads.push({
                    title: randomTitle,
                    type: 'مسندة',
                    status: 'مكتملة',
                    company_id: Number(companyId),
                    assigned_to: emp.employee_id,
                    start_date: chunkStart,
                    due_date: chunkEnd,
                    created_at: chunkEnd,
                    notes: emp.job_title
                });
                generatedTasksCount++;
                coveredDaysCount += chunk.length;
            });
        });

        if (payloads.length === 0) {
            let reason = 'لم يتم توليد أي مهمة.';
            const notes = [];
            if (skippedNoAttendance > 0) notes.push(`${skippedNoAttendance} موظف بلا أيام حضور فعلي مؤهلة (إما بلا حضور إطلاقاً، أو كل أيام حضوره خارج فترة ربطه بالشركة)`);
            if (skippedNoJobTitle > 0) notes.push(`${skippedNoJobTitle} موظف بلا مسمى وظيفي مسجَّل`);
            if (skippedNoTemplates > 0) notes.push(`${skippedNoTemplates} موظف لا توجد مهام جاهزة لمسمّاه الوظيفي بقائمة المهام`);
            if (skippedConflictChunksCount > 0) notes.push(`${skippedConflictChunksCount} فترة تعارضت بالكامل مع مهام موجودة فعلاً لنفس الموظفين`);
            if (notes.length > 0) reason += ' السبب: ' + notes.join(' و') + '.';
            showFormAlert(reason, 'error');
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
            return;
        }

        // 4ب. اختيار 3 أو 4 مهام عشوائياً من إجمالي الدفعة لتبقى "قيد الانتظار"
        //     (البقية تبقى بحالتها الافتراضية "مكتملة" التي بُنيت بها أعلاه)
        const pendingCount = Math.min(payloads.length, Math.random() < 0.5 ? RANDOM_PENDING_MIN : RANDOM_PENDING_MAX);
        const pendingIndexes = shuffleArray(payloads.map((_, idx) => idx)).slice(0, pendingCount);
        pendingIndexes.forEach(idx => { payloads[idx].status = 'قيد الانتظار'; });

        // 5. تأكيد المستخدم قبل التوليد الفعلي
        const skippedNotes = [];
        if (skippedNoAttendance > 0) skippedNotes.push(`${skippedNoAttendance} موظف بلا حضور مؤهل`);
        if (skippedNoJobTitle > 0) skippedNotes.push(`${skippedNoJobTitle} موظف بلا مسمى وظيفي`);
        if (skippedNoTemplates > 0) skippedNotes.push(`${skippedNoTemplates} موظف بلا مهام جاهزة لمسمّاه`);
        if (outsideLinkPeriodDaysSkipped > 0) skippedNotes.push(`${outsideLinkPeriodDaysSkipped} يوم حضور تم تجاهله لوقوعه خارج فترة ربط الموظف بالشركة`);
        if (skippedConflictChunksCount > 0) skippedNotes.push(`${skippedConflictChunksCount} فترة (${conflictDaysSkipped} يوم) تم تجاهلها لتعارضها مع مهمة موجودة فعلاً لنفس الموظف`);
        const skippedNote = skippedNotes.length ? ` (تم تجاهل: ${skippedNotes.join('، ')})` : '';
        const confirmMsg = `سيتم توليد ${payloads.length} مهمة تلقائياً تغطي ${coveredDaysCount} يوم حضور فعلي إجمالاً (بحد أقصى ${MAX_AUTO_TASK_PERIOD_DAYS} أيام متتالية لكل مهمة، ضمن فترة ربط كل موظف الفعلية بالشركة فقط)، بحالة "مكتملة" ما عدا ${pendingCount} مهمة عشوائية ستبقى "قيد الانتظار"${skippedNote}. هل تريد المتابعة؟`;
        if (!confirm(confirmMsg)) {
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
            return;
        }

        submitBtn.textContent = 'جاري التوليد والحفظ...';

        const CHUNK_SIZE = 500;
        for (let i = 0; i < payloads.length; i += CHUNK_SIZE) {
            const chunk = payloads.slice(i, i + CHUNK_SIZE);
            const { error: insertError } = await dbClient.from('tasks').insert(chunk);
            if (insertError) throw new Error(insertError.message);
        }

        showFormAlert(`تم توليد ${payloads.length} مهمة بنجاح (${pendingCount} منها قيد الانتظار والباقي مكتملة)!${skippedNote} جاري التحويل...`, 'success');
        setTimeout(() => { window.location.href = Routes.url('tasks'); }, 1800);

    } catch (error) {
        console.error('Auto Task Generation Error:', error);
        showFormAlert('فشلت العملية: ' + error.message, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
    }
}

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