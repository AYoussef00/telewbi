// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================

let currentAttendanceId = null;
let companiesById = new Map();

// =========================================================================
// 2. مكوّن قائمة قابلة للبحث (Searchable Combobox) — نفس منطق شاشة الإضافة
// =========================================================================
function setupSearchableCombobox({ inputId, hiddenId, dropdownId, options, emptyText, onSelectExtra }) {
    const input = document.getElementById(inputId);
    const hidden = document.getElementById(hiddenId);
    const dropdown = document.getElementById(dropdownId);

    function renderOptions(filterText) {
        const normalized = (filterText || '').trim().toLowerCase();
        const filtered = normalized
            ? options.filter(opt => opt.label.toLowerCase().includes(normalized))
            : options;

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

    function openDropdown() {
        renderOptions(input.value === getSelectedLabel() ? '' : input.value);
        dropdown.classList.add('open');
    }
    function closeDropdown() { dropdown.classList.remove('open'); }
    function getSelectedLabel() {
        const match = options.find(opt => String(opt.value) === String(hidden.value));
        return match ? match.label : '';
    }

    input.addEventListener('focus', () => { input.select(); openDropdown(); });
    input.addEventListener('input', () => { renderOptions(input.value); dropdown.classList.add('open'); });
    input.addEventListener('blur', () => {
        setTimeout(() => { input.value = getSelectedLabel(); closeDropdown(); }, 120);
    });
    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !dropdown.contains(e.target)) closeDropdown();
    });

    return {
        enable(placeholderText) { input.disabled = false; input.placeholder = placeholderText || 'ابحث أو اختر...'; },
        setOptions(newOptions) { options = newOptions; },
        selectByValue(value) { hidden.value = value; input.value = getSelectedLabel(); }
    };
}

let employeeCombobox = null;

// =========================================================================
// 3. تحميل قائمة الموظفين وتحديد المختار حالياً بالسجل
// =========================================================================
async function loadEmployeesForCombobox(currentEmployeeId) {
    employeeCombobox = setupSearchableCombobox({
        inputId: 'attEmployeeSearch',
        hiddenId: 'attEmployeeId',
        dropdownId: 'attEmployeeDropdown',
        options: [],
        emptyText: 'لا يوجد موظفون مطابقون',
        onSelectExtra: (opt) => {
            const companyDisplay = document.getElementById('attCompanyDisplay');
            if (companyDisplay) companyDisplay.value = opt.companyName || 'بدون شركة';
        }
    });

    try {
        const [employeesResult, companiesResult] = await Promise.all([
            dbClient.from('employees').select('id, name, company_id').order('name', { ascending: true }),
            dbClient.from('companies').select('id, name')
        ]);

        if (employeesResult.error) throw new Error(employeesResult.error.message);
        if (companiesResult.error) throw new Error(companiesResult.error.message);

        companiesById = new Map((companiesResult.data || []).map(c => [String(c.id), c.name]));

        const options = (employeesResult.data || []).map(emp => {
            const companyName = emp.company_id != null ? (companiesById.get(String(emp.company_id)) || null) : null;
            return {
                value: String(emp.id),
                label: companyName ? `${emp.name} — ${companyName}` : emp.name,
                companyName: companyName
            };
        });

        employeeCombobox.setOptions(options);
        employeeCombobox.enable('ابحث أو اختر اسم الموظف');

        if (currentEmployeeId != null) {
            employeeCombobox.selectByValue(String(currentEmployeeId));
            const selectedOpt = options.find(o => o.value === String(currentEmployeeId));
            const companyDisplay = document.getElementById('attCompanyDisplay');
            if (companyDisplay) companyDisplay.value = selectedOpt ? (selectedOpt.companyName || 'بدون شركة') : 'غير محدد';
        }
    } catch (error) {
        console.error('تعذّر تحميل قائمة الموظفين:', error.message);
        document.getElementById('attEmployeeSearch').placeholder = 'تعذّر تحميل القائمة';
    }
}

// =========================================================================
// 4. أدوات مساعدة للتنبيهات وأخطاء الحقول
// =========================================================================
function showFormAlert(message, type) {
    const alertBox = document.getElementById('formAlert');
    alertBox.textContent = message;
    alertBox.className = 'form-alert ' + (type === 'success' ? 'alert-success' : 'alert-error');
    alertBox.style.display = 'flex';
    alertBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function hideFormAlert() {
    const alertBox = document.getElementById('formAlert');
    alertBox.style.display = 'none';
}
function setFieldError(fieldName, message) {
    const group = document.getElementById('group-' + fieldName);
    const errorEl = document.getElementById('error-' + fieldName);
    if (!group || !errorEl) return;
    if (message) { group.classList.add('has-error'); errorEl.textContent = message; }
    else { group.classList.remove('has-error'); errorEl.textContent = ''; }
}

function computeWorkedHours(checkIn, checkOut) {
    if (!checkIn || !checkOut) return null;
    const [inH, inM] = checkIn.split(':').map(Number);
    const [outH, outM] = checkOut.split(':').map(Number);
    const diff = (outH * 60 + outM) - (inH * 60 + inM);
    if (diff <= 0) return null;
    return Math.round((diff / 60) * 100) / 100;
}

// =========================================================================
// 5. جلب السجل المطلوب تعديله وتعبئة النموذج
// =========================================================================
async function loadAttendanceRecord(id) {
    const { data, error } = await dbClient.from('attendance').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('RECORD_NOT_FOUND');
    return data;
}

// 🚫 التحقق من عدم وجود سجل حضور آخر (بمعرّف مختلف) لنفس الموظف بنفس التاريخ —
// يمنع تحويل هذا السجل، عبر تعديل الموظف أو التاريخ، إلى سجل مكرر يصطدم بسجل
// آخر موجود بالفعل لنفس الموظف بنفس اليوم (نفس القاعدة المطبَّقة عند الإضافة).
async function checkDuplicateAttendanceRecord(employeeId, date, excludeId) {
    const { data, error } = await dbClient
        .from('attendance')
        .select('id')
        .eq('employee_id', parseInt(employeeId, 10))
        .eq('date', date)
        .neq('id', excludeId)
        .maybeSingle();

    if (error) throw new Error(error.message);
    return !!data;
}

// =========================================================================
// 6. ربط الأحداث وحفظ التعديلات
//    🔒 التحكم بالوصول للصفحة أصبح الآن عبر محرك الصلاحيات الموحّد
//    (permissions.js) — استدعاء Permissions.guardPage هو أول سطر بهذا
//    المُستمع، قبل أي منطق آخر (بما في ذلك قراءة معرّف السجل من الرابط).
// =========================================================================
document.addEventListener('DOMContentLoaded', async function() {
    const allowed = await Permissions.guardPage('attendance');
    if (!allowed) return;

    const urlParams = new URLSearchParams(window.location.search);
    currentAttendanceId = urlParams.get('id');

    const cancelBtn = document.getElementById('btnCancel');
    cancelBtn.addEventListener('click', function() {
        if (confirm('هل أنت متأكد من إلغاء التعديل؟ لن يتم حفظ أي تغييرات.')) {
            window.location.href = Routes.url('attendance');
        }
    });

    if (!currentAttendanceId) {
        showFormAlert('لم يتم تحديد أي سجل حضور لتعديله.', 'error');
        return;
    }

    let record;
    try {
        record = await loadAttendanceRecord(currentAttendanceId);
    } catch (error) {
        console.error('تعذّر تحميل سجل الحضور:', error.message);
        const notFound = error.message === 'RECORD_NOT_FOUND';
        showFormAlert(notFound ? 'تعذّر العثور على هذا السجل، ربما تم حذفه.' : 'تعذّر تحميل السجل: ' + error.message, 'error');
        return;
    }

    document.getElementById('attDate').value = record.date || '';
    document.getElementById('attCheckIn').value = record.check_in ? record.check_in.slice(0, 5) : '';
    document.getElementById('attCheckOut').value = record.check_out ? record.check_out.slice(0, 5) : '';
    document.getElementById('attStatus').value = record.status || 'حاضر';

    await loadEmployeesForCombobox(record.employee_id);

    const form = document.getElementById('editAttendanceForm');
    form.addEventListener('submit', async function(event) {
        event.preventDefault();
        hideFormAlert();

        const employeeId = document.getElementById('attEmployeeId').value;
        const date = document.getElementById('attDate').value;
        const checkIn = document.getElementById('attCheckIn').value || null;
        const checkOut = document.getElementById('attCheckOut').value || null;
        const status = document.getElementById('attStatus').value;

        let hasError = false;
        if (!employeeId) { setFieldError('employee_id', 'الرجاء اختيار الموظف.'); hasError = true; } else setFieldError('employee_id', null);
        if (!date) { setFieldError('date', 'الرجاء تحديد التاريخ.'); hasError = true; } else setFieldError('date', null);

        if (hasError) {
            showFormAlert('الرجاء تصحيح الحقول المظللة أدناه.', 'error');
            return;
        }

        const submitBtn = form.querySelector('.btn-submit');
        const originalText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = 'جاري التحقق...';

        try {
            // 🚫 منع تحويل هذا السجل (بتغيير الموظف أو التاريخ) إلى سجل مكرر يصطدم
            // بسجل آخر موجود بالفعل لنفس الموظف بنفس التاريخ
            const isDuplicate = await checkDuplicateAttendanceRecord(employeeId, date, currentAttendanceId);
            if (isDuplicate) {
                setFieldError('date', 'يوجد بالفعل سجل حضور آخر لهذا الموظف بهذا التاريخ.');
                showFormAlert('لا يمكن حفظ هذا التعديل: يوجد بالفعل سجل حضور آخر لنفس الموظف بنفس التاريخ.', 'error');
                return;
            }

            submitBtn.textContent = 'جاري الحفظ...';

            const payload = {
                employee_id: parseInt(employeeId, 10),
                date,
                check_in: checkIn,
                check_out: checkOut,
                hours: computeWorkedHours(checkIn, checkOut),
                status
            };

            const { error } = await dbClient.from('attendance').update(payload).eq('id', currentAttendanceId);
            if (error) throw new Error(error.message);

            showFormAlert('تم حفظ تعديلات سجل الحضور بنجاح! جاري التحويل...', 'success');
            setTimeout(() => { window.location.href = Routes.url('attendance'); }, 1400);

        } catch (error) {
            console.error('Attendance Update Error:', error);
            showFormAlert('فشلت العملية: ' + error.message, 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
        }
    });
});