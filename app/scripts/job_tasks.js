// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================

let fullJobTasksDataset = [];

// =========================================================================
// 🛡️ حماية فعلية (وليست مجرد إخفاء زر) بمعزل عن نظام صلاحيات menus:
// مسؤول الشركة لا يجب أن يستخدم "قائمة المهام" (قوالب مهام المسميات
// الوظيفية) حتى لو وصل لهذا الرابط مباشرة عبر العنوان — وليس فقط عبر زر
// tasks.html المُخفى عنه. هذا الملف لا يملك أصلاً أي بنية currentUserScope
// (لا يحتاجها لباقي وظائفه)، لذا هذه دالة صغيرة مستقلة تجلب الدور فقط
// وتُستخدم مرة واحدة عند تحميل الصفحة.
// =========================================================================
async function blockCompanyRoleFromJobTasksPage() {
    try {
        const { data: { session } } = await dbClient.auth.getSession();
        if (!session) return false;
        const { data: profileRow } = await dbClient.from('users').select('role').eq('id', session.user.id).maybeSingle();
        if (profileRow?.role === 'company') {
            renderPermissionsUnauthorizedView();
            return true;
        }
        return false;
    } catch (error) {
        console.error('تعذّر التحقق من دور المستخدم الحالي (قائمة المهام):', error.message);
        return false;
    }
}

// إعدادات تقسيم الصفحات: 20 سطر مهمة لكل صفحة (لا تُحتسب صفوف ترويسة المجموعات ضمن العدّ)
let currentJobTasksPage = 1;
const JOB_TASKS_ROWS_PER_PAGE = 20;

// =========================================================================
// 2. مكوّن قائمة قابلة للبحث (Searchable Combobox) — المسمى الوظيفي
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

let jobTitleCombobox = null;

// المسميات الوظيفية تُحمَّل من جدول professions (نفس مصدر شاشة "ربط الموظفين")
async function loadJobTitlesForCombobox() {
    jobTitleCombobox = setupSearchableCombobox({
        inputId: 'jobTaskJobTitleSearch',
        hiddenId: 'jobTaskJobTitle',
        dropdownId: 'jobTaskJobTitleDropdown',
        options: [],
        emptyText: 'لا توجد مسميات وظيفية مطابقة'
    });

    try {
        const { data, error } = await dbClient.from('professions').select('name_ar').order('name_ar', { ascending: true });
        if (error) throw new Error(error.message);

        const options = (data || []).map(p => ({ value: p.name_ar, label: p.name_ar }));
        jobTitleCombobox.setOptions(options);
        jobTitleCombobox.enable(options.length ? 'ابحث أو اختر المسمى الوظيفي' : 'لا توجد مسميات وظيفية مضافة بعد');

        // نُغذّي أيضاً قائمة فلترة الجدول أسفل الصفحة بنفس المسميات
        const filterSelect = document.getElementById('jobTaskFilterSelect');
        options.forEach(opt => {
            const optionEl = document.createElement('option');
            optionEl.value = opt.value;
            optionEl.textContent = opt.label;
            filterSelect.appendChild(optionEl);
        });
    } catch (error) {
        console.error('تعذّر تحميل المسميات الوظيفية:', error.message);
        document.getElementById('jobTaskJobTitleSearch').placeholder = 'تعذّر تحميل القائمة';
    }
}

// =========================================================================
// 3. أسطر المهام القابلة للإضافة/الحذف ديناميكياً
// =========================================================================
function createTaskLineRow(value) {
    const row = document.createElement('div');
    row.className = 'task-line-row';
    row.innerHTML = `
        <input type="text" class="task-line-input" placeholder="مثال: مراجعة تقرير المبيعات اليومي" value="${value ? value.replace(/"/g, '&quot;') : ''}">
        <button type="button" class="btn-remove-task-line" title="حذف السطر">×</button>
    `;
    row.querySelector('.btn-remove-task-line').addEventListener('click', () => {
        const container = document.getElementById('taskLinesContainer');
        if (container.children.length > 1) {
            row.remove();
        } else {
            row.querySelector('.task-line-input').value = '';
        }
    });
    return row;
}

function addTaskLineRow() {
    const container = document.getElementById('taskLinesContainer');
    container.appendChild(createTaskLineRow(''));
}

function getTaskLineValues() {
    return Array.from(document.querySelectorAll('.task-line-input'))
        .map(input => input.value.trim())
        .filter(val => val.length > 0);
}

function resetTaskLines() {
    const container = document.getElementById('taskLinesContainer');
    container.innerHTML = '';
    container.appendChild(createTaskLineRow(''));
}

// =========================================================================
// 4. جلب المهام المحفوظة وعرضها في الجدول — مُجمَّعة حسب المسمى الوظيفي
//    (صف ترويسة لكل مسمى وظيفي يعرض اسمه وعدد مهامه، تليه أسطر مهامه)،
//    مع تقسيم صفحات: 20 سطر مهمة لكل صفحة، وأزرار "التالية/السابقة" أسفل الجدول
// =========================================================================
async function loadJobTasksTable() {
    const tableBody = document.getElementById('jobTasksTableBody');
    tableBody.innerHTML = `<tr><td colspan="3" class="table-loading-state">جاري تحميل المهام...</td></tr>`;

    try {
        const { data, error } = await dbClient
            .from('job_task_templates')
            .select('*')
            .order('job_title', { ascending: true })
            .order('created_at', { ascending: false });
        if (error) throw error;

        fullJobTasksDataset = data || [];
        currentJobTasksPage = 1;
        renderJobTasksTable();
    } catch (error) {
        console.error('تعذّر تحميل قائمة المهام:', error.message);
        tableBody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#ef4444; padding:20px;">تعذّر تحميل المهام: ${error.message}</td></tr>`;
    }
}

// =========================================================================
// 🔒 أزرار "حذف" لكل سطر مهمة تحمل الآن data-perm="delete:tasks" (مخفية
// بالكامل عبر CSS إلى أن يؤكد محرك الصلاحيات — permissions.js — امتلاك
// المستخدم الحالي لهذا الإجراء)، لذا نستدعي Permissions.applyButtonGating
// (tableBody) يدوياً بعد كل حقن HTML جديد بالجدول، ليغطي هذا الاستدعاء
// الواحد كل عمليات إعادة العرض (فلترة/تقليب صفحات).
// =========================================================================
function renderJobTasksTable() {
    const tableBody = document.getElementById('jobTasksTableBody');
    const filterValue = document.getElementById('jobTaskFilterSelect').value;

    const filtered = filterValue === 'all'
        ? fullJobTasksDataset
        : fullJobTasksDataset.filter(t => t.job_title === filterValue);

    if (filtered.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding:30px; color:#94a3b8;">لا توجد مهام محفوظة بعد. أضف مهاماً من النموذج أعلاه.</td></tr>`;
        setupJobTasksPaginationControls(0);
        return;
    }

    // تقسيم الصفحات: 20 سطر مهمة (وليس صف ترويسة) لكل صفحة
    const startIndex = (currentJobTasksPage - 1) * JOB_TASKS_ROWS_PER_PAGE;
    const endIndex = startIndex + JOB_TASKS_ROWS_PER_PAGE;
    const paginatedTasks = filtered.slice(startIndex, endIndex);

    // 🗂️ تجميع مهام الصفحة الحالية فقط حسب المسمى الوظيفي — البيانات مرتبة
    // أصلاً حسب job_title بالاستعلام، فتُبنى المجموعات بترتيب الظهور نفسه
    // بلا حاجة لفرز إضافي (إن امتدت مهام مسمى وظيفي واحد عبر صفحتين، يظهر
    // صف ترويسة له في كل صفحة تحتوي جزءاً من مهامه)
    const groupsByJobTitle = new Map();
    paginatedTasks.forEach(task => {
        if (!groupsByJobTitle.has(task.job_title)) groupsByJobTitle.set(task.job_title, []);
        groupsByJobTitle.get(task.job_title).push(task);
    });

    let html = '';
    groupsByJobTitle.forEach((tasks, jobTitle) => {
        html += `
            <tr class="job-tasks-group-header-row">
                <td colspan="3">
                    <span class="job-tasks-group-title">${jobTitle}</span>
                    <span class="job-tasks-group-count">${tasks.length} مهمة</span>
                </td>
            </tr>
        `;

        html += tasks.map(task => {
            const createdDate = task.created_at ? new Date(task.created_at).toLocaleDateString('ar-SA') : '----';
            return `
                <tr class="job-tasks-data-row">
                    <td class="job-tasks-title-cell">${task.title}</td>
                    <td style="color:#64748b;">${createdDate}</td>
                    <td style="text-align:center;">
                        <button type="button" class="btn-delete-job-task" data-perm="delete:tasks" title="حذف" onclick="deleteJobTaskTemplate(${task.id})">🗑️</button>
                    </td>
                </tr>
            `;
        }).join('');
    });

    tableBody.innerHTML = html;
    if (window.Permissions) Permissions.applyButtonGating(tableBody);
    setupJobTasksPaginationControls(filtered.length);
}

// =========================================================================
// 4ب. أزرار التنقل بين صفحات الجدول (أسفل الجدول مباشرة)
// =========================================================================
function setupJobTasksPaginationControls(totalItems) {
    const controlsContainer = document.getElementById('jobTasksPagination');
    if (!controlsContainer) return;
    controlsContainer.innerHTML = '';

    const totalPages = Math.ceil(totalItems / JOB_TASKS_ROWS_PER_PAGE);
    if (totalPages <= 1) return;

    const prevBtn = document.createElement('button');
    prevBtn.innerHTML = '&rarr; السابقة';
    prevBtn.disabled = currentJobTasksPage === 1;
    prevBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;';
    if (prevBtn.disabled) prevBtn.style.opacity = '0.5';
    prevBtn.onclick = () => {
        if (currentJobTasksPage > 1) {
            currentJobTasksPage--;
            renderJobTasksTable();
        }
    };
    controlsContainer.appendChild(prevBtn);

    const countLabel = document.createElement('span');
    countLabel.style.cssText = 'font-size: 0.9rem; color: #475569; font-weight: 600; margin: 0 10px;';
    countLabel.textContent = `صفحة ${currentJobTasksPage} من ${totalPages}`;
    controlsContainer.appendChild(countLabel);

    const nextBtn = document.createElement('button');
    nextBtn.innerHTML = 'التالية &larr;';
    nextBtn.disabled = currentJobTasksPage === totalPages;
    nextBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;';
    if (nextBtn.disabled) nextBtn.style.opacity = '0.5';
    nextBtn.onclick = () => {
        if (currentJobTasksPage < totalPages) {
            currentJobTasksPage++;
            renderJobTasksTable();
        }
    };
    controlsContainer.appendChild(nextBtn);
}

async function deleteJobTaskTemplate(id) {
    if (!confirm('هل أنت متأكد من حذف هذه المهمة من القائمة؟')) return;
    try {
        const { error } = await dbClient.from('job_task_templates').delete().eq('id', id);
        if (error) throw error;
        await loadJobTasksTable();
    } catch (error) {
        console.error('تعذّر حذف المهمة:', error.message);
        alert('فشلت العملية: ' + error.message);
    }
}

// =========================================================================
// 5. أدوات مساعدة لعرض شريط التنبيه ورسائل الحقول
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
// 6. ربط الأحداث + الحفظ
//    🔒 التحكم بالوصول للصفحة بأكملها وبإظهار زر "حفظ المهام" أصبح الآن عبر
//    محرك الصلاحيات الموحّد (permissions.js — Permissions.guardPage / data-perm).
// =========================================================================
document.addEventListener('DOMContentLoaded', async () => {
    const allowed = await Permissions.guardPage('tasks');
    if (!allowed) return;

    if (await blockCompanyRoleFromJobTasksPage()) return;

    await loadJobTitlesForCombobox();
    await loadJobTasksTable();

    document.getElementById('btnAddTaskLine').addEventListener('click', addTaskLineRow);
    document.getElementById('jobTaskFilterSelect').addEventListener('change', () => {
        currentJobTasksPage = 1;
        renderJobTasksTable();
    });

    document.getElementById('btnCancel').addEventListener('click', () => {
        window.location.href = Routes.url('tasks');
    });

    const form = document.getElementById('jobTaskForm');
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        hideFormAlert();

        const jobTitle = document.getElementById('jobTaskJobTitle').value;
        const taskLines = getTaskLineValues();

        setFieldError('job_title', null);
        setFieldError('task_lines', null);
        let hasError = false;

        if (!jobTitle) { setFieldError('job_title', 'الرجاء اختيار المسمى الوظيفي.'); hasError = true; }
        if (taskLines.length === 0) { setFieldError('task_lines', 'الرجاء كتابة مهمة واحدة على الأقل.'); hasError = true; }

        if (hasError) {
            showFormAlert('الرجاء تصحيح الحقول المظللة أدناه.', 'error');
            return;
        }

        const submitBtn = form.querySelector('.btn-submit');
        const originalText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = 'جاري الحفظ...';

        try {
            const payloads = taskLines.map(title => ({ job_title: jobTitle, title }));
            const { error } = await dbClient.from('job_task_templates').insert(payloads);
            if (error) throw error;

            showFormAlert(`تم حفظ ${payloads.length} مهمة لمسمّى "${jobTitle}" بنجاح!`, 'success');
            document.getElementById('jobTaskJobTitleSearch').value = '';
            document.getElementById('jobTaskJobTitle').value = '';
            resetTaskLines();
            await loadJobTasksTable();

        } catch (error) {
            console.error('تعذّر حفظ المهام:', error.message);
            showFormAlert('فشلت العملية: ' + error.message, 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
        }
    });
});