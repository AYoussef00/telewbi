// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================

let localBlacklistCache = [];
let filteredBlacklistCache = [];

let currentBlPage = 1;
const blPerPage = 8;

let employeesSuggestCache = [];

document.addEventListener('DOMContentLoaded', async () => {
    const allowed = await Permissions.guardPage('blacklist');
    if (!allowed) return;

    fetchAndRenderBlacklist();
    loadEmployeesForSuggestions();
    setupBlacklistEmployeeCombobox();

    document.getElementById('btnOpenAddBlacklist').addEventListener('click', () => {
        document.getElementById('addBlacklistForm').reset();
        document.getElementById('blNationalId').value = '';
        document.getElementById('blName').value = '';
        ['bl_employee', 'bl_reason'].forEach(f => setBlFieldError(f, null));
        hideBlacklistAlert();
        document.getElementById('addBlacklistModal').classList.add('open');
    });
});

// 👥 تحميل قائمة الموظفين الحاليين ليتم الاختيار منها حصراً (لا يُسمح بإدخال يدوي)
async function loadEmployeesForSuggestions() {
    const searchInput = document.getElementById('blEmployeeSearch');
    try {
        const { data, error } = await dbClient
            .from('employees')
            .select('name, national_id')
            .not('national_id', 'is', null);

        if (error) throw new Error(error.message);
        employeesSuggestCache = data || [];

        searchInput.disabled = false;
        searchInput.placeholder = employeesSuggestCache.length
            ? 'ابحث بالاسم أو رقم الهوية...'
            : 'لا يوجد موظفون مسجّلون بالنظام';
    } catch (error) {
        console.error('تعذّر تحميل قائمة الموظفين:', error.message);
        searchInput.placeholder = 'تعذّر تحميل القائمة';
    }
}

// 🔒 قائمة بحث صارمة: لا تقبل إلا اختيار موظف موجود فعلياً بجدول employees
function setupBlacklistEmployeeCombobox() {
    const searchInput = document.getElementById('blEmployeeSearch');
    const dropdown = document.getElementById('blEmployeeDropdown');
    const hiddenNationalId = document.getElementById('blNationalId');
    const hiddenName = document.getElementById('blName');

    function getSelectedLabel() {
        if (!hiddenNationalId.value) return '';
        const match = employeesSuggestCache.find(e => e.national_id === hiddenNationalId.value);
        return match ? `${match.name} — ${match.national_id}` : '';
    }

    function selectEmployee(emp) {
        hiddenNationalId.value = emp.national_id || '';
        hiddenName.value = emp.name || '';
        searchInput.value = `${emp.name} — ${emp.national_id}`;
        setBlFieldError('bl_employee', null);
    }

    function clearSelection() {
        hiddenNationalId.value = '';
        hiddenName.value = '';
    }

    function renderOptions(filterText) {
        const normalized = (filterText || '').trim().toLowerCase();
        const matches = normalized
            ? employeesSuggestCache.filter(e =>
                (e.name || '').toLowerCase().includes(normalized) ||
                (e.national_id || '').includes(normalized))
            : employeesSuggestCache;

        dropdown.innerHTML = '';

        if (matches.length === 0) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'combo-empty';
            emptyEl.textContent = 'لا يوجد موظف مطابق. لا يمكن إضافة شخص غير مسجّل بالنظام.';
            dropdown.appendChild(emptyEl);
            dropdown.classList.add('open');
            return;
        }

        matches.slice(0, 20).forEach(emp => {
            const item = document.createElement('div');
            item.className = 'combo-item';
            if (hiddenNationalId.value === emp.national_id) item.classList.add('selected');
            item.textContent = `${emp.name || '----'} — ${emp.national_id || '----'}`;
            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                selectEmployee(emp);
                dropdown.classList.remove('open');
            });
            dropdown.appendChild(item);
        });
        dropdown.classList.add('open');
    }

    searchInput.addEventListener('focus', () => {
        searchInput.select();
        renderOptions('');
    });

    searchInput.addEventListener('input', () => {
        clearSelection(); // أي كتابة يدوية تُبطل الاختيار السابق حتى يُعاد الاختيار من القائمة
        renderOptions(searchInput.value);
    });

    searchInput.addEventListener('blur', () => {
        setTimeout(() => {
            // لو غادر الحقل بدون اختيار مطابق فعلي من القائمة، يُفرَّغ الحقل بالكامل
            const currentLabel = getSelectedLabel();
            searchInput.value = currentLabel;
            if (!currentLabel) clearSelection();
            dropdown.classList.remove('open');
        }, 150);
    });

    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.classList.remove('open');
        }
    });
}

// 📊 جلب القائمة السوداء
async function fetchAndRenderBlacklist() {
    const tableBody = document.getElementById('blacklistTableBody');
    if (!tableBody) return;

    const { data, error } = await dbClient
        .from('employee_blacklist')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('خطأ في الاتصال بقاعدة البيانات:', error.message);
        tableBody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#ef4444; padding:20px;">فشل تحميل القائمة السوداء.</td></tr>`;
        return;
    }

    localBlacklistCache = data || [];
    filteredBlacklistCache = localBlacklistCache;
    currentBlPage = 1;
    renderBlacklistTable(filteredBlacklistCache);
}

function renderBlacklistTable(data) {
    const tableBody = document.getElementById('blacklistTableBody');
    tableBody.innerHTML = '';

    if (data.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:30px; color:#94a3b8;">لا توجد سجلات بالقائمة السوداء.</td></tr>`;
        setupBlPaginationControls(0);
        return;
    }

    const startIndex = (currentBlPage - 1) * blPerPage;
    const paginatedData = data.slice(startIndex, startIndex + blPerPage);

    paginatedData.forEach(entry => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td style="font-family: monospace; color: #475569;">${entry.national_id || '----'}</td>
            <td><strong style="color:#1e293b;">${entry.name || '----'}</strong></td>
            <td style="color:#64748b;">${entry.reason || '----'}</td>
            <td style="text-align:center;">
                <button class="action-icon-btn" style="color:#ef4444;" title="إزالة من القائمة السوداء" data-perm="delete:blacklist" onclick="removeFromBlacklist('${entry.id}')">${ICONS.trash}</button>
            </td>
        `;
        tableBody.appendChild(row);
    });

    Permissions.applyButtonGating(tableBody);
    setupBlPaginationControls(data.length);
}

function setupBlPaginationControls(totalItems) {
    const container = document.getElementById('blacklistPagination');
    container.innerHTML = '';
    const totalPages = Math.ceil(totalItems / blPerPage);
    if (totalPages <= 1) return;

    const prevBtn = document.createElement('button');
    prevBtn.innerHTML = '&rarr; السابقة';
    prevBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;';
    prevBtn.disabled = currentBlPage === 1;
    if (prevBtn.disabled) prevBtn.style.opacity = '0.5';
    prevBtn.onclick = () => { if (currentBlPage > 1) { currentBlPage--; renderBlacklistTable(filteredBlacklistCache); } };
    container.appendChild(prevBtn);

    const label = document.createElement('span');
    label.style.cssText = 'font-size: 0.9rem; color: #475569; font-weight: 600; margin: 0 10px;';
    label.textContent = `صفحة ${currentBlPage} من ${totalPages}`;
    container.appendChild(label);

    const nextBtn = document.createElement('button');
    nextBtn.innerHTML = 'التالية &larr;';
    nextBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;';
    nextBtn.disabled = currentBlPage === totalPages;
    if (nextBtn.disabled) nextBtn.style.opacity = '0.5';
    nextBtn.onclick = () => { if (currentBlPage < totalPages) { currentBlPage++; renderBlacklistTable(filteredBlacklistCache); } };
    container.appendChild(nextBtn);
}

function handleBlacklistFilterChange() {
    const text = (document.getElementById('blacklistSearchInput').value || '').toLowerCase().trim();
    filteredBlacklistCache = localBlacklistCache.filter(e =>
        (e.name && e.name.toLowerCase().includes(text)) ||
        (e.national_id && e.national_id.includes(text))
    );
    currentBlPage = 1;
    renderBlacklistTable(filteredBlacklistCache);
}

function closeBlacklistModal() {
    document.getElementById('addBlacklistModal').classList.remove('open');
}

function setBlFieldError(fieldName, message) {
    const group = document.getElementById('group-' + fieldName);
    const errorEl = document.getElementById('error-' + fieldName);
    if (!group || !errorEl) return;
    if (message) {
        group.classList.add('has-error');
        errorEl.textContent = message;
    } else {
        group.classList.remove('has-error');
        errorEl.textContent = '';
    }
}

function showBlacklistAlert(message, type) {
    const box = document.getElementById('blacklistFormAlert');
    box.textContent = message;
    box.className = 'form-alert ' + (type === 'success' ? 'alert-success' : 'alert-error');
    box.style.display = 'flex';
}
function hideBlacklistAlert() {
    document.getElementById('blacklistFormAlert').style.display = 'none';
}

// 💾 إضافة سجل جديد للقائمة السوداء
async function handleBlacklistSubmission(event) {
    event.preventDefault();
    hideBlacklistAlert();

    const nationalId = document.getElementById('blNationalId').value.trim();
    const name = document.getElementById('blName').value.trim();
    const reason = document.getElementById('blReason').value.trim();

    let hasError = false;

    // لازم يكون فيه اختيار فعلي من قائمة الموظفين (لا إدخال يدوي مقبول)
    const isRealEmployee = nationalId && employeesSuggestCache.some(e => e.national_id === nationalId);
    if (!isRealEmployee) {
        setBlFieldError('bl_employee', 'الرجاء اختيار موظف من القائمة — لا يمكن إضافة شخص غير مسجّل بالنظام.');
        hasError = true;
    } else {
        setBlFieldError('bl_employee', null);
    }

    if (!reason) {
        setBlFieldError('bl_reason', 'السبب مطلوب.');
        hasError = true;
    } else {
        setBlFieldError('bl_reason', null);
    }

    if (hasError) {
        showBlacklistAlert('الرجاء تصحيح الحقول المظللة أدناه.', 'error');
        return;
    }

    const saveBtn = document.querySelector('#addBlacklistForm .btn-modal-save');
    const originalText = saveBtn.textContent;
    saveBtn.disabled = true;
    saveBtn.textContent = 'جاري الحفظ...';

    try {
        const { data: existing, error: checkError } = await dbClient
            .from('employee_blacklist')
            .select('id')
            .eq('national_id', nationalId)
            .maybeSingle();

        if (checkError) throw new Error(checkError.message);

        if (existing) {
            showBlacklistAlert('رقم الهوية هذا مضاف بالفعل للقائمة السوداء.', 'error');
            return;
        }

        const { error } = await dbClient
            .from('employee_blacklist')
            .insert([{ national_id: nationalId, name, reason }]);

        if (error) throw new Error(error.message);

        showBlacklistAlert('تمت الإضافة بنجاح.', 'success');
        setTimeout(() => {
            closeBlacklistModal();
            fetchAndRenderBlacklist();
        }, 700);

    } catch (error) {
        console.error('Blacklist Insert Error:', error.message);
        showBlacklistAlert('فشلت العملية: ' + error.message, 'error');
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = originalText;
    }
}

// 🗑️ إزالة من القائمة السوداء
async function removeFromBlacklist(id) {
    if (!confirm('هل أنت متأكد من إزالة هذا السجل من القائمة السوداء؟')) return;

    try {
        const { error } = await dbClient.from('employee_blacklist').delete().eq('id', id);
        if (error) throw error;
        alert('تمت الإزالة بنجاح.');
        await fetchAndRenderBlacklist();
    } catch (error) {
        console.error('خطأ أثناء الإزالة:', error.message);
        alert('فشلت الإزالة: ' + error.message);
    }
}
