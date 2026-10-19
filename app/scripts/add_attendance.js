// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================

let companiesById = new Map();
let employeesCacheForCombo = [];

// تاريخ ربط كل موظف بشركته ومعرّف تلك الشركة (من جدول employee_links — المصدر
// الفعلي لعلاقة الموظف بالشركة؛ عمود employees.company_id لم يعد يُستخدم منذ فصل
// شاشة "إضافة موظف" عن شاشة "ربط الموظفين")، مفهرسة بمعرّف الموظف كنص
let employeeLinkInfoById = new Map();

// =========================================================================
// 🛡️ نطاق رؤية المستخدم الحالي — نفس المنطق المستخدم بشاشة "إدارة الحضور
// والانصراف" (attendance.js) وتقرير الحضور وغيرها: مسؤول الشركة (role='company')
// لا يرى بحقل "الموظف" هنا إلا موظفي شركته/شركاته المملوكة فعلياً (أي الشركات
// التي حسابه هو user_id المسجَّل بها بجدول companies — قد يملك أكثر من شركة
// واحدة بنفس حساب الدخول)، بدل قائمة كل موظفي النظام كاملة كما كانت الحال سابقاً.
// مدير عام النظام/المسؤول (admin) بلا أي قيد كالمعتاد.
//
// ⚠️ إصلاح أمني مهم: هذا الملف لم يكن يحتوي إطلاقاً على أي تقييد بحسب الدور —
// كان أي مسؤول شركة يرى بحقل "الموظف" هنا كل موظفي كل الشركات بالنظام دون
// استثناء، ويستطيع تسجيل حضور لموظف لا علاقة له بشركته إطلاقاً.
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

// 📅 تاريخ اليوم بصيغة YYYY-MM-DD حسب توقيت جهاز المستخدم — يُستخدم لتقييد جلب
// سجلات الربط على الروابط النشطة فقط (بلا تاريخ انتهاء، أو لم يأتِ تاريخ
// انتهائها بعد). ⚠️ ضروري الآن بعد أن أصبح "إنهاء ربط موظف" يُسجِّل تاريخ
// انتهاء بدل حذف السجل فعلياً: بدون هذا الفلتر قد يبقى موظف مُنهى ربطه ظاهراً
// هنا بشركته/تاريخه القديمين (أو حتى يتعارض ترتيب الصفوف مع ربطه الجديد إن
// أُعيد ربطه لاحقاً بشركة أخرى)، لأن سجل ربطه القديم لم يعد يُحذف من الجدول.
function getTodayDateStringForLinks() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

// =========================================================================
// 2. مكوّن قائمة قابلة للبحث (Searchable Combobox) — نفس منطق شاشات الموظفين
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

// عند اختيار موظف من القائمة: نعبئ اسم الشركة تلقائياً، ونعرض تلميحاً بتاريخ ربطه
// بالشركة (إن وُجد)، ونعيد فحص خطأ حقل التاريخ فوراً بناءً على الاختيار الجديد
function handleEmployeeSelected(opt) {
    const companyDisplay = document.getElementById('attCompanyDisplay');
    if (companyDisplay) companyDisplay.value = opt.companyName || 'بدون شركة';

    const linkInfo = employeeLinkInfoById.get(String(opt.value));
    const linkDate = linkInfo ? linkInfo.link_date : null;
    const hintEl = document.getElementById('hintAttDate');
    if (hintEl) {
        hintEl.textContent = linkDate
            ? `📌 تاريخ ربط هذا الموظف بالشركة: ${linkDate} — يجب أن يكون تاريخ الحضور بهذا التاريخ أو بعده.`
            : '';
    }

    validateAttendanceDate();
}

// =========================================================================
// 3. تحميل قائمة الموظفين (مع اسم الشركة وتاريخ الربط عبر جدول employee_links)
//    لتغذية القائمة القابلة للبحث والتحقق من صحة تاريخ الحضور
// =========================================================================
async function loadEmployeesForCombobox() {
    employeeCombobox = setupSearchableCombobox({
        inputId: 'attEmployeeSearch',
        hiddenId: 'attEmployeeId',
        dropdownId: 'attEmployeeDropdown',
        options: [],
        emptyText: 'لا يوجد موظفون مطابقون',
        onSelectExtra: handleEmployeeSelected
    });

    // 🛡️ مسؤول شركة بلا أي شركة مملوكة أصلاً (حالة نادرة) ⇐ قائمة فارغة مباشرة
    // بلا أي طلب شبكة إضافي
    if (currentUserScope.companyIds !== null && currentUserScope.companyIds.length === 0) {
        employeeLinkInfoById = new Map();
        employeesCacheForCombo = [];
        employeeCombobox.setOptions([]);
        employeeCombobox.enable('لا يوجد موظفون مرتبطون بشركتك بعد');
        return;
    }

    try {
        // ⚠️ روابط نشطة فقط (بلا تاريخ انتهاء، أو لم يأتِ تاريخ انتهائها بعد)؛
        // انظر تعليق getTodayDateStringForLinks أعلاه لسبب ضرورة هذا الفلتر.
        // 🛡️ نطاق الرؤية: لمسؤول الشركة (currentUserScope.companyIds مصفوفة
        // محددة)، يُقيَّد جلب الروابط بشركاته المملوكة فقط عبر .in('company_id', ...).
        let linksQuery = dbClient.from('employee_links').select('employee_id, company_id, link_date')
            .or(`link_end_date.is.null,link_end_date.gte.${getTodayDateStringForLinks()}`);
        if (currentUserScope.companyIds !== null) linksQuery = linksQuery.in('company_id', currentUserScope.companyIds);

        const [employeesResult, companiesResult, linksResult] = await Promise.all([
            dbClient.from('employees').select('id, name').order('name', { ascending: true }),
            dbClient.from('companies').select('id, name'),
            linksQuery
        ]);

        if (employeesResult.error) throw new Error(employeesResult.error.message);
        if (companiesResult.error) throw new Error(companiesResult.error.message);
        if (linksResult.error) throw new Error(linksResult.error.message);

        companiesById = new Map((companiesResult.data || []).map(c => [String(c.id), c.name]));
        employeeLinkInfoById = new Map((linksResult.data || []).map(l => [String(l.employee_id), { company_id: l.company_id, link_date: l.link_date }]));

        // 🛡️ لمسؤول الشركة تحديداً: القائمة تقتصر على الموظفين المرتبطين فعلياً
        // (ربطاً نشطاً) بإحدى شركاته المملوكة — وليس كل موظفي النظام. مدير عام
        // النظام/المسؤول (companyIds === null) يستمران برؤية كل الموظفين كالمعتاد
        // (بمن فيهم غير المرتبطين بأي شركة حالياً، إن وُجدوا).
        employeesCacheForCombo = currentUserScope.companyIds !== null
            ? (employeesResult.data || []).filter(emp => employeeLinkInfoById.has(String(emp.id)))
            : (employeesResult.data || []);

        const options = employeesCacheForCombo.map(emp => {
            const linkInfo = employeeLinkInfoById.get(String(emp.id));
            const companyName = linkInfo && linkInfo.company_id != null ? (companiesById.get(String(linkInfo.company_id)) || null) : null;
            return {
                value: String(emp.id),
                label: companyName ? `${emp.name} — ${companyName}` : emp.name,
                companyName: companyName
            };
        });

        employeeCombobox.setOptions(options);
        employeeCombobox.enable(options.length ? 'ابحث أو اختر اسم الموظف' : 'لا يوجد موظفون مضافون بعد');
    } catch (error) {
        console.error('تعذّر تحميل قائمة الموظفين:', error.message);
        document.getElementById('attEmployeeSearch').placeholder = 'تعذّر تحميل القائمة';
    }
}

// =========================================================================
// 4. أدوات مساعدة لعرض شريط التنبيه ورسائل الحقول
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

// حساب عدد ساعات العمل تلقائياً من وقتي الدخول/الخروج (رقم عشري بمنزلتين، أو null)
function computeWorkedHours(checkIn, checkOut) {
    if (!checkIn || !checkOut) return null;
    const [inH, inM] = checkIn.split(':').map(Number);
    const [outH, outM] = checkOut.split(':').map(Number);
    const inMinutes = inH * 60 + inM;
    const outMinutes = outH * 60 + outM;
    const diff = outMinutes - inMinutes;
    if (diff <= 0) return null; // تجاهل الفروقات السالبة أو الصفرية (بيانات غير منطقية)
    return Math.round((diff / 60) * 100) / 100;
}

// 🕒 وقت الآن بصيغة HH:MM حسب ساعة جهاز المستخدم (يُستخدم فقط كبديل احتياطي عند
// عدم إدخال وقت خروج، حتى لا يبقى حقل created_at بلا قيمة منطقية)
function getCurrentTimeString() {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

// 🗓️ بناء created_at من تاريخ السجل ووقت الخروج معاً (بدل الاعتماد على وقت الحفظ
// الفعلي بالخادم)، حتى يعكس created_at تاريخ ووقت خروج الموظف الحقيقيين. لو لم
// يُدخَل وقت خروج (مثلاً حالة "غائب")، يُستخدم وقت الآن كبديل احتياطي مع نفس التاريخ.
function buildCreatedAtFromDateAndTime(dateStr, timeStr) {
    if (!dateStr) return undefined;
    const timePart = timeStr || getCurrentTimeString();
    const localDate = new Date(`${dateStr}T${timePart}:00`);
    if (isNaN(localDate.getTime())) return undefined;
    return localDate.toISOString();
}

// 📌 التحقق من أن تاريخ الحضور المُدخَل بتاريخ ربط الموظف بالشركة أو بعده — لا
// يمكن تسجيل حضور لموظف بتاريخ يسبق يوم ربطه بالشركة أصلاً. يُعاد استخدام هذا
// الفحص عند تغيير الموظف أو التاريخ، وأيضاً بشكل نهائي عند الإرسال.
function validateAttendanceDate() {
    const employeeId = document.getElementById('attEmployeeId').value;
    const date = document.getElementById('attDate').value;
    if (!employeeId || !date) { setFieldError('date', null); return true; }

    const linkInfo = employeeLinkInfoById.get(String(employeeId));
    const linkDate = linkInfo ? linkInfo.link_date : null;
    if (linkDate && date < linkDate) {
        setFieldError('date', `يجب أن يكون تاريخ الحضور بتاريخ ${linkDate} أو بعده (تاريخ ربط الموظف بالشركة).`);
        return false;
    }
    setFieldError('date', null);
    return true;
}

// 🚫 التحقق من عدم وجود سجل حضور آخر لنفس الموظف بنفس التاريخ مسبقاً — يمنع
// إضافة أكثر من سجل حضور/انصراف واحد لنفس الموظف بنفس اليوم من هذه الشاشة
// (نفس القاعدة المطبَّقة في شاشة "إضافة سجلات حضور متعددة"). يُستدعى فقط عند
// الإرسال النهائي (وليس أثناء الكتابة) لتفادي استعلامات متكررة غير ضرورية.
async function checkDuplicateAttendanceRecord(employeeId, date) {
    const { data, error } = await dbClient
        .from('attendance')
        .select('id')
        .eq('employee_id', parseInt(employeeId, 10))
        .eq('date', date)
        .maybeSingle();

    if (error) throw new Error(error.message);
    return !!data;
}

// =========================================================================
// 5. ربط الأحداث وحفظ السجل
//    🔒 التحكم بالوصول للصفحة أصبح الآن عبر محرك الصلاحيات الموحّد
//    (permissions.js) — انظر أول سطر بمُستمع DOMContentLoaded أدناه.
// =========================================================================
document.addEventListener('DOMContentLoaded', async function() {
    const allowed = await Permissions.guardPage('attendance');
    if (!allowed) return;

    await loadCurrentUserScope();
    loadEmployeesForCombobox();

    const dateInput = document.getElementById('attDate');
    const today = new Date();
    dateInput.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    dateInput.addEventListener('change', validateAttendanceDate);

    const cancelBtn = document.getElementById('btnCancel');
    cancelBtn.addEventListener('click', function() {
        if (confirm('هل أنت متأكد من إلغاء العملية؟ لن يتم حفظ البيانات.')) {
            window.location.href = Routes.url('attendance');
        }
    });

    const form = document.getElementById('addAttendanceForm');
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
        if (!date) { setFieldError('date', 'الرجاء تحديد التاريخ.'); hasError = true; }
        else if (!validateAttendanceDate()) { hasError = true; }

        if (hasError) {
            showFormAlert('الرجاء تصحيح الحقول المظللة أدناه.', 'error');
            return;
        }

        // 🛡️ تحقق أمني إضافي على مستوى الحفظ (وليس فقط إخفاء الخيار بالقائمة):
        // لمسؤول الشركة، نتأكد أن الموظف المُختار مرتبط فعلاً بإحدى شركاته
        // المملوكة قبل أي حفظ فعلي — يمنع تسجيل حضور لموظف خارج نطاقه حتى لو
        // جرى تمرير معرّف موظف آخر يدوياً بمعزل عن قائمة الاختيار بالواجهة.
        if (currentUserScope.companyIds !== null && !employeeLinkInfoById.has(String(employeeId))) {
            setFieldError('employee_id', 'هذا الموظف غير مرتبط بأي من شركاتك.');
            showFormAlert('غير مصرح لك بتسجيل حضور لهذا الموظف — هو غير مرتبط بأي من شركاتك.', 'error');
            return;
        }

        const submitBtn = form.querySelector('.btn-submit');
        const originalText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = 'جاري التحقق...';

        try {
            // 🚫 منع تسجيل حضور/انصراف مرتين لنفس الموظف بنفس التاريخ — نتحقق أولاً
            // من عدم وجود سجل سابق بنفس الموظف والتاريخ قبل أي إدخال جديد
            const isDuplicate = await checkDuplicateAttendanceRecord(employeeId, date);
            if (isDuplicate) {
                setFieldError('date', 'يوجد بالفعل سجل حضور لهذا الموظف بهذا التاريخ. عدّل السجل الموجود بدل إضافة سجل جديد.');
                showFormAlert('هذا الموظف لديه سجل حضور مسجَّل بالفعل بنفس التاريخ. الرجاء تعديل السجل الموجود من شاشة "إدارة الحضور والانصراف" بدل إضافة سجل مكرر.', 'error');
                return;
            }

            submitBtn.textContent = 'جاري الحفظ...';

            const payload = {
                employee_id: parseInt(employeeId, 10),
                date,
                check_in: checkIn,
                check_out: checkOut,
                hours: computeWorkedHours(checkIn, checkOut),
                status,
                // created_at يُحفظ بتاريخ ووقت الخروج بدل وقت الحفظ الفعلي بالخادم
                created_at: buildCreatedAtFromDateAndTime(date, checkOut)
            };

            const { error } = await dbClient.from('attendance').insert([payload]);
            if (error) throw new Error(error.message);

            showFormAlert('تم حفظ سجل الحضور بنجاح! جاري التحويل...', 'success');
            setTimeout(() => { window.location.href = Routes.url('attendance'); }, 1400);

        } catch (error) {
            console.error('Attendance Insert Error:', error);
            showFormAlert('فشلت العملية: ' + error.message, 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
        }
    });
});
