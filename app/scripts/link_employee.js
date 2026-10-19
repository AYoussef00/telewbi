// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================

// =========================================================================
// 2. مكوّن قائمة قابلة للبحث (Searchable Combobox) — نفس منطق شاشات الحضور/الموظفين
//
//    ⚠️ كل خيار (option) يدعم الآن حقلين إضافيين اختياريين بجانب label/value:
//    - searchText: نص إضافي يُستخدم بالبحث فقط (بدون عرضه كقيمة الحقل بعد
//      الاختيار)؛ يسمح بالبحث بمعايير متعددة (مثال: اسم الموظف + رقم الهوية
//      معاً) بينما يبقى المعروض بحقل الإدخال بعد الاختيار هو label فقط.
//    - sublabel: نص إضافي يظهر بجانب label داخل عنصر القائمة المنسدلة فقط
//      (مثال: رقم الهوية بجانب الاسم) لمساعدة المستخدم على التمييز بين
//      الأسماء المتشابهة أثناء البحث، دون التأثير على القيمة المعروضة بالحقل.
// =========================================================================
function setupSearchableCombobox({ inputId, hiddenId, dropdownId, options, emptyText, onSelectExtra }) {
    const input = document.getElementById(inputId);
    const hidden = document.getElementById(hiddenId);
    const dropdown = document.getElementById(dropdownId);

    function renderOptions(filterText) {
        const normalized = (filterText || '').trim().toLowerCase();
        const filtered = normalized
            ? options.filter(opt => (opt.searchText || opt.label).toLowerCase().includes(normalized))
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

            if (opt.sublabel) {
                // نبني المحتوى عبر عناصر DOM منفصلة (وليس innerHTML) حتى لا يُفسَّر
                // اسم الموظف أو رقم هويته القادمَين من قاعدة البيانات كـ HTML أبداً
                const labelSpan = document.createElement('span');
                labelSpan.textContent = opt.label;
                const subSpan = document.createElement('span');
                subSpan.textContent = ' — ' + opt.sublabel;
                subSpan.style.cssText = 'color:#94a3b8; font-size:0.85rem; font-family: monospace;';
                item.appendChild(labelSpan);
                item.appendChild(subSpan);
            } else {
                item.textContent = opt.label;
            }

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
let companyCombobox = null;
let jobTitleCombobox = null;

// بيانات الشركات المحمَّلة (مفهرسة بالمعرّف) لاستخدامها في تعبئة قيمة اشتراك الربط تلقائياً
let companiesById = {};

// 🚩 يتحول لـ true بمجرد أن يعدّل المستخدم حقل "الراتب الأساسي" يدوياً بنفسه؛
// من تلك اللحظة نتوقف عن الكتابة فوق قيمته تلقائياً حتى لو تغيّر إجمالي الراتب
// لاحقاً — نفس فكرة "قيمة اشتراك الربط" التي تُعبَّأ تلقائياً من بيانات الشركة
// ثم تبقى قابلة للتعديل اليدوي بعدها دون الكتابة فوقها مجدداً.
let basicSalaryManuallyEdited = false;

// =========================================================================
// 3. تحميل قائمة الموظفين والشركات والمسميات الوظيفية لتغذية القوائم القابلة للبحث
// =========================================================================
async function loadEmployeesForCombobox() {
    employeeCombobox = setupSearchableCombobox({
        inputId: 'linkEmployeeSearch',
        hiddenId: 'linkEmployeeId',
        dropdownId: 'linkEmployeeDropdown',
        options: [],
        emptyText: 'لا يوجد موظفون مطابقون',
        onSelectExtra: () => setFieldError('employee_id', null) // إخفاء أي تنبيه ربط سابق فور تغيير الاختيار
    });

    try {
        // ⚠️ يشمل الجلب رقم الهوية أيضاً (وليس الاسم فقط) لأن حقل البحث بهذه
        // الشاشة يَعِد صراحة بالبحث "باسم الموظف أو رقم الهوية" — رقم الهوية
        // يُستخدم كنص بحث إضافي (searchText) ويظهر كتلميح بجانب كل اسم بالقائمة
        // المنسدلة (sublabel)، بينما يبقى المعروض بالحقل بعد الاختيار اسم
        // الموظف فقط، تماماً كما كان سابقاً.
        const { data, error } = await dbClient.from('employees').select('id, name, national_id').order('name', { ascending: true });
        if (error) throw new Error(error.message);

        const options = (data || []).map(emp => ({
            value: String(emp.id),
            label: emp.name,
            sublabel: emp.national_id || null,
            searchText: `${emp.name || ''} ${emp.national_id || ''}`.toLowerCase()
        }));
        employeeCombobox.setOptions(options);
        employeeCombobox.enable(options.length ? 'ابحث بالاسم أو رقم الهوية أو اختر من القائمة' : 'لا يوجد موظفون مضافون بعد');
    } catch (error) {
        console.error('تعذّر تحميل قائمة الموظفين:', error.message);
        document.getElementById('linkEmployeeSearch').placeholder = 'تعذّر تحميل القائمة';
    }
}

// عند اختيار شركة من القائمة، نعبئ حقل "قيمة اشتراك الربط" تلقائياً بقيمة الاشتراك
// المسجّلة في بيانات هذه الشركة (companies.subscription_value)؛ يبقى الحقل قابلاً
// للتعديل يدوياً بعد ذلك لو أراد المستخدم قيمة مختلفة لهذا الربط تحديداً
function applyCompanySubscriptionValue(companyId) {
    const company = companiesById[String(companyId)];
    const subscriptionInput = document.getElementById('linkSubscriptionValue');
    if (!subscriptionInput || !company) return;
    if (company.subscription_value != null) {
        subscriptionInput.value = company.subscription_value;
        setFieldError('subscription_value', null);
    }
}

async function loadCompaniesForCombobox() {
    companyCombobox = setupSearchableCombobox({
        inputId: 'linkCompanySearch',
        hiddenId: 'linkCompanyId',
        dropdownId: 'linkCompanyDropdown',
        options: [],
        emptyText: 'لا توجد شركات مطابقة',
        onSelectExtra: (opt) => applyCompanySubscriptionValue(opt.value)
    });

    try {
        const { data, error } = await dbClient.from('companies').select('id, name, subscription_value').order('name', { ascending: true });
        if (error) throw new Error(error.message);

        companiesById = {};
        (data || []).forEach((c) => { companiesById[String(c.id)] = c; });

        const options = (data || []).map(c => ({ value: String(c.id), label: c.name }));
        companyCombobox.setOptions(options);
        companyCombobox.enable(options.length ? 'ابحث أو اختر اسم الشركة' : 'لا توجد شركات مضافة بعد');
    } catch (error) {
        console.error('تعذّر تحميل قائمة الشركات:', error.message);
        document.getElementById('linkCompanySearch').placeholder = 'تعذّر تحميل القائمة';
    }
}

// المسمى الوظيفي يُحمّل من جدول professions (نفس مصدر شاشة تعديل الموظف)، ويُخزَّن كنص مباشرة
async function loadJobTitlesForCombobox() {
    jobTitleCombobox = setupSearchableCombobox({
        inputId: 'linkJobTitleSearch',
        hiddenId: 'linkJobTitle',
        dropdownId: 'linkJobTitleDropdown',
        options: [],
        emptyText: 'لا توجد مسميات وظيفية مطابقة'
    });

    try {
        const { data, error } = await dbClient.from('professions').select('id, name_ar').order('name_ar', { ascending: true });
        if (error) throw new Error(error.message);

        const options = (data || []).map(p => ({ value: p.name_ar, label: p.name_ar }));
        jobTitleCombobox.setOptions(options);
        jobTitleCombobox.enable(options.length ? 'ابحث أو اختر المسمى الوظيفي' : 'لا توجد مسميات وظيفية مضافة بعد');
    } catch (error) {
        console.error('تعذّر تحميل المسميات الوظيفية:', error.message);
        document.getElementById('linkJobTitleSearch').placeholder = 'تعذّر تحميل القائمة';
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

// 📅 تاريخ اليوم بصيغة YYYY-MM-DD حسب توقيت جهاز المستخدم (بدون استخدام valueAsDate
// حتى لا ينزاح التاريخ يوماً بسبب فارق التوقيت العالمي UTC عند التحويل)
function getTodayDateString() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

// 📅 تاريخ انتهاء الربط = تاريخ الربط + سنة كاملة دائماً (حقل للعرض فقط، غير
// قابل للتعديل اليدوي). نستخدم كائن Date بدل التلاعب النصي المباشر بالسنة حتى
// تُعالَج حالة 29 فبراير بشكل صحيح تلقائياً (تتحول لـ 1 مارس بالسنة التالية إن
// لم تكن سنة كبيسة)، تماماً كما تتعامل معظم الأنظمة مع هذه الحالة الاستثنائية.
function computeLinkEndDate(linkDateStr) {
    if (!linkDateStr) return '';
    const d = new Date(linkDateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return '';
    d.setFullYear(d.getFullYear() + 1);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

// يُعيد حساب حقل "تاريخ انتهاء الربط" فور أي تغيير في "تاريخ الربط"
function updateLinkEndDateField() {
    const linkDate = document.getElementById('linkDate').value;
    document.getElementById('linkEndDate').value = computeLinkEndDate(linkDate);
}

// =========================================================================
// 5. إظهار/إخفاء حقول الراتب (إجمالي/أساسي/صافي) حسب نوع الربط — تظهر فقط
//    عند اختيار "اضافة"
// =========================================================================
function updateSalaryFieldVisibility() {
    const linkType = document.getElementById('linkType').value;
    const isAddition = linkType === 'اضافة';

    const salaryGroup = document.getElementById('group-salary_value');
    const salaryInput = document.getElementById('linkSalaryValue');
    const basicGroup = document.getElementById('group-basic_salary_value');
    const basicInput = document.getElementById('linkBasicSalaryValue');
    const netGroup = document.getElementById('group-net_salary_value');
    const netInput = document.getElementById('linkNetSalaryValue');

    salaryGroup.style.display = isAddition ? '' : 'none';
    basicGroup.style.display = isAddition ? '' : 'none';
    netGroup.style.display = isAddition ? '' : 'none';

    if (!isAddition) {
        salaryInput.value = '';
        basicInput.value = '';
        netInput.value = '';
        basicSalaryManuallyEdited = false;
        setFieldError('salary_value', null);
        setFieldError('basic_salary_value', null);
        setFieldError('net_salary_value', null);
    }
}

// 🔢 الراتب الأساسي = نصف إجمالي الراتب افتراضياً عند كتابة/تغيير إجمالي
// الراتب، ويبقى قابلاً للتعديل اليدوي؛ بمجرد أن يعدّله المستخدم يدوياً نتوقف
// عن الكتابة فوقه تلقائياً (basicSalaryManuallyEdited) حتى لو تغيّر إجمالي
// الراتب لاحقاً بنفس هذا الربط.
function updateBasicSalaryFromTotal() {
    if (basicSalaryManuallyEdited) return;
    const totalRaw = document.getElementById('linkSalaryValue').value;
    const basicInput = document.getElementById('linkBasicSalaryValue');
    const total = parseFloat(totalRaw);
    if (totalRaw === '' || isNaN(total)) {
        basicInput.value = '';
        return;
    }
    basicInput.value = (total / 2).toFixed(2);
}

// =========================================================================
// 5ب. 🆕 إظهار/إخفاء حقل "ملاحظة حالة قيد المعالجة" حسب قيمة "حالة الربط" —
//     يظهر فقط عند اختيار "قيد المعالجة"، ويصبح إلزامياً حينها (يُتحقَّق منه
//     صراحة عند الحفظ). يُفرَّغ ويُخفى تلقائياً عند العودة لـ"تم التعيين" حتى
//     لا تُحفظ ملاحظة قديمة بالخطأ مع حالة "مكتملة".
// =========================================================================
function updateLinkStatusNoteVisibility() {
    const status = document.getElementById('linkStatus').value;
    const isPending = status === 'قيد المعالجة';

    const noteGroup = document.getElementById('group-link_status_note');
    const noteInput = document.getElementById('linkStatusNote');

    noteGroup.style.display = isPending ? '' : 'none';
    if (!isPending) {
        noteInput.value = '';
        setFieldError('link_status_note', null);
    }
}

// =========================================================================
// 6. التحقق من عدم ربط نفس الموظف بأكثر من شركة (كل موظف يُربط بشركة واحدة فقط)
//
//    ⚠️ بعد تحويل "إنهاء الربط" ليصبح تعليماً بتاريخ انتهاء (link_end_date)
//    بدل حذف صف الربط فعلياً، أصبحت صفوف employee_links للموظفين المُنهى
//    ربطهم تبقى موجودة بالجدول (بدل حذفها). لذا لا بد من تقييد هذا الفحص
//    بالروابط النشطة فقط (بلا تاريخ انتهاء، أو بتاريخ انتهاء لم يحِن بعد)،
//    وإلا سيُمنع خطأً ربط موظف سبق إنهاء ربطه بشركة أخرى (أو حتى بنفس
//    الشركة مجدداً) رغم أنه غير مرتبط فعلياً بأي شركة حالياً.
//
//    🆕 ملاحظة مهمة حول حد "اليوم نفسه": في كل الشاشات الأخرى (الحضور،
//    الفواتير، التقارير...) يُعامَل تاريخ الانتهاء كآخر يوم لا يزال الموظف
//    محتسباً فيه على شركته القديمة (بحيث يُحتسب حضوره/راتبه ذلك اليوم بشكل
//    صحيح) — وهذا يبقى صحيحاً ولم يتغيّر في أي مكان آخر بالنظام. لكن هذا
//    الفحص هنا تحديداً (هل يمكن ربط الموظف بشركة جديدة؟) يستخدم ">" الصارمة
//    بدل ">=" عمداً: بمجرد أن يُنهي المستخدم ربط الموظف (حتى بتاريخ اليوم
//    نفسه)، يُسمح بربطه فوراً بشركة أخرى بنفس اليوم — وهو ما يلزم فعلياً في
//    حالات نقل الموظف لشركة جديدة بنفس يوم انتهاء تعاقده مع القديمة، بدل
//    إجباره على الانتظار ليوم كامل قبل إتمام النقل.
// =========================================================================
async function findExistingLinkForEmployee(employeeId) {
    const { data, error } = await dbClient
        .from('employee_links')
        .select('id, companies(name)')
        .eq('employee_id', employeeId)
        .or(`link_end_date.is.null,link_end_date.gt.${getTodayDateString()}`)
        .maybeSingle();

    if (error) throw new Error(error.message);
    return data || null;
}

// =========================================================================
// 7. ربط الأحداث وحفظ الربط
// =========================================================================
document.addEventListener('DOMContentLoaded', async function() {
    const allowed = await Permissions.guardPage('employee_links');
    if (!allowed) return;

    loadEmployeesForCombobox();
    loadCompaniesForCombobox();
    loadJobTitlesForCombobox();

    // تعبئة تاريخ الربط تلقائياً بتاريخ اليوم؛ يبقى قابلاً للتعديل يدوياً
    const linkDateInput = document.getElementById('linkDate');
    if (linkDateInput && !linkDateInput.value) {
        linkDateInput.value = getTodayDateString();
    }

    // تاريخ انتهاء الربط يُحسب فوراً من تاريخ الربط الحالي، ويُعاد حسابه تلقائياً
    // في كل مرة يُغيَّر فيها تاريخ الربط يدوياً
    updateLinkEndDateField();
    linkDateInput.addEventListener('change', updateLinkEndDateField);
    linkDateInput.addEventListener('input', updateLinkEndDateField);

    const linkTypeSelect = document.getElementById('linkType');
    linkTypeSelect.addEventListener('change', updateSalaryFieldVisibility);
    updateSalaryFieldVisibility();

    // 🆕 حالة الربط: إظهار/إخفاء حقل الملاحظة فوراً عند تغيير الحالة
    const linkStatusSelect = document.getElementById('linkStatus');
    linkStatusSelect.addEventListener('change', updateLinkStatusNoteVisibility);
    updateLinkStatusNoteVisibility();

    // إجمالي الراتب يعبئ "الراتب الأساسي" تلقائياً بنصف قيمته ما لم يُعدَّل يدوياً
    const salaryTotalInput = document.getElementById('linkSalaryValue');
    salaryTotalInput.addEventListener('input', updateBasicSalaryFromTotal);

    const basicSalaryInput = document.getElementById('linkBasicSalaryValue');
    basicSalaryInput.addEventListener('input', () => { basicSalaryManuallyEdited = true; });

    const cancelBtn = document.getElementById('btnCancel');
    cancelBtn.addEventListener('click', function() {
        if (confirm('هل أنت متأكد من إلغاء العملية؟ لن يتم حفظ البيانات.')) {
            window.location.href = Routes.url('employee_links');
        }
    });

    const form = document.getElementById('linkEmployeeForm');
    form.addEventListener('submit', async function(event) {
        event.preventDefault();
        hideFormAlert();

        const employeeId = document.getElementById('linkEmployeeId').value;
        const jobTitle = document.getElementById('linkJobTitle').value;
        const companyId = document.getElementById('linkCompanyId').value;
        const linkType = document.getElementById('linkType').value;
        const linkStatus = document.getElementById('linkStatus').value;
        const linkStatusNote = document.getElementById('linkStatusNote').value.trim();
        const linkDate = document.getElementById('linkDate').value;
        const subscriptionValueRaw = document.getElementById('linkSubscriptionValue').value;
        const salaryValueRaw = document.getElementById('linkSalaryValue').value;
        const basicSalaryValueRaw = document.getElementById('linkBasicSalaryValue').value;
        const netSalaryValueRaw = document.getElementById('linkNetSalaryValue').value;
        const isAddition = linkType === 'اضافة';
        const isPendingStatus = linkStatus === 'قيد المعالجة';

        let hasError = false;
        if (!employeeId) { setFieldError('employee_id', 'الرجاء اختيار الموظف.'); hasError = true; } else setFieldError('employee_id', null);
        if (!jobTitle) { setFieldError('job_title', 'الرجاء اختيار المسمى الوظيفي.'); hasError = true; } else setFieldError('job_title', null);
        if (!companyId) { setFieldError('company_id', 'الرجاء اختيار الشركة.'); hasError = true; } else setFieldError('company_id', null);
        if (!linkType) { setFieldError('link_type', 'الرجاء تحديد نوع الربط.'); hasError = true; } else setFieldError('link_type', null);
        if (!linkDate) { setFieldError('link_date', 'الرجاء تحديد تاريخ الربط.'); hasError = true; } else setFieldError('link_date', null);
        if (subscriptionValueRaw === '' || isNaN(parseFloat(subscriptionValueRaw)) || parseFloat(subscriptionValueRaw) < 0) {
            setFieldError('subscription_value', 'الرجاء إدخال قيمة اشتراك ربط صحيحة.'); hasError = true;
        } else setFieldError('subscription_value', null);

        // 🆕 حالة "قيد المعالجة" تتطلب ملاحظة إلزامية توضّح السبب/التفاصيل
        if (isPendingStatus && !linkStatusNote) {
            setFieldError('link_status_note', 'الرجاء كتابة ملاحظة توضّح سبب كون الربط قيد المعالجة.');
            hasError = true;
        } else {
            setFieldError('link_status_note', null);
        }

        if (isAddition) {
            if (salaryValueRaw === '' || isNaN(parseFloat(salaryValueRaw)) || parseFloat(salaryValueRaw) < 0) {
                setFieldError('salary_value', 'الرجاء إدخال إجمالي الراتب.'); hasError = true;
            } else setFieldError('salary_value', null);

            if (basicSalaryValueRaw === '' || isNaN(parseFloat(basicSalaryValueRaw)) || parseFloat(basicSalaryValueRaw) < 0) {
                setFieldError('basic_salary_value', 'الرجاء إدخال الراتب الأساسي.'); hasError = true;
            } else setFieldError('basic_salary_value', null);

            if (netSalaryValueRaw === '' || isNaN(parseFloat(netSalaryValueRaw)) || parseFloat(netSalaryValueRaw) < 0) {
                setFieldError('net_salary_value', 'الرجاء إدخال الراتب الصافي.'); hasError = true;
            } else setFieldError('net_salary_value', null);
        }

        if (hasError) {
            showFormAlert('الرجاء تصحيح الحقول المظللة أدناه.', 'error');
            return;
        }

        const submitBtn = form.querySelector('.btn-submit');
        const originalText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = 'جاري التحقق...';

        try {
            // لا يمكن ربط نفس الموظف بأكثر من شركة: نتحقق أولاً من عدم وجود ربط سابق لهذا الموظف
            const existingLink = await findExistingLinkForEmployee(parseInt(employeeId, 10));
            if (existingLink) {
                const existingCompanyName = (existingLink.companies && existingLink.companies.name) ? existingLink.companies.name : 'شركة أخرى';
                const dupMsg = `هذا الموظف مرتبط بالفعل بشركة "${existingCompanyName}". لا يمكن ربط الموظف بأكثر من شركة، يجب حذف الربط الحالي أولاً من صفحة "ربط الموظفين" قبل إضافة ربط جديد.`;
                setFieldError('employee_id', 'هذا الموظف مرتبط بالفعل بشركة أخرى.');
                showFormAlert(dupMsg, 'error');
                return;
            }

            submitBtn.textContent = 'جاري الحفظ...';

            const payload = {
                employee_id: parseInt(employeeId, 10),
                company_id: parseInt(companyId, 10),
                job_title: jobTitle,
                link_type: linkType,
                link_status: linkStatus,
                link_status_note: isPendingStatus ? linkStatusNote : null,
                link_date: linkDate,
                link_end_date: computeLinkEndDate(linkDate) || null,
                subscription_value: parseFloat(subscriptionValueRaw),
                salary_value: isAddition ? parseFloat(salaryValueRaw) : null,
                basic_salary_value: isAddition ? parseFloat(basicSalaryValueRaw) : null,
                net_salary_value: isAddition ? parseFloat(netSalaryValueRaw) : null
            };

            const { error } = await dbClient.from('employee_links').insert([payload]);
            if (error) throw new Error(error.message);

            // ✅ تفعيل حالة الموظف تلقائياً فور ربطه بشركة — الحالة تتبع نشاط الربط
            // ولا تُدار يدوياً من شاشة تعديل بيانات الموظف (أصبحت للعرض فقط هناك).
            const { error: statusUpdateError } = await dbClient
                .from('employees')
                .update({ status: 'active' })
                .eq('id', payload.employee_id);

            if (statusUpdateError) {
                console.error('تعذّر تحديث حالة الموظف تلقائياً بعد الربط:', statusUpdateError.message);
                // لا نوقف العملية بسبب هذا الخطأ الثانوي؛ الربط نفسه تم حفظه بنجاح بالفعل
            }

            showFormAlert('تم حفظ الربط بنجاح! جاري التحويل...', 'success');
            setTimeout(() => { window.location.href = Routes.url('employee_links'); }, 1400);

        } catch (error) {
            console.error('Employee Link Insert Error:', error);
            showFormAlert('فشلت العملية: ' + error.message, 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
        }
    });
});
