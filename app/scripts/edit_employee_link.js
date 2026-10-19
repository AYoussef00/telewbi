// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================

let currentLinkId = null;

// =========================================================================
// 2. مكوّن قائمة قابلة للبحث (Searchable Combobox) — نفس منطق شاشة "ربط موظف جديد"
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

let companyCombobox = null;
let jobTitleCombobox = null;

// بيانات الشركات المحمَّلة (مفهرسة بالمعرّف) لاستخدامها في تعبئة قيمة اشتراك الربط تلقائياً
let companiesById = {};

// 🚩 يتحول لـ true بمجرد أن يعدّل المستخدم حقل "الراتب الأساسي" يدوياً بنفسه
// أثناء هذه الجلسة التعديلية؛ من تلك اللحظة نتوقف عن الكتابة فوق قيمته تلقائياً
// حتى لو تغيّر إجمالي الراتب لاحقاً بنفس هذا الربط. يبدأ false مع كل تحميل
// لبيانات ربط جديدة، بحيث يبقى تغيير إجمالي الراتب يُعيد حساب الأساسي تلقائياً
// ما لم يعدّله المستخدم بنفسه أثناء هذه الجلسة.
let basicSalaryManuallyEdited = false;

// =========================================================================
// 3. تحميل قائمة الشركات والمسميات الوظيفية لتغذية القوائم القابلة للبحث
// =========================================================================

// عند اختيار شركة أخرى من القائمة (تغيير يدوي من المستخدم)، نعبئ حقل "قيمة اشتراك
// الربط" تلقائياً بقيمة الاشتراك المسجّلة في بيانات هذه الشركة (companies.subscription_value)؛
// يبقى الحقل قابلاً للتعديل يدوياً بعد ذلك. ملاحظة: هذا لا يُنفَّذ عند التحميل الأولي
// لبيانات الربط المحفوظة (selectByValue لا يستدعي onSelectExtra)، فتبقى القيمة
// المحفوظة أصلاً بالربط كما هي حتى يغيّر المستخدم الشركة بنفسه.
function applyCompanySubscriptionValue(companyId) {
    const company = companiesById[String(companyId)];
    const subscriptionInput = document.getElementById('editLinkSubscriptionValue');
    if (!subscriptionInput || !company) return;
    if (company.subscription_value != null) {
        subscriptionInput.value = company.subscription_value;
        setFieldError('subscription_value', null);
    }
}

async function loadCompaniesForCombobox() {
    companyCombobox = setupSearchableCombobox({
        inputId: 'editLinkCompanySearch',
        hiddenId: 'editLinkCompanyId',
        dropdownId: 'editLinkCompanyDropdown',
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
        document.getElementById('editLinkCompanySearch').placeholder = 'تعذّر تحميل القائمة';
    }
}

async function loadJobTitlesForCombobox() {
    jobTitleCombobox = setupSearchableCombobox({
        inputId: 'editLinkJobTitleSearch',
        hiddenId: 'editLinkJobTitle',
        dropdownId: 'editLinkJobTitleDropdown',
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
        document.getElementById('editLinkJobTitleSearch').placeholder = 'تعذّر تحميل القائمة';
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

// =========================================================================
// 5. إظهار/إخفاء حقول الراتب (إجمالي/أساسي/صافي) حسب نوع الربط — تظهر فقط
//    عند اختيار "اضافة"
// =========================================================================
function updateSalaryFieldVisibility() {
    const linkType = document.getElementById('editLinkType').value;
    const isAddition = linkType === 'اضافة';

    const salaryGroup = document.getElementById('group-salary_value');
    const salaryInput = document.getElementById('editLinkSalaryValue');
    const basicGroup = document.getElementById('group-basic_salary_value');
    const basicInput = document.getElementById('editLinkBasicSalaryValue');
    const netGroup = document.getElementById('group-net_salary_value');
    const netInput = document.getElementById('editLinkNetSalaryValue');

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

// 🔢 الراتب الأساسي = نصف إجمالي الراتب افتراضياً عند تعديل إجمالي الراتب،
// ويبقى قابلاً للتعديل اليدوي؛ بمجرد أن يعدّله المستخدم يدوياً نتوقف عن
// الكتابة فوقه تلقائياً (basicSalaryManuallyEdited) حتى لو تغيّر إجمالي
// الراتب لاحقاً بنفس هذه الجلسة التعديلية.
function updateBasicSalaryFromTotal() {
    if (basicSalaryManuallyEdited) return;
    const totalRaw = document.getElementById('editLinkSalaryValue').value;
    const basicInput = document.getElementById('editLinkBasicSalaryValue');
    const total = parseFloat(totalRaw);
    if (totalRaw === '' || isNaN(total)) {
        basicInput.value = '';
        return;
    }
    basicInput.value = (total / 2).toFixed(2);
}

// 📅 تاريخ انتهاء الربط = تاريخ الربط + سنة كاملة دائماً (حقل للعرض فقط، غير
// قابل للتعديل اليدوي) — نفس منطق شاشة "ربط موظف جديد"، بحيث يُعاد حسابه فوراً
// لو المستخدم غيّر تاريخ الربط أثناء التعديل.
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
function updateLinkEndDateField() {
    const linkDate = document.getElementById('editLinkDate').value;
    document.getElementById('editLinkEndDate').value = computeLinkEndDate(linkDate);
}

// =========================================================================
// 5ب. 🆕 إظهار/إخفاء حقل "ملاحظة حالة قيد المعالجة" حسب قيمة "حالة الربط" —
//     يظهر فقط عند اختيار "قيد المعالجة"، ويصبح إلزامياً حينها (يُتحقَّق منه
//     صراحة عند الحفظ). يُفرَّغ ويُخفى تلقائياً عند العودة لـ"تم التعيين".
// =========================================================================
function updateLinkStatusNoteVisibility() {
    const status = document.getElementById('editLinkStatus').value;
    const isPending = status === 'قيد المعالجة';

    const noteGroup = document.getElementById('group-link_status_note');
    const noteInput = document.getElementById('editLinkStatusNote');

    noteGroup.style.display = isPending ? '' : 'none';
    if (!isPending) {
        setFieldError('link_status_note', null);
    }
}

// =========================================================================
// 6. جلب سجل الربط الحالي حسب المعرّف الممرَّر بالرابط (?id=...)
// =========================================================================
async function fetchLinkRecord(linkId) {
    const { data, error } = await dbClient
        .from('employee_links')
        .select('*, employees(name)')
        .eq('id', linkId)
        .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) throw new Error('LINK_NOT_FOUND');
    return data;
}

// =========================================================================
// 7. تعبئة النموذج ببيانات الربط الحالية بعد تحميل القوائم القابلة للبحث
// =========================================================================
function populateFormWithLink(link) {
    document.getElementById('editLinkEmployeeName').value = (link.employees && link.employees.name) ? link.employees.name : 'غير محدد';

    if (jobTitleCombobox) jobTitleCombobox.selectByValue(link.job_title || '');
    if (companyCombobox) companyCombobox.selectByValue(link.company_id != null ? String(link.company_id) : '');

    const linkTypeSelect = document.getElementById('editLinkType');
    linkTypeSelect.value = link.link_type || '';
    updateSalaryFieldVisibility();

    // 🆕 حالة الربط + ملاحظتها — السجلات القديمة (قبل إضافة هذا الحقل) تُعامَل
    // كـ "تم التعيين" افتراضياً (نفس القيمة الافتراضية بقاعدة البيانات).
    document.getElementById('editLinkStatus').value = link.link_status || 'تم التعيين';
    document.getElementById('editLinkStatusNote').value = link.link_status_note || '';
    updateLinkStatusNoteVisibility();

    const linkDateInput = document.getElementById('editLinkDate');
    linkDateInput.value = link.link_date ? String(link.link_date).split('T')[0] : '';
    // نعيد حساب تاريخ الانتهاء دائماً من تاريخ الربط الحالي (بدل قراءة القيمة
    // المخزّنة فقط) حتى يبقى الحقلان متسقين مع القاعدة الثابتة "سنة كاملة" حتى
    // لو كان هناك سجل قديم بقيمة محفوظة مختلفة لأي سبب.
    updateLinkEndDateField();

    document.getElementById('editLinkSubscriptionValue').value = link.subscription_value != null ? link.subscription_value : '';
    document.getElementById('editLinkSalaryValue').value = link.salary_value != null ? link.salary_value : '';
    document.getElementById('editLinkBasicSalaryValue').value = link.basic_salary_value != null ? link.basic_salary_value : '';
    document.getElementById('editLinkNetSalaryValue').value = link.net_salary_value != null ? link.net_salary_value : '';
    // نصفّر علامة "تم تعديله يدوياً" مع كل تحميل بيانات ربط جديدة، بحيث لو عدّل
    // المستخدم إجمالي الراتب أثناء هذه الجلسة التعديلية يُعاد حساب الأساسي
    // تلقائياً ما لم يلمس حقل الأساسي بنفسه أولاً
    basicSalaryManuallyEdited = false;

    document.getElementById('editLinkFields').style.display = 'block';
    document.getElementById('btnSubmitEditLink').style.display = 'inline-flex';
}

// =========================================================================
// 8. حفظ التعديلات
// =========================================================================
async function handleEditLinkSubmit(event) {
    event.preventDefault();
    hideFormAlert();

    const jobTitle = document.getElementById('editLinkJobTitle').value;
    const companyId = document.getElementById('editLinkCompanyId').value;
    const linkType = document.getElementById('editLinkType').value;
    const linkStatus = document.getElementById('editLinkStatus').value;
    const linkStatusNote = document.getElementById('editLinkStatusNote').value.trim();
    const linkDate = document.getElementById('editLinkDate').value;
    const subscriptionValueRaw = document.getElementById('editLinkSubscriptionValue').value;
    const salaryValueRaw = document.getElementById('editLinkSalaryValue').value;
    const basicSalaryValueRaw = document.getElementById('editLinkBasicSalaryValue').value;
    const netSalaryValueRaw = document.getElementById('editLinkNetSalaryValue').value;
    const isAddition = linkType === 'اضافة';
    const isPendingStatus = linkStatus === 'قيد المعالجة';

    let hasError = false;
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

    const form = document.getElementById('editLinkForm');
    const submitBtn = form.querySelector('.btn-submit');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'جاري حفظ التعديلات...';

    try {
        const payload = {
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

        // ⚠️ نطلب .select() على التحديث حتى نعرف بالضبط هل تم تعديل السجل فعلياً؛
        // فبعض إعدادات RLS بسوبابيس تمنع التحديث بصمت (تُرجع نجاحاً بدون أي صف
        // مُعدَّل فعلياً بدل رسالة خطأ صريحة) — وهذا بالضبط ما كان يجعل رسالة
        // "تم حفظ التعديلات بنجاح" تظهر دائماً حتى لو لم يتغيّر شيء فعلياً في
        // قاعدة البيانات، فيبدو للمستخدم أن "تعديل الربط لا يعمل".
        const { data: updatedRows, error } = await dbClient
            .from('employee_links')
            .update(payload)
            .eq('id', currentLinkId)
            .select();

        if (error) throw new Error(error.message);

        if (!updatedRows || updatedRows.length === 0) {
            showFormAlert("لم يتم حفظ التعديلات فعلياً. غالباً السبب عدم وجود سياسة تحديث (RLS UPDATE Policy) على جدول employee_links في سوبابيس.", 'error');
            return;
        }

        showFormAlert('تم حفظ تعديلات الربط بنجاح! جاري التحويل...', 'success');
        setTimeout(() => { window.location.href = Routes.url('employee_links'); }, 1400);

    } catch (error) {
        console.error('Employee Link Update Error:', error);
        showFormAlert('فشلت العملية: ' + error.message, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
    }
}

// =========================================================================
// 9. ربط الأحداث وتحميل بيانات الربط عند فتح الصفحة
// =========================================================================
document.addEventListener('DOMContentLoaded', async function() {
    const allowed = await Permissions.guardPage('employee_links');
    if (!allowed) return;

    const urlParams = new URLSearchParams(window.location.search);
    currentLinkId = urlParams.get('id');

    const cancelBtn = document.getElementById('btnCancel');
    cancelBtn.addEventListener('click', function() {
        if (confirm('هل أنت متأكد من إلغاء التعديل؟ لن يتم حفظ أي تغييرات.')) {
            window.location.href = Routes.url('employee_links');
        }
    });

    const linkTypeSelect = document.getElementById('editLinkType');
    linkTypeSelect.addEventListener('change', updateSalaryFieldVisibility);

    // 🆕 حالة الربط: إظهار/إخفاء حقل الملاحظة فوراً عند تغيير الحالة
    const linkStatusSelect = document.getElementById('editLinkStatus');
    linkStatusSelect.addEventListener('change', updateLinkStatusNoteVisibility);

    const linkDateInput = document.getElementById('editLinkDate');
    linkDateInput.addEventListener('change', updateLinkEndDateField);
    linkDateInput.addEventListener('input', updateLinkEndDateField);

    // إجمالي الراتب يعبئ "الراتب الأساسي" تلقائياً بنصف قيمته ما لم يُعدَّل يدوياً
    const salaryTotalInput = document.getElementById('editLinkSalaryValue');
    salaryTotalInput.addEventListener('input', updateBasicSalaryFromTotal);

    const basicSalaryInput = document.getElementById('editLinkBasicSalaryValue');
    basicSalaryInput.addEventListener('input', () => { basicSalaryManuallyEdited = true; });

    if (!currentLinkId) {
        showFormAlert('لم يتم تحديد أي ربط لتعديل بياناته.', 'error');
        return;
    }

    try {
        const [, , link] = await Promise.all([
            loadCompaniesForCombobox(),
            loadJobTitlesForCombobox(),
            fetchLinkRecord(currentLinkId)
        ]);
        populateFormWithLink(link);
    } catch (error) {
        console.error('تعذّر تحميل بيانات الربط للتعديل:', error.message);
        const notFound = error.message === 'LINK_NOT_FOUND';
        showFormAlert(
            notFound ? 'تعذّر العثور على سجل الربط هذا، ربما تم حذفه.' : 'تعذّر تحميل بيانات الربط: ' + error.message,
            'error'
        );
        return;
    }

    const form = document.getElementById('editLinkForm');
    form.addEventListener('submit', handleEditLinkSubmit);
});
