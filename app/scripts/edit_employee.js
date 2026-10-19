// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================

// اسم Bucket المستخدم لتخزين مستندات الموظفين على Supabase Storage
const EMPLOYEE_DOCS_BUCKET = "employee-documents";
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

// كلمة المرور الافتراضية لأي حساب موظف جديد يُنشأ من هذه الشاشة (نفس شاشة "إضافة موظف").
// يُجبر الموظف على تغييرها فور أول تسجيل دخول (عبر علامة must_change_password بجدول users).
const DEFAULT_EMPLOYEE_PASSWORD = "Basma@1234";

// هل خيار "إنشاء حساب دخول للموظف" مُفعّل حالياً؟ يظهر هذا الخيار فقط لو الموظف
// ما عنده حساب دخول أصلاً (انظر توضيح إظهار/إخفاء group-create_account في
// populateFormWithEmployee أدناه)، لذا القيمة الاحتياطية عند تعذّر إيجاد الـ
// checkbox بالصفحة لأي سبب هي false.
function isAccountCreationEnabled() {
    const checkbox = document.getElementById('empCreateAccount');
    return checkbox ? checkbox.checked : false;
}

// معرّف الموظف الجاري تعديله والنسخة الأصلية من بياناته (تُستخدم للمقارنة عند الحفظ)
let currentEmployeeId = null;
let currentEmployeeRecord = null;

// 📅 تاريخ اليوم بصيغة YYYY-MM-DD حسب توقيت جهاز المستخدم — يُستخدم لتقييد جلب
// سجل ربط الموظف الحالي (المسمى الوظيفي/الشركة المعروضان بهذه الشاشة) على
// الروابط النشطة فقط. ⚠️ ضروري بعد أن أصبح "إنهاء ربط موظف" يُسجِّل تاريخ
// انتهاء بدل حذف السجل فعلياً: بدون هذا الفلتر قد يحمل الموظف أكثر من صف ربط
// (المُنهى + الجديد إن أُعيد ربطه لاحقاً)، فيتسبب .maybeSingle() بخطأ "multiple
// rows returned"، أو يُعرض بالخطأ المسمى الوظيفي/الشركة القديمين المُنهيين.
function getTodayDateStringForLinks() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

// =========================================================================
// 1.5 إدارة حذف/إرفاق المستندات الرسمية — تُتاح بجانب الاسم/رقم الهوية/تاريخ
//     الميلاد/رقم الآيبان. كل مستند إما يبقى كما هو، أو يُستبدل بملف جديد
//     (اختيار ملف)، أو يُعلَّم للحذف عبر زر "حذف الملف الحالي".
// =========================================================================
const DOCUMENT_FIELD_MAP = {
    cv_url: { noteId: 'currentFileCv', inputId: 'empCvFile' },
    id_photo_url: { noteId: 'currentFileIdPhoto', inputId: 'empIdPhotoFile' },
    iban_certificate_url: { noteId: 'currentFileIbanCert', inputId: 'empIbanCertFile' },
    national_address_url: { noteId: 'currentFileAddress', inputId: 'empAddressFile' }
};

// حالة "معلّم للحذف" لكل نوع مستند؛ تُصفَّر تلقائياً عند اختيار ملف جديد لنفس الحقل
let documentRemovalFlags = {
    cv_url: false,
    id_photo_url: false,
    iban_certificate_url: false,
    national_address_url: false
};

// يبني محتوى صندوق "الملف الحالي" لمستند معيّن حسب حالته (موجود / معلّم للحذف / غير موجود)
function renderDocumentNote(key) {
    const fieldInfo = DOCUMENT_FIELD_MAP[key];
    if (!fieldInfo) return;
    const el = document.getElementById(fieldInfo.noteId);
    if (!el) return;

    const url = currentEmployeeRecord ? currentEmployeeRecord[key] : null;
    el.style.display = 'block';

    if (documentRemovalFlags[key]) {
        el.innerHTML = `<span style="color:#ef4444;">🗑️ سيتم حذف الملف الحالي عند حفظ التعديلات.</span> <button type="button" onclick="undoRemoveDocument('${key}')" style="cursor:pointer; background:none; border:none; color:#2563eb; text-decoration:underline; font-size:0.85rem; margin-inline-start:6px;">تراجع عن الحذف</button>`;
        return;
    }

    if (url) {
        el.innerHTML = `📎 الملف الحالي: <a href="${url}" target="_blank" rel="noopener">عرض الملف</a> <button type="button" class="action-icon-btn" title="حذف الملف الحالي" onclick="markDocumentForRemoval('${key}')" style="color:#ef4444; cursor:pointer; background:none; border:none; margin-inline-start:6px; vertical-align:middle;">${ICONS.trash}</button>`;
    } else {
        el.innerHTML = 'لا يوجد ملف مرفوع حالياً.';
    }
}

// 🗑️ يُعلِّم مستنداً معيّناً للحذف عند الحفظ، ويُلغي أي ملف جديد كان قد اختير لنفس الحقل
function markDocumentForRemoval(key) {
    documentRemovalFlags[key] = true;
    const fieldInfo = DOCUMENT_FIELD_MAP[key];
    if (fieldInfo) {
        const input = document.getElementById(fieldInfo.inputId);
        if (input) input.value = '';
        const preview = document.getElementById('fileName' + fieldInfo.inputId.replace('emp', '').replace('File', ''));
        // إعادة تعيين نص معاينة اسم الملف المختار (إن وُجد) إلى حالته الافتراضية
        if (preview) {
            preview.classList.remove('has-file');
        }
    }
    renderDocumentNote(key);
}

// ↩️ تراجع عن تعليم مستند للحذف، فيعود لعرض رابط الملف الحالي كما كان
function undoRemoveDocument(key) {
    documentRemovalFlags[key] = false;
    renderDocumentNote(key);
}

// =========================================================================
// 2. مكوّن قائمة قابلة للبحث (Searchable Combobox) قابل لإعادة الاستخدام
//    (نفس منطق شاشة "إضافة موظف" لضمان تطابق تجربة الاستخدام)
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

    function closeDropdown() {
        dropdown.classList.remove('open');
    }

    function getSelectedLabel() {
        const match = options.find(opt => String(opt.value) === String(hidden.value));
        return match ? match.label : '';
    }

    input.addEventListener('focus', () => {
        input.select();
        openDropdown();
    });

    input.addEventListener('input', () => {
        renderOptions(input.value);
        dropdown.classList.add('open');
    });

    input.addEventListener('blur', () => {
        setTimeout(() => {
            const currentLabel = getSelectedLabel();
            input.value = currentLabel;
            closeDropdown();
        }, 120);
    });

    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !dropdown.contains(e.target)) {
            closeDropdown();
        }
    });

    return {
        enable(placeholderText) {
            input.disabled = false;
            input.placeholder = placeholderText || 'ابحث أو اختر...';
        },
        setOptions(newOptions) {
            options = newOptions;
        },
        selectByValue(value) {
            hidden.value = value;
            input.value = getSelectedLabel();
        }
    };
}

let jobTitleCombobox = null;
let companyCombobox = null;

// =========================================================================
// 3. تحميل القوائم المرتبطة بقاعدة البيانات (المسميات الوظيفية + الشركات)
// =========================================================================
async function loadJobTitlesFromDatabase() {
    jobTitleCombobox = setupSearchableCombobox({
        inputId: 'empJobTitleSearch',
        hiddenId: 'empJobTitle',
        dropdownId: 'empJobTitleDropdown',
        options: [{ value: '', label: 'غير محدد' }],
        emptyText: 'لا توجد مسميات وظيفية مطابقة'
    });

    jobTitleCombobox.selectByValue('');

    try {
        const { data, error } = await dbClient
            .from('professions')
            .select('id, name_ar')
            .order('name_ar', { ascending: true });

        if (error) throw new Error(error.message);

        const options = [{ value: '', label: 'غير محدد' }, ...(data || []).map(p => ({ value: p.name_ar, label: p.name_ar }))];
        jobTitleCombobox.setOptions(options);
        jobTitleCombobox.enable('عرض فقط — يُدار عبر شاشة ربط الموظفين');
    } catch (error) {
        console.error('تعذّر تحميل المسميات الوظيفية:', error.message);
        document.getElementById('empJobTitleSearch').placeholder = 'تعذّر تحميل القائمة';
    }
}

async function loadCompaniesFromDatabase() {
    companyCombobox = setupSearchableCombobox({
        inputId: 'empCompanySearch',
        hiddenId: 'empCompany',
        dropdownId: 'empCompanyDropdown',
        options: [{ value: '', label: 'غير محدد' }],
        emptyText: 'لا توجد شركات مطابقة'
    });

    companyCombobox.selectByValue('');

    try {
        const { data, error } = await dbClient
            .from('companies')
            .select('id, name')
            .order('name', { ascending: true });

        if (error) throw new Error(error.message);

        const options = [{ value: '', label: 'غير محدد' }, ...(data || []).map(c => ({ value: c.id, label: c.name }))];
        companyCombobox.setOptions(options);
        companyCombobox.enable('عرض فقط — يُدار عبر شاشة ربط الموظفين');
    } catch (error) {
        console.error('تعذّر تحميل قائمة الشركات:', error.message);
        document.getElementById('empCompanySearch').placeholder = 'تعذّر تحميل القائمة';
    }
}

// =========================================================================
// 🛡️ إصلاح أمني مهم (IDOR): كان أي مستخدم يملك صلاحية عرض قسم "الموظفين"
// يستطيع فتح هذه الصفحة بتغيير رقم ?id= بالرابط يدوياً وتعديل بيانات *أي*
// موظف آخر بالنظام، بلا أي تحقق من أن هذا السجل يخصه فعلاً. نفس الدالة
// المستخدمة بصفحة "عرض بيانات موظف" (view_employee.js) — دور "موظف" لا
// يُسمح له إلا بسجله الشخصي هو، ودور "مسؤول شركة" لا يُسمح له إلا بموظفي
// شركته/شركاته المملوكة. مدير عام النظام والمسؤول (admin) بلا قيود.
// =========================================================================
async function verifyEmployeeAccessOrBlock(employeeId) {
    try {
        const { data: { session } } = await dbClient.auth.getSession();
        if (!session) return true; // guardPage تكفّل أصلاً بمنع الوصول بلا جلسة صالحة

        const { data: profileRow } = await dbClient.from('users').select('role').eq('id', session.user.id).maybeSingle();
        const role = profileRow?.role || null;

        if (role === 'employee') {
            const { data: employeeRow } = await dbClient.from('employees').select('id').eq('user_id', session.user.id).maybeSingle();
            return !!employeeRow && String(employeeRow.id) === String(employeeId);
        }

        if (role === 'company') {
            const { data: ownedCompanies } = await dbClient.from('companies').select('id').eq('user_id', session.user.id);
            const companyIds = (ownedCompanies || []).map(c => c.id);
            if (companyIds.length === 0) return false;

            const { data: activeLink } = await dbClient
                .from('employee_links').select('id').eq('employee_id', employeeId).in('company_id', companyIds).maybeSingle();
            if (activeLink) return true;

            try {
                const { data: historyLink, error: historyError } = await dbClient
                    .from('employee_link_history').select('id').eq('employee_id', employeeId).in('company_id', companyIds).maybeSingle();
                if (historyError) throw historyError;
                return !!historyLink;
            } catch (historyErr) {
                console.error('تعذّر التحقق من أرشيف الروابط أثناء التحقق من الصلاحية:', historyErr.message);
                return false;
            }
        }

        return true; // super_admin / admin: بلا قيود
    } catch (error) {
        console.error('تعذّر التحقق من صلاحية الوصول لهذا الموظف:', error.message);
        return false; // بحال فشل التحقق لأي سبب، الأمان أولاً: نمنع الوصول بدل السماح به بالخطأ
    }
}

// =========================================================================
// 4. جلب بيانات الموظف المطلوب تعديله + الدور المرتبط بحسابه + سجل ربطه الفعلي
// =========================================================================
async function fetchEmployeeRecord(id) {
    const { data, error } = await dbClient
        .from('employees')
        .select('*')
        .eq('id', id)
        .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) throw new Error('EMPLOYEE_NOT_FOUND');
    return data;
}

async function fetchUserRole(userId) {
    if (!userId) return '';
    try {
        const { data } = await dbClient.from('users').select('role').eq('id', userId).maybeSingle();
        return data ? data.role : '';
    } catch (err) {
        console.error('تعذّر جلب دور المستخدم:', err.message);
        return '';
    }
}

// 🔗 المسمى الوظيفي والشركة المعروضان بالشاشة مصدرهما سجل الربط الفعلي بجدول
// employee_links (إن كان الموظف مرتبطاً)، وليس عمودي employees.job_title/company_id
// القديمين اللذين لم يعودا يُحدَّثان منذ إزالتهما من نموذج "إضافة موظف".
//
// ⚠️ نقيّد الاستعلام بالروابط النشطة فقط (بلا تاريخ انتهاء، أو لم يأتِ تاريخ
// انتهائها بعد) — انظر تعليق getTodayDateStringForLinks أعلى الملف.
async function fetchEmployeeLinkRecord(employeeId) {
    try {
        const { data, error } = await dbClient
            .from('employee_links')
            .select('job_title, company_id')
            .eq('employee_id', parseInt(employeeId, 10))
            .or(`link_end_date.is.null,link_end_date.gte.${getTodayDateStringForLinks()}`)
            .maybeSingle();

        if (error) throw new Error(error.message);
        return data || null;
    } catch (err) {
        console.error('تعذّر جلب سجل ربط الموظف بالشركة:', err.message);
        return null;
    }
}

// =========================================================================
// 5. قواعد التحقق (تقتصر على الحقول القابلة للتعديل فعلياً في هذه الشاشة:
//    الاسم/رقم الهوية/تاريخ الميلاد/رقم الآيبان، بالإضافة للمستندات)
// =========================================================================
function getErrorMessages() {
    return {
        name_required: 'الرجاء إدخال اسم الموظف.',
        name_short: 'يجب أن يتكون الاسم من 3 أحرف على الأقل.',
        national_id_required: 'الرجاء إدخال رقم الهوية أو الإقامة.',
        national_id_invalid: 'يجب أن يتكون رقم الهوية/الإقامة من 10 أرقام بالضبط.',
        mobile_invalid: 'رقم الجوال يجب أن يكون رقماً سعودياً صحيحاً (يبدأ بـ 05 ويتكون من 10 أرقام)، مثال: 0512345678.',
        birth_date_future: 'تاريخ الميلاد لا يمكن أن يكون في المستقبل.',
        birth_date_unrealistic: 'الرجاء إدخال تاريخ ميلاد واقعي.',
        email_required: 'الرجاء إدخال البريد الإلكتروني (مطلوب لإنشاء حساب دخول الموظف).',
        email_invalid: 'صيغة البريد الإلكتروني غير صحيحة.',
        iban_invalid: 'صيغة رقم الآيبان غير صحيحة (مثال: SA0000000000000000000000).',
        file_too_large: 'حجم الملف أكبر من الحد المسموح (5MB).'
    };
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IBAN_REGEX = /^[A-Z]{2}[0-9A-Z]{20,32}$/;
// رقم جوال سعودي: يبدأ بـ 05 ويتكون من 10 أرقام بالضبط (مثال: 0512345678)
const MOBILE_REGEX = /^05\d{8}$/;

function validateField(fieldName, form, msgs) {
    const get = (id) => form.querySelector('#' + id);

    switch (fieldName) {
        case 'name': {
            const val = get('empName').value.trim();
            if (!val) return msgs.name_required;
            if (val.length < 3) return msgs.name_short;
            return null;
        }
        case 'national_id': {
            const val = get('empId').value.trim();
            if (!val) return msgs.national_id_required;
            if (val.length !== 10 || isNaN(val)) return msgs.national_id_invalid;
            return null;
        }
        case 'mobile_number': {
            const val = get('empMobile').value.trim();
            if (!val) return null; // اختياري
            if (!MOBILE_REGEX.test(val)) return msgs.mobile_invalid;
            return null;
        }
        case 'email': {
            const val = get('empEmail').value.trim();
            // البريد اختياري بشكل عام، إلا إن كان خيار "إنشاء حساب دخول للموظف" مُفعّلاً
            if (!val) return isAccountCreationEnabled() ? msgs.email_required : null;
            if (!EMAIL_REGEX.test(val)) return msgs.email_invalid;
            return null;
        }
        case 'birth_date': {
            const val = get('empBirthDate').value;
            if (!val) return null;
            const birthDate = new Date(val);
            const today = new Date();
            if (birthDate > today) return msgs.birth_date_future;
            const age = today.getFullYear() - birthDate.getFullYear();
            if (age > 100 || age < 15) return msgs.birth_date_unrealistic;
            return null;
        }
        case 'iban_number': {
            const val = get('empIban').value.trim().toUpperCase();
            if (!val) return null; // اختياري
            if (!IBAN_REGEX.test(val)) return msgs.iban_invalid;
            return null;
        }
        default:
            return null;
    }
}

function validateFileField(inputId, msgs) {
    const input = document.getElementById(inputId);
    const file = input.files && input.files[0];
    if (!file) return null;
    if (file.size > MAX_FILE_SIZE_BYTES) return msgs.file_too_large;
    return null;
}

function setFieldError(fieldName, message) {
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

function validateAllFields(form) {
    const msgs = getErrorMessages();
    // 🔒 المسمى الوظيفي/الشركة/الحالة/الدور تبقى حقولاً للعرض فقط في هذه الشاشة
    // (تُحفظ كما هي من السجل الأصلي دون تعديل)، لذا لا داعي — بل لا يصح —
    // التحقق منها هنا. البريد الإلكتروني أصبح الآن قابلاً للتعديل (اختياري)
    // مثل باقي الحقول القابلة للتغيير فعلياً.
    const fieldNames = ['name', 'national_id', 'mobile_number', 'birth_date', 'email', 'iban_number'];
    const fileFieldMap = {
        cv_file: 'empCvFile',
        id_photo_file: 'empIdPhotoFile',
        iban_certificate_file: 'empIbanCertFile',
        national_address_file: 'empAddressFile'
    };

    let isValid = true;
    let firstInvalidField = null;

    fieldNames.forEach((fieldName) => {
        const errorMsg = validateField(fieldName, form, msgs);
        setFieldError(fieldName, errorMsg);
        if (errorMsg) {
            isValid = false;
            if (!firstInvalidField) firstInvalidField = fieldName;
        }
    });

    Object.keys(fileFieldMap).forEach((fieldName) => {
        const errorMsg = validateFileField(fileFieldMap[fieldName], msgs);
        setFieldError(fieldName, errorMsg);
        if (errorMsg) {
            isValid = false;
            if (!firstInvalidField) firstInvalidField = fieldName;
        }
    });

    if (firstInvalidField) {
        const group = document.getElementById('group-' + firstInvalidField);
        const el = group ? group.querySelector('input, select') : null;
        if (el) el.focus();
    }

    return isValid;
}

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

// يُحدّث حالة الواجهة فور تغيير خيار "إنشاء حساب دخول للموظف": يُظهر/يُخفي وسم
// "(اختياري)" بجانب عنوان حقل البريد، ويُعيد تقييم رسالة خطأ البريد فوراً حتى
// تظهر/تختفي دون انتظار فقدان التركيز (نفس منطق شاشة "إضافة موظف")
function updateAccountCreationUI() {
    const enabled = isAccountCreationEnabled();

    const emailTag = document.getElementById('emailOptionalTag');
    if (emailTag) emailTag.style.display = enabled ? 'none' : 'inline';

    const form = document.getElementById('editEmployeeForm');
    if (form) {
        const msgs = getErrorMessages();
        setFieldError('email', validateField('email', form, msgs));
    }
}

// عرض اسم الملف المختار داخل صندوق الرفع بدل النص الافتراضي
function bindFileNamePreview(inputId, previewId, defaultText) {
    const input = document.getElementById(inputId);
    const preview = document.getElementById(previewId);
    input.addEventListener('change', () => {
        if (input.files && input.files[0]) {
            preview.textContent = '📎 ' + input.files[0].name;
            preview.classList.add('has-file');
        } else {
            preview.textContent = defaultText;
            preview.classList.remove('has-file');
        }
    });
}

// 📎 عرض رابط الملف المرفوع مسبقاً (إن وجد) أعلى كل صندوق رفع، مع زر لحذفه
function renderCurrentFileLinks(emp) {
    Object.keys(DOCUMENT_FIELD_MAP).forEach((key) => renderDocumentNote(key));
}

// =========================================================================
// 6. رفع/استبدال المستندات في Supabase Storage
// =========================================================================
async function uploadEmployeeFile(inputId, folderName) {
    const input = document.getElementById(inputId);
    const file = input.files && input.files[0];
    if (!file) return null;

    const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const filePath = `${folderName}/${crypto.randomUUID()}-${safeName}`;

    const { error: uploadError } = await dbClient.storage
        .from(EMPLOYEE_DOCS_BUCKET)
        .upload(filePath, file, { cacheControl: '3600', upsert: false });

    if (uploadError) {
        console.error('Storage Upload Raw Error:', uploadError);
        const rawMsg = uploadError.message || uploadError.error || uploadError.statusText;
        const friendlyMsg = rawMsg && rawMsg !== '{}'
            ? rawMsg
            : `تعذّر الوصول لمساحة تخزين الملفات "${EMPLOYEE_DOCS_BUCKET}".`;
        throw new Error(`تعذّر رفع الملف (${file.name}): ${friendlyMsg}`);
    }

    const { data: publicUrlData } = dbClient.storage
        .from(EMPLOYEE_DOCS_BUCKET)
        .getPublicUrl(filePath);

    return publicUrlData ? publicUrlData.publicUrl : null;
}

// يرفع الملف الجديد فقط لو تم اختياره؛ وإلا — لو عُلِّم هذا المستند للحذف يُعاد null
// (فيُحذف الرابط عند الحفظ)، وإلا يُبقي على رابط الملف الحالي كما هو دون تغيير
async function uploadEmployeeFileIfSelected(inputId, folderName, existingUrl, isMarkedForRemoval) {
    const input = document.getElementById(inputId);
    const file = input.files && input.files[0];
    if (file) return await uploadEmployeeFile(inputId, folderName);
    if (isMarkedForRemoval) return null;
    return existingUrl || null;
}

// =========================================================================
// 7. تعبئة النموذج ببيانات الموظف الحالية
// =========================================================================
function populateFormWithEmployee(emp, role, linkRecord) {
    document.getElementById('empName').value = emp.name || '';
    document.getElementById('empId').value = emp.national_id || '';
    document.getElementById('empMobile').value = emp.mobile_number || '';
    document.getElementById('empBirthDate').value = emp.birth_date || '';
    document.getElementById('empIban').value = emp.iban_number || '';
    document.getElementById('empEmail').value = emp.email || '';
    document.getElementById('empStatus').value = emp.status || '';
    document.getElementById('empRole').value = role || 'employee';

    // 🔒 نُظهر ملاحظة "مرتبط بحساب دخول فعلي" فقط لو الموظف عنده user_id فعلي،
    // لتنبيه المسؤول أن تعديل البريد هنا لن يُغيّر بريد تسجيل الدخول الحقيقي
    // بنظام المصادقة (Supabase Auth) — انظر أيضاً ملاحظة handleEditSubmit أدناه
    const emailHintEl = document.getElementById('emailAccountHint');
    if (emailHintEl) emailHintEl.style.display = emp.user_id ? 'block' : 'none';

    // ➕ خيار "إنشاء حساب دخول للموظف" يظهر فقط لو الموظف ما عنده حساب دخول أصلاً
    // (لا يوجد user_id بسجله)؛ لو عنده حساب بالفعل، لا داعي لإظهار الخيار إطلاقاً
    const createAccountGroup = document.getElementById('group-create_account');
    if (createAccountGroup) createAccountGroup.style.display = emp.user_id ? 'none' : 'block';
    updateAccountCreationUI();

    // 🔗 المسمى الوظيفي واسم الشركة المعروضان هنا مصدرهما سجل الربط الفعلي بجدول
    // employee_links (إن وُجد ربط للموظف) وليس عمودي employees.job_title/company_id
    // القديمين؛ إن لم يكن الموظف مرتبطاً بأي شركة، يظهر الحقلان "غير محدد".
    if (jobTitleCombobox) jobTitleCombobox.selectByValue((linkRecord && linkRecord.job_title) || '');
    if (companyCombobox) companyCombobox.selectByValue((linkRecord && linkRecord.company_id) || '');

    // 🔒 يُسمح بتعديل الاسم/رقم الهوية/تاريخ الميلاد/رقم الآيبان والمستندات فقط من
    // هذه الشاشة؛ المسمى الوظيفي والشركة يُداران عبر شاشة "ربط الموظفين"، لذا نُبقي
    // حقليهما معطّلين دائماً هنا حتى بعد اكتمال تحميل قوائمهما (والتي تُفعّلهما مؤقتاً).
    const jobTitleSearchEl = document.getElementById('empJobTitleSearch');
    if (jobTitleSearchEl) jobTitleSearchEl.disabled = true;
    const companySearchEl = document.getElementById('empCompanySearch');
    if (companySearchEl) companySearchEl.disabled = true;

    renderCurrentFileLinks(emp);

    const fieldsWrapper = document.getElementById('editEmployeeFields');
    const submitBtn = document.getElementById('btnSubmitEdit');
    if (fieldsWrapper) fieldsWrapper.style.display = 'block';
    if (submitBtn) submitBtn.style.display = 'inline-block';
}

// =========================================================================
// 8. حفظ التعديلات
// =========================================================================
async function handleEditSubmit(event) {
    event.preventDefault();
    hideFormAlert();

    const form = event.target;
    if (!currentEmployeeId || !currentEmployeeRecord) return;

    if (!validateAllFields(form)) {
        showFormAlert('الرجاء تصحيح الحقول المظللة أدناه.', 'error');
        return;
    }

    const name = document.getElementById('empName').value.trim();
    const nationalId = document.getElementById('empId').value.trim();
    const mobileNumber = document.getElementById('empMobile').value.trim() || null;
    const birthDate = document.getElementById('empBirthDate').value || null;
    const ibanNumber = document.getElementById('empIban').value.trim().toUpperCase() || null;
    // البريد الإلكتروني أصبح قابلاً للتعديل من هذه الشاشة (اختياري)
    const email = document.getElementById('empEmail').value.trim().toLowerCase() || null;
    // الحقول التالية (المسمى الوظيفي/الشركة/الحالة) تبقى للعرض فقط في هذه الشاشة
    // ولا تُعرض للتعديل بالواجهة؛ نُبقيها كما هي من السجل الأصلي دون تغيير (المسمى
    // الوظيفي/الشركة المعروضان بالواجهة مصدرهما جدول employee_links، لا هذين العمودين).
    const jobTitle = currentEmployeeRecord.job_title;
    const companyId = currentEmployeeRecord.company_id;
    const status = currentEmployeeRecord.status;

    const submitBtn = form.querySelector('.btn-submit');
    const originalBtnText = submitBtn.textContent;
    submitBtn.disabled = true;

    try {
        // 0. فحص القائمة السوداء
        submitBtn.textContent = 'جاري التحقق من القائمة السوداء...';
        const { data: blacklistHit, error: blacklistCheckError } = await dbClient
            .from('employee_blacklist')
            .select('reason')
            .eq('national_id', nationalId)
            .maybeSingle();

        if (blacklistCheckError) throw new Error(blacklistCheckError.message);

        if (blacklistHit) {
            const blMsg = `⚠️ رقم الهوية هذا مُدرج بالقائمة السوداء. السبب: ${blacklistHit.reason || 'غير محدد'}`;
            setFieldError('national_id', 'هذا الشخص مُدرج بالقائمة السوداء.');
            showFormAlert(blMsg, 'error');
            return;
        }

        // 1. فحص عدم تكرار رقم الهوية لدى موظف آخر (باستثناء هذا الموظف نفسه)
        submitBtn.textContent = 'جاري التحقق من رقم الهوية...';
        const { data: dupNationalId, error: dupNationalIdError } = await dbClient
            .from('employees')
            .select('id')
            .eq('national_id', nationalId)
            .neq('id', currentEmployeeId)
            .maybeSingle();

        if (dupNationalIdError) throw new Error(dupNationalIdError.message);

        if (dupNationalId) {
            const dupMsg = 'رقم الهوية/الإقامة مسجل مسبقاً لموظف آخر.';
            setFieldError('national_id', dupMsg);
            showFormAlert(dupMsg, 'error');
            return;
        }

        // 1.5 فحص عدم تكرار البريد الإلكتروني (لو تم إدخاله) لدى موظف آخر أو حساب
        //     مستخدم آخر بجدول users (نفس منطق الفحص عند إضافة موظف جديد)
        if (email) {
            submitBtn.textContent = 'جاري التحقق من البريد الإلكتروني...';
            const duplicateChecks = [
                dbClient.from('employees').select('id').eq('email', email).neq('id', currentEmployeeId).maybeSingle(),
                currentEmployeeRecord.user_id
                    ? dbClient.from('users').select('id').eq('email', email).neq('id', currentEmployeeRecord.user_id).maybeSingle()
                    : dbClient.from('users').select('id').eq('email', email).maybeSingle()
            ];

            const [empEmailCheck, userEmailCheck] = await Promise.all(duplicateChecks);

            if (empEmailCheck.error) throw new Error(empEmailCheck.error.message);
            if (userEmailCheck.error) throw new Error(userEmailCheck.error.message);

            if (empEmailCheck.data || userEmailCheck.data) {
                const dupMsg = 'هذا البريد الإلكتروني مسجل مسبقاً بالنظام.';
                setFieldError('email', dupMsg);
                showFormAlert(dupMsg, 'error');
                return;
            }
        }

        // 1.6 إنشاء حساب دخول فعلي للموظف — فقط لو كان الخيار مُفعّلاً بالواجهة
        //     (يظهر أصلاً فقط لو ما عند الموظف حساب دخول من قبل)؛ نفس منطق إنشاء
        //     الحساب المُتّبع بشاشة "إضافة موظف" بالضبط (Auth signUp ثم upsert بجدول users)
        const shouldCreateAccount = isAccountCreationEnabled() && !currentEmployeeRecord.user_id;
        let newAuthUserId = null;

        if (shouldCreateAccount) {
            //    نحفظ جلسة المسؤول الحالي أولاً لأن signUp() قد يبدّل الجلسة النشطة
            //    تلقائياً إلى المستخدم الجديد (لو "Confirm email" غير مفعّل بالمشروع).
            submitBtn.textContent = 'جاري إنشاء حساب الدخول...';
            const { data: { session: adminSessionBeforeCreate } } = await dbClient.auth.getSession();

            const { data: authData, error: authError } = await dbClient.auth.signUp({
                email: email,
                password: DEFAULT_EMPLOYEE_PASSWORD,
                options: {
                    // يقرأها الـ trigger (handle_new_user) تلقائياً عند إنشاء صف users
                    data: {
                        name: name,
                        role: 'employee',
                        must_change_password: true
                    }
                }
            });

            if (authError) {
                console.error('Auth SignUp Raw Error:', authError, 'status:', authError.status, 'code:', authError.code);
                const rawMsg = authError.message;
                const friendlyMsg = rawMsg && rawMsg !== '{}'
                    ? rawMsg
                    : 'تعذّر إنشاء حساب الدخول عبر Supabase Authentication بدون سبب واضح من الخادم. الأسباب الشائعة: (١) خيار "Enable email signups" مغلق بإعدادات Authentication، (٢) تجاوزت حد إنشاء الحسابات المسموح خلال ساعة (Rate Limit)، (٣) إعدادات SMTP لتأكيد البريد ناقصة مع تفعيل "Confirm email". تحقق من Authentication → Providers → Email بلوحة تحكم سوبابيس.';
                throw new Error(friendlyMsg);
            }

            if (adminSessionBeforeCreate) {
                await dbClient.auth.setSession({
                    access_token: adminSessionBeforeCreate.access_token,
                    refresh_token: adminSessionBeforeCreate.refresh_token
                });
            }

            newAuthUserId = (authData && authData.user) ? authData.user.id : crypto.randomUUID();

            // تأكيد بيانات صف users (الـ trigger أنشأه تلقائياً عند signUp أعلاه)
            // نستخدم upsert بدل insert لتفادي تعارض المفتاح الأساسي مع الصف الذي
            // أنشأه الـ trigger تلقائياً، ولضمان اكتمال كل الحقول بدقة.
            submitBtn.textContent = 'جاري حفظ حساب المستخدم...';
            const usersPayload = {
                id: newAuthUserId,
                name: name,
                email: email,
                role: 'employee',
                status: currentEmployeeRecord.status || 'active',
                must_change_password: true
            };

            const { error: userInsertError } = await dbClient
                .from('users')
                .upsert([usersPayload], { onConflict: 'id' });

            if (userInsertError) throw new Error(userInsertError.message);
        }

        // 2. رفع/حذف أي مستندات — يُرفع الملف الجديد إن اختير، أو يُحذف الرابط إن عُلِّم
        //    المستند للحذف، أو يبقى كما هو دون تغيير في الحالتين الأخريين
        submitBtn.textContent = 'جاري تحديث المستندات...';
        const employeeFolderKey = nationalId || currentEmployeeId;

        const [cvUrl, idPhotoUrl, ibanCertUrl, nationalAddressUrl] = await Promise.all([
            uploadEmployeeFileIfSelected('empCvFile', `${employeeFolderKey}/cv`, currentEmployeeRecord.cv_url, documentRemovalFlags.cv_url),
            uploadEmployeeFileIfSelected('empIdPhotoFile', `${employeeFolderKey}/id`, currentEmployeeRecord.id_photo_url, documentRemovalFlags.id_photo_url),
            uploadEmployeeFileIfSelected('empIbanCertFile', `${employeeFolderKey}/iban`, currentEmployeeRecord.iban_certificate_url, documentRemovalFlags.iban_certificate_url),
            uploadEmployeeFileIfSelected('empAddressFile', `${employeeFolderKey}/address`, currentEmployeeRecord.national_address_url, documentRemovalFlags.national_address_url)
        ]);

        // 3. تحديث سجل الموظف — الاسم/رقم الهوية/تاريخ الميلاد/رقم الآيبان والمستندات
        //    هي الحقول القابلة للتغيير فعلياً؛ باقي الحقول تُحفظ بقيمها الأصلية كما هي.
        submitBtn.textContent = 'جاري حفظ التعديلات...';
        const payload = {
            name,
            national_id: nationalId,
            mobile_number: mobileNumber,
            birth_date: birthDate,
            iban_number: ibanNumber,
            email,
            job_title: jobTitle,
            company_id: companyId,
            status,
            cv_url: cvUrl,
            id_photo_url: idPhotoUrl,
            iban_certificate_url: ibanCertUrl,
            national_address_url: nationalAddressUrl
        };

        // نربط سجل الموظف بحساب الدخول الجديد فقط إن أُنشئ فعلياً بالخطوة أعلاه؛
        // غير ذلك لا نُضيف user_id للـ payload إطلاقاً حتى لا نمسّ قيمته الحالية
        if (shouldCreateAccount && newAuthUserId) {
            payload.user_id = newAuthUserId;
        }

        // نطلب .select() على التحديث حتى نعرف بالضبط هل تم تعديل أي سجل فعلياً؛
        // فبعض إعدادات RLS بسوبابيس تمنع التحديث بصمت (تُرجع نجاحاً بدون أي صف
        // مُعدَّل فعلياً) بدل رسالة خطأ صريحة، فيبدو للمستخدم أن الزر "لا يعمل".
        const { data: updatedRows, error: updateError } = await dbClient
            .from('employees')
            .update(payload)
            .eq('id', currentEmployeeId)
            .select();

        if (updateError) throw new Error(updateError.message);

        if (!updatedRows || updatedRows.length === 0) {
            showFormAlert("لم يتم حفظ أي تعديل فعلياً. غالباً السبب عدم وجود سياسة تحديث (RLS UPDATE Policy) على جدول 'employees' في سوبابيس.", 'error');
            return;
        }

        // 🔄 لو الموظف مرتبط بحساب دخول فعلي (user_id) وتغيّر البريد، نُحدّث أيضاً
        // البريد المعروض بجدول users (public.users) ليبقى متطابقاً مع سجل الموظف.
        // ⚠️ تنبيه مهم: هذا لا يُغيّر بريد تسجيل الدخول الفعلي بنظام مصادقة سوبابيس
        // (auth.users) — فذلك يتطلب صلاحيات مسؤول (Service Role Key) غير متاحة من
        // واجهة المتصفح لأسباب أمنية. لتغيير بريد الدخول الفعلي، يلزم تحديثه يدوياً
        // من Authentication بلوحة تحكم سوبابيس. فشل هذا التحديث الثانوي لا يوقف
        // نجاح حفظ بيانات الموظف نفسها، ويُسجَّل بالكونسول فقط.
        if (currentEmployeeRecord.user_id && email !== currentEmployeeRecord.email) {
            const { error: userEmailUpdateError } = await dbClient
                .from('users')
                .update({ email })
                .eq('id', currentEmployeeRecord.user_id);
            if (userEmailUpdateError) {
                console.error('تعذّر تحديث البريد بجدول users المرتبط بحساب هذا الموظف:', userEmailUpdateError.message);
            }
        }

        const successMsg = (shouldCreateAccount && newAuthUserId)
            ? `تم حفظ تعديلات بيانات الموظف بنجاح، وتم إنشاء حساب دخول له! كلمة المرور الافتراضية: ${DEFAULT_EMPLOYEE_PASSWORD} — سيُطلب منه تغييرها عند أول تسجيل دخول. جاري التحويل...`
            : 'تم حفظ تعديلات بيانات الموظف بنجاح! جاري التحويل...';
        showFormAlert(successMsg, 'success');
        setTimeout(() => {
            window.location.href = Routes.url('employees');
        }, 1800);

    } catch (error) {
        console.error('Employee Update Error (raw):', error);
        const rawMsg = error && (error.message || error.error_description || error.hint || error.details);
        const displayMsg = (rawMsg && rawMsg !== '{}')
            ? rawMsg
            : 'حدث خطأ غير متوقع من قاعدة البيانات بدون تفاصيل.';
        showFormAlert('فشلت العملية: ' + displayMsg, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalBtnText;
    }
}

// =========================================================================
// 9. ربط الأحداث وتحميل بيانات الموظف عند فتح الصفحة
// =========================================================================
document.addEventListener('DOMContentLoaded', async function() {
    const allowed = await Permissions.guardPage('employees');
    if (!allowed) return;

    const form = document.getElementById('editEmployeeForm');
    const cancelBtn = document.getElementById('btnCancel');

    const urlParams = new URLSearchParams(window.location.search);
    currentEmployeeId = urlParams.get('id');

    // تهيئة الاستماع لتغييرات خيار "إنشاء حساب دخول للموظف" (يظهر فقط لو الموظف
    // ما عنده حساب أصلاً — يُضبط ظهوره فعلياً داخل populateFormWithEmployee)
    const createAccountCheckbox = document.getElementById('empCreateAccount');
    if (createAccountCheckbox) {
        createAccountCheckbox.addEventListener('change', updateAccountCreationUI);
    }

    bindFileNamePreview('empCvFile', 'fileNameCv', 'اختر ملفاً جديداً لاستبدال الحالي (حد أقصى 5MB)');
    bindFileNamePreview('empIdPhotoFile', 'fileNameIdPhoto', 'اختر صورة جديدة لاستبدال الحالية (حد أقصى 5MB)');
    bindFileNamePreview('empIbanCertFile', 'fileNameIbanCert', 'اختر ملفاً جديداً لاستبدال الحالي (حد أقصى 5MB)');
    bindFileNamePreview('empAddressFile', 'fileNameAddress', 'اختر صورة جديدة لاستبدال الحالية (حد أقصى 5MB)');

    // الاسم/رقم الهوية/رقم الجوال/البريد الإلكتروني/تاريخ الميلاد/رقم الآيبان هي
    // الحقول القابلة للتحقق التفاعلي هنا؛ باقي الحقول (المسمى الوظيفي/الشركة/
    // الحالة/الدور) للعرض فقط ومعطّلة.
    const blurFieldIdsMap = {
        empName: 'name',
        empId: 'national_id',
        empMobile: 'mobile_number',
        empEmail: 'email',
        empBirthDate: 'birth_date',
        empIban: 'iban_number'
    };

    Object.keys(blurFieldIdsMap).forEach((inputId) => {
        const el = document.getElementById(inputId);
        if (!el) return;
        el.addEventListener('blur', () => {
            const msgs = getErrorMessages();
            const fieldName = blurFieldIdsMap[inputId];
            setFieldError(fieldName, validateField(fieldName, form, msgs));
        });
        el.addEventListener('change', () => {
            const msgs = getErrorMessages();
            const fieldName = blurFieldIdsMap[inputId];
            setFieldError(fieldName, validateField(fieldName, form, msgs));
        });
    });

    cancelBtn.addEventListener('click', function() {
        if (confirm('هل أنت متأكد من إلغاء التعديل؟ لن يتم حفظ أي تغييرات.')) {
            window.location.href = Routes.url('employees');
        }
    });

    if (!currentEmployeeId) {
        showFormAlert('لم يتم تحديد أي موظف لتعديل بياناته.', 'error');
        return;
    }

    const hasAccess = await verifyEmployeeAccessOrBlock(currentEmployeeId);
    if (!hasAccess) {
        showFormAlert('غير مصرح لك بالوصول لبيانات هذا الموظف أو تعديلها.', 'error');
        return;
    }

    try {
        const [, , emp, linkRecord] = await Promise.all([
            loadJobTitlesFromDatabase(),
            loadCompaniesFromDatabase(),
            fetchEmployeeRecord(currentEmployeeId),
            fetchEmployeeLinkRecord(currentEmployeeId)
        ]);

        currentEmployeeRecord = emp;
        const role = await fetchUserRole(emp.user_id);
        populateFormWithEmployee(emp, role, linkRecord);

    } catch (error) {
        console.error('تعذّر تحميل بيانات الموظف للتعديل:', error.message);
        const notFound = error.message === 'EMPLOYEE_NOT_FOUND';
        showFormAlert(
            notFound
                ? 'تعذّر العثور على هذا الموظف، ربما تم حذفه.'
                : 'تعذّر تحميل بيانات الموظف: ' + error.message,
            'error'
        );
        return;
    }

    form.addEventListener('submit', handleEditSubmit);
});
