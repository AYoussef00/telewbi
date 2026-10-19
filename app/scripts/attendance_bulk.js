// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================

let companiesOptionsCache = [];

// =========================================================================
// 🛡️ حماية فعلية (وليست مجرد إخفاء زر) بمعزل عن نظام صلاحيات menus:
// مسؤول الشركة لا يجب أن يستخدم "إضافة سجلات متعددة" حتى لو وصل لهذا
// الرابط مباشرة عبر العنوان — وليس فقط عبر زر attendance.html المُخفى عنه.
// هذا الملف لا يملك أصلاً أي بنية currentUserScope (لا يحتاجها لباقي
// وظائفه)، لذا هذه دالة صغيرة مستقلة تجلب الدور فقط وتُستخدم مرة واحدة
// عند تحميل الصفحة.
// =========================================================================
async function blockCompanyRoleFromAttendanceBulkPage() {
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
        console.error('تعذّر التحقق من دور المستخدم الحالي (إضافة سجلات متعددة):', error.message);
        return false;
    }
}

// 📅 تاريخ اليوم بصيغة YYYY-MM-DD حسب توقيت جهاز المستخدم — يُستخدم لتقييد جلب
// موظفي الشركة على الروابط النشطة فقط (بلا تاريخ انتهاء، أو لم يأتِ تاريخ
// انتهائها بعد). ⚠️ ضروري بعد أن أصبح "إنهاء ربط موظف" يُسجِّل تاريخ انتهاء بدل
// حذف السجل فعلياً: بدون هذا الفلتر قد يُولَّد سجلات حضور تلقائية لموظف انتهى
// ربطه بالفعل بهذه الشركة.
function getTodayDateStringForLinks() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

// 🚫 قراءة أيام الإجازة الأسبوعية المختارة حالياً من مجموعة أزرار الاختيار
function getSelectedOffDays() {
    return Array.from(document.querySelectorAll('#offDaysGroup input[type="checkbox"]:checked'))
        .map(cb => parseInt(cb.value, 10));
}

// ربط تبديل شكل "الشريحة" (Chip) البصري عند تحديد/إلغاء كل يوم إجازة
function wireOffDaysToggleChips() {
    document.querySelectorAll('#offDaysGroup .weekday-chip').forEach(chip => {
        const checkbox = chip.querySelector('input[type="checkbox"]');
        if (!checkbox) return;
        const syncActiveClass = () => chip.classList.toggle('active', checkbox.checked);
        syncActiveClass();
        checkbox.addEventListener('change', syncActiveClass);
    });
}

// =========================================================================
// 2. مكوّن قائمة قابلة للبحث (Searchable Combobox) — اختيار الشركة حصرياً
// =========================================================================
function setupSearchableCombobox({ inputId, hiddenId, dropdownId, options, emptyText }) {
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
        setOptions(newOptions) { options = newOptions; }
    };
}

let companyCombobox = null;

async function loadCompaniesForCombobox() {
    companyCombobox = setupSearchableCombobox({
        inputId: 'bulkCompanySearch',
        hiddenId: 'bulkCompanyId',
        dropdownId: 'bulkCompanyDropdown',
        options: [],
        emptyText: 'لا توجد شركات مطابقة'
    });

    try {
        const { data, error } = await dbClient.from('companies').select('id, name').order('name', { ascending: true });
        if (error) throw new Error(error.message);

        companiesOptionsCache = (data || []).map(c => ({ value: String(c.id), label: c.name || '----' }));
        companyCombobox.setOptions(companiesOptionsCache);
        companyCombobox.enable(companiesOptionsCache.length ? 'ابحث عن شركة...' : 'لا توجد شركات مضافة بعد');
    } catch (error) {
        console.error('تعذّر تحميل قائمة الشركات:', error.message);
        document.getElementById('bulkCompanySearch').placeholder = 'تعذّر تحميل القائمة';
    }
}

// =========================================================================
// 3. أدوات مساعدة عامة (تنبيهات، أخطاء الحقول، وقت/تاريخ)
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

function timeToMinutes(t) {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
}
function minutesToTimeStr(mins) {
    const clamped = Math.max(0, Math.min(23 * 60 + 59, mins));
    const h = Math.floor(clamped / 60);
    const m = clamped % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function computeWorkedHours(checkIn, checkOut) {
    if (!checkIn || !checkOut) return null;
    const diff = timeToMinutes(checkOut) - timeToMinutes(checkIn);
    if (diff <= 0) return null;
    return Math.round((diff / 60) * 100) / 100;
}

// 🗓️ بناء created_at من تاريخ السجل ووقت الخروج معاً (بدل الاعتماد على وقت الحفظ
// الفعلي بالخادم)، حتى يعكس created_at تاريخ ووقت خروج الموظف الحقيقيين لكل سجل
// مُولَّد. لو تعذّر — لأي سبب — تحديد وقت خروج لسجل معيّن (مثل سجلات الغياب
// العشوائية التي لا تملك وقت خروج أصلاً)، يُستخدم منتصف الليل من نفس تاريخ
// السجل كبديل احتياطي بدل ترك القيمة بلا معنى.
function buildCreatedAtFromDateAndTime(dateStr, timeStr) {
    if (!dateStr) return undefined;
    const timePart = timeStr || '00:00';
    const localDate = new Date(`${dateStr}T${timePart}:00`);
    if (isNaN(localDate.getTime())) return undefined;
    return localDate.toISOString();
}

// توليد قائمة أيام العمل بين تاريخين (شاملة الطرفين)، باستثناء أيام الإجازة المختارة
function getWorkingDaysInRange(fromDateStr, toDateStr, offDays) {
    const days = [];
    const current = new Date(fromDateStr + 'T00:00:00');
    const end = new Date(toDateStr + 'T00:00:00');

    while (current <= end) {
        if (!offDays.includes(current.getDay())) {
            const y = current.getFullYear();
            const m = String(current.getMonth() + 1).padStart(2, '0');
            const d = String(current.getDate()).padStart(2, '0');
            days.push(`${y}-${m}-${d}`);
        }
        current.setDate(current.getDate() + 1);
    }
    return days;
}

// خلط عشوائي لمصفوفة (Fisher-Yates) — يُستخدم لتوزيع أوقات مختلفة على الموظفين كل يوم،
// وأيضاً لاختيار أيام الغياب العشوائية لكل موظف
function shuffleArray(arr) {
    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

// توزيع n وقت داخل نطاق [fromMin, toMin] بتباعد متساوٍ تقريباً + تشويش بسيط،
// بحيث تكون الأوقات مختلفة قدر الإمكان بين الموظفين بنفس اليوم
function distributeTimesInRange(fromMin, toMin, n) {
    if (n <= 0) return [];
    if (n === 1) {
        const mid = fromMin + Math.round(Math.random() * Math.max(0, toMin - fromMin));
        return [minutesToTimeStr(mid)];
    }

    const range = Math.max(0, toMin - fromMin);
    const step = range / (n - 1);
    const jitterCap = step > 4 ? Math.min(step * 0.4, 10) : 2;

    const slots = [];
    for (let i = 0; i < n; i++) {
        const base = fromMin + step * i;
        const jitter = (Math.random() - 0.5) * jitterCap;
        const t = Math.max(fromMin, Math.min(toMin, Math.round(base + jitter)));
        slots.push(t);
    }
    return slots.map(minutesToTimeStr);
}

// =========================================================================
// 3ب. اختيار أيام غياب عشوائية لكل موظف (محاكاة واقعية لسجل الحضور، بدل أن
//     يكون الجميع حاضرين طوال الفترة بلا استثناء): 3 أو 4 أيام عشوائية لكل
//     موظف من ضمن أيام العمل المؤهلة له فعلياً (على ألا تسبق تاريخ ربطه
//     بالشركة). لا تُطبَّق على فترات قصيرة جداً (أقل من 5 أيام عمل مؤهلة)
//     حتى لا تتحول غالبية الفترة إلى غياب.
// =========================================================================
const MIN_ELIGIBLE_DAYS_FOR_RANDOM_ABSENCE = 5;

function buildRandomAbsentDatesByEmployee(employees, workingDays, linkDateByEmployeeId) {
    const absentDatesByEmployeeId = new Map();

    employees.forEach(emp => {
        const employeeLinkDate = linkDateByEmployeeId.get(emp.id);
        const eligibleDays = employeeLinkDate
            ? workingDays.filter(d => d >= employeeLinkDate)
            : workingDays;

        const absentCount = eligibleDays.length >= MIN_ELIGIBLE_DAYS_FOR_RANDOM_ABSENCE
            ? Math.min(eligibleDays.length, Math.random() < 0.5 ? 3 : 4)
            : 0;

        const chosenAbsentDays = absentCount > 0 ? shuffleArray(eligibleDays).slice(0, absentCount) : [];
        absentDatesByEmployeeId.set(emp.id, new Set(chosenAbsentDays));
    });

    return absentDatesByEmployeeId;
}

// =========================================================================
// 4. ربط الأحداث والتوليد + الحفظ الجماعي
//    🔒 التحكم بالوصول للصفحة أصبح الآن عبر محرك الصلاحيات الموحّد
//    (permissions.js — Permissions.guardPage / data-perm)، بدل عدم وجود أي
//    تحقق مستقل بهذا الملف سابقاً (كان زر تشغيل هذه الشاشة، "إضافة سجلات
//    متعددة" بصفحة attendance.html، هو ما كان يُخفى عبر الفحص القديم الخاص
//    بمفتاح "action:attendance_bulk_add" — انظر attendance.js). زر "متابعة"
//    بهذه الصفحة يحمل الآن data-perm="add:attendance" (بملف
//    attendance_bulk.html) بدل أي فحص بمصفوفة menus.
// =========================================================================
document.addEventListener('DOMContentLoaded', async function() {
    const allowed = await Permissions.guardPage('attendance');
    if (!allowed) return;

    if (await blockCompanyRoleFromAttendanceBulkPage()) return;

    loadCompaniesForCombobox();
    wireOffDaysToggleChips();

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    document.getElementById('bulkFromDate').value = todayStr;
    document.getElementById('bulkToDate').value = todayStr;

    document.getElementById('btnCancel').addEventListener('click', function() {
        if (confirm('هل أنت متأكد من إلغاء العملية؟ لن يتم حفظ أي بيانات.')) {
            window.location.href = Routes.url('attendance');
        }
    });

    const form = document.getElementById('bulkAttendanceForm');
    form.addEventListener('submit', async function(event) {
        event.preventDefault();
        hideFormAlert();

        const companyId = document.getElementById('bulkCompanyId').value;
        const fromDate = document.getElementById('bulkFromDate').value;
        const toDate = document.getElementById('bulkToDate').value;
        const checkInFrom = document.getElementById('bulkCheckInFrom').value;
        const checkInTo = document.getElementById('bulkCheckInTo').value;
        const checkOutFrom = document.getElementById('bulkCheckOutFrom').value;
        const checkOutTo = document.getElementById('bulkCheckOutTo').value;
        const status = document.getElementById('bulkStatus').value;
        const offDays = getSelectedOffDays();

        // --- تحقق أساسي من الحقول ---
        ['company_id', 'from_date', 'to_date', 'off_days', 'checkin_from', 'checkin_to', 'checkout_from', 'checkout_to'].forEach(f => setFieldError(f, null));
        let hasError = false;

        if (!companyId) { setFieldError('company_id', 'الرجاء اختيار الشركة.'); hasError = true; }
        if (!fromDate) { setFieldError('from_date', 'الرجاء تحديد تاريخ البداية.'); hasError = true; }
        if (!toDate) { setFieldError('to_date', 'الرجاء تحديد تاريخ النهاية.'); hasError = true; }
        if (fromDate && toDate && fromDate > toDate) { setFieldError('to_date', 'يجب أن يكون تاريخ النهاية بعد تاريخ البداية أو يساويه.'); hasError = true; }
        if (offDays.length >= 7) { setFieldError('off_days', 'لا يمكن اعتبار كل أيام الأسبوع إجازة — الرجاء ترك يوم عمل واحد على الأقل.'); hasError = true; }
        if (checkInFrom && checkInTo && timeToMinutes(checkInFrom) > timeToMinutes(checkInTo)) { setFieldError('checkin_to', 'يجب أن يكون وقت النهاية بعد وقت البداية.'); hasError = true; }
        if (checkOutFrom && checkOutTo && timeToMinutes(checkOutFrom) > timeToMinutes(checkOutTo)) { setFieldError('checkout_to', 'يجب أن يكون وقت النهاية بعد وقت البداية.'); hasError = true; }

        if (hasError) {
            showFormAlert('الرجاء تصحيح الحقول المظللة أدناه.', 'error');
            return;
        }

        const submitBtn = form.querySelector('.btn-submit');
        const originalText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = 'جاري التحضير...';

        try {
            // 1. جلب موظفي الشركة المحددة عبر جدول الربط employee_links (المصدر الفعلي
            //    لعلاقة الموظف بالشركة). عمود employees.company_id لم يعد يُستخدم منذ
            //    فصل شاشة "إضافة موظف" عن شاشة "ربط الموظفين" — الربط الآن يتم حصرياً
            //    عبر شاشة "ربط الموظفين" التي تُنشئ صفاً بجدول employee_links فقط.
            //    نجلب تاريخ ربط كل موظف بنفس الاستعلام لاستخدامه لاحقاً في الفلترة.
            //
            //    ⚠️ روابط نشطة فقط (بلا تاريخ انتهاء، أو لم يأتِ تاريخ انتهائها بعد):
            //    بعد أن أصبح "إنهاء ربط موظف" يُسجِّل تاريخ انتهاء بدل حذف السجل
            //    فعلياً، تبقى روابط الموظفين المُنهاة محفوظة بجدول employee_links —
            //    بدون هذا الفلتر كانت ستُولَّد سجلات حضور تلقائية لموظفين انتهى
            //    ربطهم بهذه الشركة بالفعل.
            const { data: linkedRows, error: empError } = await dbClient
                .from('employee_links')
                .select('employee_id, link_date, employees(id, name)')
                .eq('company_id', companyId)
                .or(`link_end_date.is.null,link_end_date.gte.${getTodayDateStringForLinks()}`);

            if (empError) throw new Error(empError.message);

            const employeesRaw = (linkedRows || [])
                .filter(row => row.employees)
                .map(row => ({ id: row.employees.id, name: row.employees.name }));

            // 🛡️ إزالة أي تكرار محتمل لنفس الموظف من القائمة (احتياطاً فقط، في حال
            // وجود أكثر من صف ربط نشط لنفس الموظف بنفس الشركة لأي سبب) — بدون هذا
            // الفلتر قد يُعالَج نفس الموظف مرتين في حلقة توليد اليوم نفسه، وهو بالضبط
            // ما نريد تفاديه: عدم إضافة أكثر من سجل حضور/انصراف واحد لنفس الموظف
            // بنفس التاريخ.
            const employees = Array.from(new Map(employeesRaw.map(e => [e.id, e])).values());

            if (employees.length === 0) {
                showFormAlert('لا يوجد موظفون مرتبطون بهذه الشركة بعد. اربط الموظفين بها أولاً من شاشة "ربط الموظفين".', 'error');
                return;
            }

            const linkDateByEmployeeId = new Map((linkedRows || []).map(row => [row.employee_id, row.link_date]));

            // 2. حساب أيام العمل ضمن النطاق (باستثناء أيام الإجازة الأسبوعية المختارة)
            const workingDays = getWorkingDaysInRange(fromDate, toDate, offDays);
            if (workingDays.length === 0) {
                showFormAlert('لا توجد أيام عمل ضمن النطاق المحدد بعد استثناء أيام الإجازة الأسبوعية المختارة.', 'error');
                return;
            }

            // 3. جلب السجلات الموجودة مسبقاً لهؤلاء الموظفين بنفس النطاق، لتفادي التكرار
            //    — هذا هو خط الدفاع الأساسي الذي يمنع نهائياً إضافة أكثر من سجل حضور
            //    واحد (حضور + انصراف) لنفس الموظف بنفس التاريخ: أي مفتاح "معرّف
            //    الموظف|التاريخ" موجود بالفعل بقاعدة البيانات يُستبعد تماماً من التوليد،
            //    سواء كان قد أُنشئ يدوياً من شاشة "إضافة سجل حضور" أو من تشغيل سابق
            //    لهذه الشاشة بنفس النطاق الزمني.
            const employeeIds = employees.map(e => e.id);
            const { data: existingRows, error: existingError } = await dbClient
                .from('attendance')
                .select('employee_id, date')
                .in('employee_id', employeeIds)
                .gte('date', fromDate)
                .lte('date', toDate);

            if (existingError) throw new Error(existingError.message);

            const existingKeys = new Set((existingRows || []).map(r => `${r.employee_id}|${r.date}`));

            // 3ب. اختيار أيام الغياب العشوائية لكل موظف (3 أو 4 أيام) — محاكاة واقعية
            //     لسجل الحضور بدل أن يكون الجميع حاضرين طوال الفترة بلا استثناء
            const absentDatesByEmployeeId = buildRandomAbsentDatesByEmployee(employees, workingDays, linkDateByEmployeeId);

            // 4. تأكيد المستخدم قبل التوليد الفعلي
            const totalPossible = employees.length * workingDays.length;
            const confirmMsg = `سيتم إنشاء سجلات حضور لـ ${employees.length} موظف عبر ${workingDays.length} يوم عمل (الحد الأقصى ${totalPossible} سجل، مع تجاهل أي سجل موجود مسبقاً لنفس الموظف والتاريخ، وأي تاريخ يسبق تاريخ ربط الموظف بالشركة). سيتم أيضاً اختيار 3 أو 4 أيام عشوائية لكل موظف وتسجيلها تلقائياً كـ"غائب" لمحاكاة سجل حضور واقعي. هل تريد المتابعة؟`;
            if (!confirm(confirmMsg)) {
                submitBtn.disabled = false;
                submitBtn.textContent = originalText;
                return;
            }

            submitBtn.textContent = 'جاري التوليد والحفظ...';

            // 5. توليد السجلات: لكل يوم عمل، نخلط ترتيب الموظفين ونوزّع أوقات دخول/خروج
            //    مختلفة قدر الإمكان ضمن النطاقين المحددين، باستثناء أيام الغياب
            //    العشوائية المختارة مسبقاً لكل موظف (تُسجَّل كـ"غائب" بلا أوقات)
            const checkInFromMin = timeToMinutes(checkInFrom);
            const checkInToMin = timeToMinutes(checkInTo);
            const checkOutFromMin = timeToMinutes(checkOutFrom);
            const checkOutToMin = timeToMinutes(checkOutTo);

            const payloads = [];
            let skippedExisting = 0;
            let skippedBeforeLinkDate = 0;
            let randomAbsentGenerated = 0;

            workingDays.forEach(date => {
                const shuffledEmployees = shuffleArray(employees);
                const checkInTimes = distributeTimesInRange(checkInFromMin, checkInToMin, shuffledEmployees.length);
                const checkOutTimes = distributeTimesInRange(checkOutFromMin, checkOutToMin, shuffledEmployees.length);

                shuffledEmployees.forEach((emp, idx) => {
                    const key = `${emp.id}|${date}`;
                    if (existingKeys.has(key)) { skippedExisting++; return; }

                    // لا يمكن تسجيل حضور لموظف بتاريخ يسبق تاريخ ربطه بالشركة
                    const employeeLinkDate = linkDateByEmployeeId.get(emp.id);
                    if (employeeLinkDate && date < employeeLinkDate) { skippedBeforeLinkDate++; return; }

                    // 🛡️ نُسجِّل هذا المفتاح فوراً في existingKeys بمجرد تقرير توليد سجل
                    // له، قبل حتى إضافته لمصفوفة payloads — خط دفاع إضافي يضمن استحالة
                    // توليد سجلين لنفس الموظف بنفس التاريخ ضمن نفس عملية التوليد، حتى لو
                    // ظهر هذا الموظف أكثر من مرة لأي سبب غير متوقع.
                    existingKeys.add(key);

                    // هذا اليوم من ضمن أيام الغياب العشوائية المختارة لهذا الموظف تحديداً
                    const isRandomAbsentDay = absentDatesByEmployeeId.get(emp.id)?.has(date);
                    if (isRandomAbsentDay) {
                        payloads.push({
                            employee_id: emp.id,
                            date,
                            check_in: null,
                            check_out: null,
                            hours: null,
                            status: 'غائب',
                            created_at: buildCreatedAtFromDateAndTime(date, null)
                        });
                        randomAbsentGenerated++;
                        return;
                    }

                    const checkIn = checkInTimes[idx];
                    const checkOut = checkOutTimes[idx];

                    payloads.push({
                        employee_id: emp.id,
                        date,
                        check_in: checkIn,
                        check_out: checkOut,
                        hours: computeWorkedHours(checkIn, checkOut),
                        status,
                        // created_at يُحفظ بتاريخ ووقت خروج كل سجل بدل وقت الحفظ الفعلي بالخادم
                        created_at: buildCreatedAtFromDateAndTime(date, checkOut)
                    });
                });
            });

            if (payloads.length === 0) {
                showFormAlert('لم يتم إنشاء أي سجل جديد: كل السجلات الممكنة إما موجودة مسبقاً أو بتاريخ يسبق تاريخ ربط الموظف بالشركة.', 'error');
                return;
            }

            // 6. الحفظ على دفعات (Chunks) بحد أقصى 500 سجل بكل استدعاء تحسّباً لأعداد كبيرة
            const CHUNK_SIZE = 500;
            for (let i = 0; i < payloads.length; i += CHUNK_SIZE) {
                const chunk = payloads.slice(i, i + CHUNK_SIZE);
                const { error: insertError } = await dbClient.from('attendance').insert(chunk);
                if (insertError) throw new Error(insertError.message);
            }

            const skippedNotes = [];
            if (skippedExisting > 0) skippedNotes.push(`${skippedExisting} سجل كان موجوداً مسبقاً`);
            if (skippedBeforeLinkDate > 0) skippedNotes.push(`${skippedBeforeLinkDate} سجل كان بتاريخ يسبق تاريخ ربط الموظف بالشركة`);
            const skippedNote = skippedNotes.length ? ` (تم تجاهل ${skippedNotes.join(' و')})` : '';
            const absentNote = randomAbsentGenerated > 0 ? ` وشملت ${randomAbsentGenerated} سجل غياب عشوائي.` : '';

            showFormAlert(`تم إنشاء ${payloads.length} سجل حضور بنجاح!${skippedNote}${absentNote} جاري التحويل...`, 'success');
            setTimeout(() => { window.location.href = Routes.url('attendance'); }, 1800);

        } catch (error) {
            console.error('Bulk Attendance Generation Error:', error);
            showFormAlert('فشلت العملية: ' + error.message, 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
        }
    });
});
