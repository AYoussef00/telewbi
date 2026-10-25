// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================

// اسم Bucket المستخدم لتخزين شعار ومستندات الشركة على Supabase Storage
const COMPANY_DOCS_BUCKET = "company-documents";
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

// كلمة المرور الافتراضية لأي حساب مسؤول شركة جديد يُنشأ من هذه الشاشة.
// تُجبر مسؤول الشركة على تغييرها فور أول تسجيل دخول (عبر علامة must_change_password بجدول users).
const DEFAULT_COMPANY_PASSWORD = "Basma@1234";

// =========================================================================
// 1.5 مكوّن قائمة قابلة للبحث (Searchable Combobox) — نفس منطق شاشة "ربط الموظفين"
//     يُستخدم هنا لاختيار حساب دخول موجود (بدل إنشاء حساب جديد) عند تفعيل
//     خيار "ربط هذه الشركة بحساب دخول موجود"
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
        selectByValue(value) { hidden.value = value; input.value = getSelectedLabel(); },
        clear() { hidden.value = ''; input.value = ''; }
    };
}

let existingAccountCombobox = null;
// خريطة سريعة من معرّف الحساب إلى بريده الإلكتروني (نحتاج البريد الفعلي عند الحفظ)
let existingAccountsById = {};

// روابط ملفات الشركة "الرئيسية" (أول شركة أُنشئت لنفس الحساب المُختار)، تُستخدم
// كبديل احتياطي عند الحفظ لو لم يختر المستخدم ملفاً جديداً لنفس الحقل
let prefillDocumentUrls = {
    logo_url: null,
    contract_url: null,
    national_address_url: null,
    tax_certificate_url: null,
    cr_certificate_url: null
};

async function loadExistingAccountsForCombobox() {
    existingAccountCombobox = setupSearchableCombobox({
        inputId: 'companyExistingAccountSearch',
        hiddenId: 'companyExistingAccountId',
        dropdownId: 'companyExistingAccountDropdown',
        options: [],
        emptyText: 'لا توجد حسابات شركات مطابقة',
        onSelectExtra: (opt) => {
            setFieldError('existing_account', null);
            prefillFromPrimaryCompany(opt.value);
        }
    });

    try {
        // نعرض فقط حسابات "مسؤول شركة" (role = company) بما أنها الحسابات المخصصة لإدارة الشركات
        const { data, error } = await dbClient
            .from('users')
            .select('id, name, email')
            .eq('role', 'company')
            .order('name', { ascending: true });

        if (error) throw new Error(error.message);

        existingAccountsById = {};
        const options = (data || []).map(u => {
            existingAccountsById[String(u.id)] = u;
            return { value: String(u.id), label: `${u.name} — ${u.email}` };
        });

        existingAccountCombobox.setOptions(options);
        existingAccountCombobox.enable(options.length ? 'ابحث أو اختر الحساب' : 'لا توجد حسابات شركات موجودة بعد');
    } catch (error) {
        console.error('تعذّر تحميل قائمة حسابات الشركات:', error.message);
        const input = document.getElementById('companyExistingAccountSearch');
        if (input) input.placeholder = 'تعذّر تحميل القائمة';
    }
}

// 📥 عند اختيار حساب موجود: نجلب أقدم شركة مسجّلة لنفس الحساب ("الشركة الرئيسية")
// ونعبّئ منها الحقول المشتركة تلقائياً (رقم الجوال، السجل التجاري، الرقم الضريبي،
// المدينة، العنوان، بيانات العقد والاشتراك، رقم/هوية المنشأة، الشخص المفوض ورقم
// جواله، اسم المندوب)، ونحتفظ بروابط مستنداتها لإعادة استخدامها إن لم تُرفع ملفات جديدة.
// اسم الشركة والملفات الفعلية تبقى فارغة ليُدخلها المستخدم بنفسه. قطاع العمل لا
// يُعبَّأ من الشركة الرئيسية لأنه مقفل على "خاص" دائماً بهذه الشاشة. حالة الشركة
// (نشط/غير نشط) أيضاً لا تُعبَّأ من الشركة الرئيسية، فتبقى "نشط" افتراضياً — كل
// شركة جديدة تُدار حالتها بشكل مستقل بغض النظر عن حالة الشركة الرئيسية.
async function prefillFromPrimaryCompany(userId) {
    prefillDocumentUrls = {
        logo_url: null,
        contract_url: null,
        national_address_url: null,
        tax_certificate_url: null,
        cr_certificate_url: null
    };

    try {
        const { data, error } = await dbClient
            .from('companies')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle();

        if (error) throw new Error(error.message);

        if (!data) {
            // لا توجد شركة سابقة لهذا الحساب بعد (حساب جديد لم تُضَف له شركة أولى) — لا شيء لتعبئته
            return;
        }

        document.getElementById('companyPhone').value = data.phone || '';
        document.getElementById('companyCR').value = data.cr_number || '';
        document.getElementById('companyTax').value = data.tax_number || '';
        document.getElementById('companyCity').value = data.city || '';
        document.getElementById('companyAddress').value = data.address || '';

        document.getElementById('companyContractType').value = data.contract_type || 'إستضافة';
        document.getElementById('companyContractDate').value = data.contract_date ? String(data.contract_date).split('T')[0] : '';
        document.getElementById('companySubscriptionValue').value = data.subscription_value != null ? data.subscription_value : '';
        document.getElementById('companyVatIncluded').checked = !!data.vat_included;
        document.getElementById('companyEstablishmentNumber').value = data.establishment_number || '';
        document.getElementById('companyEstablishmentId').value = data.establishment_national_id || '';
        document.getElementById('companyAuthorizedPerson').value = data.authorized_person || '';
        document.getElementById('companyAuthorizedPersonPhone').value = data.authorized_person_phone || '';
        // 🆕 اسم المندوب
        document.getElementById('companyRepresentativeName').value = data.representative_name || '';

        // معاينة شعار الشركة الرئيسية (سيُستخدم كما هو إن لم يُرفع شعار جديد)
        if (data.logo_url) {
            document.getElementById('avatarPreview').style.backgroundImage = `url('${data.logo_url}')`;
        }

        prefillDocumentUrls = {
            logo_url: data.logo_url || null,
            contract_url: data.contract_url || null,
            national_address_url: data.national_address_url || null,
            tax_certificate_url: data.tax_certificate_url || null,
            cr_certificate_url: data.cr_certificate_url || null
        };

        // نوضّح لكل حقل رفع ملف بأن هناك ملفاً سابقاً سيُعاد استخدامه ما لم يُختَر ملف جديد
        const docPreviewMap = {
            contract_url: 'fileNameContract',
            national_address_url: 'fileNameAddressDoc',
            tax_certificate_url: 'fileNameTaxCert',
            cr_certificate_url: 'fileNameCrCert'
        };
        Object.keys(docPreviewMap).forEach((key) => {
            const previewEl = document.getElementById(docPreviewMap[key]);
            if (previewEl && prefillDocumentUrls[key] && !previewEl.classList.contains('has-file')) {
                // 🎨 أيقونة SVG موحّدة (icons.js) بدل إيموجي 📎 القديم — عبر data-icon +
                // applyIconPlaceholders (وليس ICONS.paperclip الخام) حتى تنطبق قاعدة
                // التحجيم (1em) بـ icons.js ولا تظهر الأيقونة بحجمها الافتراضي الضخم
                previewEl.innerHTML = '<span data-icon="paperclip" class="icon-inline"></span> سيُستخدم ملف الشركة الرئيسية (اضغط لاختيار ملف مختلف)';
                if (window.applyIconPlaceholders) applyIconPlaceholders(previewEl);
            }
        });

        showFormAlert('تم تعبئة البيانات المشتركة تلقائياً من الشركة الرئيسية المسجّلة بهذا الحساب — يمكنك تعديل أي حقل قبل الحفظ.', 'success');

    } catch (error) {
        console.error('تعذّر جلب بيانات الشركة الرئيسية لهذا الحساب:', error.message);
    }
}

// يُظهر/يُخفي حقل "البريد الإلكتروني" مقابل حقل "اختيار حساب موجود" حسب حالة الخيار
function updateAccountLinkModeVisibility() {
    const isLinking = document.getElementById('companyLinkExistingAccount').checked;
    const emailGroup = document.getElementById('group-email');
    const existingAccountGroup = document.getElementById('group-existing_account');

    emailGroup.style.display = isLinking ? 'none' : '';
    existingAccountGroup.style.display = isLinking ? '' : 'none';

    if (isLinking) {
        setFieldError('email', null);
        document.getElementById('companyEmail').value = '';
    } else {
        setFieldError('existing_account', null);
        if (existingAccountCombobox) existingAccountCombobox.clear();
        prefillDocumentUrls = {
            logo_url: null,
            contract_url: null,
            national_address_url: null,
            tax_certificate_url: null,
            cr_certificate_url: null
        };
    }
}

// 🟢🔴 إظهار/إخفاء حقل "ملاحظة" الحالة — يظهر فقط عند اختيار "غير نشط"، ويُفرَّغ
// تلقائياً ويُخفى عند العودة لـ"نشط" حتى لا تُحفظ ملاحظة قديمة لا معنى لها لشركة نشطة
function updateCompanyStatusNoteVisibility() {
    const statusSelect = document.getElementById('companyStatus');
    const noteGroup = document.getElementById('group-status_note');
    const noteInput = document.getElementById('companyStatusNote');
    if (!statusSelect || !noteGroup || !noteInput) return;

    const isInactive = statusSelect.value === 'inactive';
    noteGroup.style.display = isInactive ? '' : 'none';

    if (!isInactive) {
        noteInput.value = '';
        setFieldError('status_note', null);
    }
}

// =========================================================================
// 2. قواعد التحقق (Validation Rules)
// =========================================================================
function getErrorMessages() {
    return {
        name_required: 'الرجاء إدخال اسم الشركة.',
        name_short: 'يجب أن يتكون الاسم من 3 أحرف على الأقل.',
        email_required: 'الرجاء إدخال البريد الإلكتروني.',
        email_invalid: 'صيغة البريد الإلكتروني غير صحيحة.',
        existing_account_required: 'الرجاء اختيار الحساب المطلوب الربط به.',
        subscription_value_invalid: 'الرجاء إدخال قيمة اشتراك صحيحة (رقم موجب) أو ترك الحقل فارغاً.',
        company_refund_invalid: 'الرجاء إدخال قيمة مسترد صحيحة (رقم موجب أو صفر).',
        file_too_large: 'حجم الملف أكبر من الحد المسموح (5MB).'
    };
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateField(fieldName, form, msgs) {
    const get = (id) => form.querySelector('#' + id);
    const isLinkingExisting = get('companyLinkExistingAccount').checked;

    switch (fieldName) {
        case 'name': {
            const val = get('companyName').value.trim();
            if (!val) return msgs.name_required;
            if (val.length < 3) return msgs.name_short;
            return null;
        }
        case 'email': {
            // لا داعي للتحقق من هذا الحقل إطلاقاً عند تفعيل "ربط بحساب موجود"،
            // فهو مخفي ولن تُستخدم قيمته
            if (isLinkingExisting) return null;
            const val = get('companyEmail').value.trim();
            if (!val) return msgs.email_required;
            if (!EMAIL_REGEX.test(val)) return msgs.email_invalid;
            return null;
        }
        case 'existing_account': {
            // يُتحقق منه فقط عند تفعيل "ربط بحساب موجود"
            if (!isLinkingExisting) return null;
            const val = get('companyExistingAccountId').value.trim();
            if (!val) return msgs.existing_account_required;
            return null;
        }
        case 'subscription_value': {
            // حقل اختياري: لا نعتبر تركه فارغاً خطأً، فقط نتحقق من صحة الصيغة إن أُدخلت قيمة
            const val = get('companySubscriptionValue').value.trim();
            if (val === '') return null;
            const num = parseFloat(val);
            if (isNaN(num) || num < 0) return msgs.subscription_value_invalid;
            return null;
        }
        case 'company_refund': {
            // اختياري: الفراغ يُعامل كـ 0، فقط نتحقق من صحة الصيغة إن أُدخلت قيمة
            const val = get('companyRefund').value.trim();
            if (val === '') return null;
            const num = parseFloat(val);
            if (isNaN(num) || num < 0) return msgs.company_refund_invalid;
            return null;
        }
        default:
            return null; // باقي الحقول (الهاتف، السجل التجاري، الرقم الضريبي، المدينة، العنوان، نوع العقد، تاريخ العقد، رقم المنشأة، رقم هوية المنشأة، الشخص المفوض ورقم جواله، اسم المندوب، الحالة، ملاحظة الحالة) اختيارية بلا تحقق صيغة
    }
}

function validateFileField(inputId, msgs) {
    const input = document.getElementById(inputId);
    if (!input) return null;
    const file = input.files && input.files[0];
    if (!file) return null; // كل الملفات اختيارية
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
    const fieldNames = ['name', 'email', 'existing_account', 'subscription_value', 'company_refund'];
    const fileFieldMap = {
        logo_file: 'companyLogoFile',
        contract_file: 'companyContractFile',
        national_address_file: 'companyAddressFile',
        tax_certificate_file: 'companyTaxCertFile',
        cr_certificate_file: 'companyCrCertFile'
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

// عرض اسم الملف المختار داخل صندوق الرفع بدل النص الافتراضي
function bindFileNamePreview(inputId, previewId) {
    const input = document.getElementById(inputId);
    const preview = document.getElementById(previewId);
    if (!input || !preview) return;
    input.addEventListener('change', () => {
        if (input.files && input.files[0]) {
            // 🎨 أيقونة SVG موحّدة (icons.js) بدل إيموجي 📎 القديم — عبر data-icon +
            // applyIconPlaceholders (وليس ICONS.paperclip الخام) حتى تنطبق قاعدة
            // التحجيم (1em) بـ icons.js ولا تظهر الأيقونة بحجمها الافتراضي الضخم؛
            // اسم الملف يبقى عقدة نصية منفصلة (createTextNode) حتى لا يُفسَّر اسم
            // الملف القادم من المستخدم كـ HTML أبداً (نفس أمان textContent الأصلي)
            preview.innerHTML = '<span data-icon="paperclip" class="icon-inline"></span> ';
            preview.appendChild(document.createTextNode(input.files[0].name));
            preview.classList.add('has-file');
            if (window.applyIconPlaceholders) applyIconPlaceholders(preview);
        } else {
            preview.textContent = 'اضغط لاختيار ملف (حد أقصى 5MB)';
            preview.classList.remove('has-file');
        }
    });
}

// معاينة شعار الشركة حياً فور الاختيار (مرتبطة عبر onchange داخل الـ HTML)
function previewCompanyLogo(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (file.size > MAX_FILE_SIZE_BYTES) {
        setFieldError('logo_file', getErrorMessages().file_too_large);
        event.target.value = '';
        return;
    }
    setFieldError('logo_file', null);

    const reader = new FileReader();
    reader.onload = function(e) {
        document.getElementById('avatarPreview').style.backgroundImage = `url('${e.target.result}')`;
    };
    reader.readAsDataURL(file);
}

// =========================================================================
// 3. رفع المستندات والشعار إلى Supabase Storage
// =========================================================================
async function uploadCompanyFile(inputId, folderName) {
    const input = document.getElementById(inputId);
    const file = input.files && input.files[0];
    if (!file) return null;

    const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const filePath = `${folderName}/${crypto.randomUUID()}-${safeName}`;

    const { error: uploadError } = await dbClient.storage
        .from(COMPANY_DOCS_BUCKET)
        .upload(filePath, file, { cacheControl: '3600', upsert: false });

    if (uploadError) {
        console.error('Storage Upload Raw Error:', uploadError);
        const rawMsg = uploadError.message || uploadError.error || uploadError.statusText;
        const friendlyMsg = rawMsg && rawMsg !== '{}'
            ? rawMsg
            : `تعذّر الوصول لمساحة تخزين الملفات "${COMPANY_DOCS_BUCKET}". على الأغلب الـ Bucket غير موجود بعد بسوبابيس أو سياسات الرفع (RLS) ناقصة.`;
        throw new Error(`تعذّر رفع الملف (${file.name}): ${friendlyMsg}`);
    }

    const { data: publicUrlData } = dbClient.storage
        .from(COMPANY_DOCS_BUCKET)
        .getPublicUrl(filePath);

    return publicUrlData ? publicUrlData.publicUrl : null;
}

// لو لم يختر المستخدم ملفاً جديداً لهذا الحقل، ونحن في وضع "ربط بحساب موجود" ولدينا
// رابط ملف من الشركة الرئيسية لنفس الحقل، نعيد استخدامه بدل تركه فارغاً
async function uploadCompanyFileOrReusePrimary(inputId, folderName, prefillKey, isLinkingExisting) {
    const uploadedUrl = await uploadCompanyFile(inputId, folderName);
    if (uploadedUrl) return uploadedUrl;
    if (isLinkingExisting && prefillDocumentUrls[prefillKey]) return prefillDocumentUrls[prefillKey];
    return null;
}

// =========================================================================
// 4. ربط الأحداث
// =========================================================================
document.addEventListener('DOMContentLoaded', async function() {
    const allowed = await Permissions.guardPage('companies');
    if (!allowed) return;

    const form = document.getElementById('addCompanyForm');
    const cancelBtn = document.getElementById('btnCancel');

    loadExistingAccountsForCombobox();

    const linkExistingCheckbox = document.getElementById('companyLinkExistingAccount');
    linkExistingCheckbox.addEventListener('change', updateAccountLinkModeVisibility);
    updateAccountLinkModeVisibility();

    const statusSelect = document.getElementById('companyStatus');
    if (statusSelect) {
        statusSelect.addEventListener('change', updateCompanyStatusNoteVisibility);
        updateCompanyStatusNoteVisibility();
    }

    bindFileNamePreview('companyContractFile', 'fileNameContract');
    bindFileNamePreview('companyAddressFile', 'fileNameAddressDoc');
    bindFileNamePreview('companyTaxCertFile', 'fileNameTaxCert');
    bindFileNamePreview('companyCrCertFile', 'fileNameCrCert');

    const blurFieldIdsMap = {
        companyName: 'name',
        companyEmail: 'email',
        companySubscriptionValue: 'subscription_value',
        companyRefund: 'company_refund'
    };

    Object.keys(blurFieldIdsMap).forEach((inputId) => {
        const el = document.getElementById(inputId);
        if (!el) return;
        el.addEventListener('blur', () => {
            const msgs = getErrorMessages();
            const fieldName = blurFieldIdsMap[inputId];
            setFieldError(fieldName, validateField(fieldName, form, msgs));
        });
    });

    // 1. زر إلغاء يرجع لصفحة قائمة الشركات
    cancelBtn.addEventListener('click', function() {
        if (confirm('هل أنت متأكد من إلغاء العملية؟ لن يتم حفظ البيانات.')) {
            window.location.href = Routes.url('companies');
        }
    });

    // 2. حفظ الشركة الجديدة
    form.addEventListener('submit', async function(event) {
        event.preventDefault();
        hideFormAlert();

        if (!validateAllFields(form)) {
            showFormAlert('الرجاء تصحيح الحقول المظللة أدناه.', 'error');
            return;
        }

        const isLinkingExisting = document.getElementById('companyLinkExistingAccount').checked;

        const name = document.getElementById('companyName').value.trim();
        const phone = document.getElementById('companyPhone').value.trim() || null;
        const crNumber = document.getElementById('companyCR').value.trim() || null;
        const taxNumber = document.getElementById('companyTax').value.trim() || null;
        const city = document.getElementById('companyCity').value.trim() || null;
        // قطاع العمل مقفل على "خاص" في هذه الشاشة (القائمة تحتوي على خيار واحد فقط)
        const sector = document.getElementById('companySector').value.trim() || 'خاص';
        const address = document.getElementById('companyAddress').value.trim() || null;

        // حالة الشركة (نشط/غير نشط) وملاحظتها الاختيارية (تُحفظ فقط عند "غير نشط")
        const companyStatus = document.getElementById('companyStatus').value || 'active';
        const companyStatusNote = companyStatus === 'inactive'
            ? (document.getElementById('companyStatusNote').value.trim() || null)
            : null;

        // الحقول الاختيارية الجديدة: نوع العقد، تاريخ العقد، قيمة الاشتراك، رقم المنشأة، رقم هوية المنشأة، الشخص المفوض ورقم جواله، اسم المندوب
        const contractType = document.getElementById('companyContractType').value.trim() || 'إستضافة';
        const contractDateRaw = document.getElementById('companyContractDate').value;
        const contractDate = contractDateRaw || null;
        const subscriptionValueRaw = document.getElementById('companySubscriptionValue').value.trim();
        const subscriptionValue = subscriptionValueRaw === '' ? null : parseFloat(subscriptionValueRaw);
        const companyRefundRaw = document.getElementById('companyRefund').value.trim();
        const companyRefund = companyRefundRaw === '' ? 0 : parseFloat(companyRefundRaw);
        const establishmentNumber = document.getElementById('companyEstablishmentNumber').value.trim() || null;
        const establishmentNationalId = document.getElementById('companyEstablishmentId').value.trim() || null;
        const authorizedPerson = document.getElementById('companyAuthorizedPerson').value.trim() || null;
        const authorizedPersonPhone = document.getElementById('companyAuthorizedPersonPhone').value.trim() || null;
        // 🆕 اسم المندوب
        const representativeName = document.getElementById('companyRepresentativeName').value.trim() || null;
        // هل قيمة الاشتراك شاملة الضريبة المضافة (فقط ذات معنى فعلي إن أُدخلت قيمة اشتراك)
        const vatIncluded = document.getElementById('companyVatIncluded').checked;

        // كلمة مرور موحّدة لكل حسابات مسؤولي الشركات الجديدة؛ تُجبر على تغييرها عند أول دخول
        const password = DEFAULT_COMPANY_PASSWORD;

        const submitBtn = form.querySelector('.btn-submit');
        const originalBtnText = submitBtn.textContent;
        submitBtn.disabled = true;

        try {
            let finalUserId = null;
            let finalEmail = null;

            if (isLinkingExisting) {
                // ---------------------------------------------------------------
                // مسار "ربط بحساب موجود": لا يُنشأ حساب Authentication جديد ولا
                // كلمة مرور جديدة؛ فقط نربط سجل الشركة الجديد بنفس user_id وبريد
                // الحساب المُختار، بحيث يسجّل صاحبه الدخول بنفس بياناته المعتادة
                // ليرى شركته الجديدة أيضاً ضمن حسابه.
                // ---------------------------------------------------------------
                const selectedAccountId = document.getElementById('companyExistingAccountId').value.trim();
                const selectedAccount = existingAccountsById[selectedAccountId];

                if (!selectedAccount) {
                    setFieldError('existing_account', 'الرجاء اختيار حساب صحيح من القائمة.');
                    showFormAlert('الرجاء اختيار حساب صحيح من القائمة.', 'error');
                    return;
                }

                finalUserId = selectedAccountId;
                finalEmail = selectedAccount.email;
            } else {
                // ---------------------------------------------------------------
                // المسار الافتراضي: إنشاء حساب دخول جديد بالكامل لمسؤول الشركة
                // ---------------------------------------------------------------
                const email = document.getElementById('companyEmail').value.trim().toLowerCase();

                // 1. فحص عدم تكرار البريد الإلكتروني في جدولي الشركات والمستخدمين معاً
                //    (لازم يكون فريداً بما إنه سيُستخدم لإنشاء حساب Authentication)
                submitBtn.textContent = 'جاري التحقق من البريد الإلكتروني...';
                const [{ data: existingCompanyByEmail, error: companyEmailCheckError }, { data: existingUserByEmail, error: userEmailCheckError }] = await Promise.all([
                    dbClient.from('companies').select('id').eq('email', email).maybeSingle(),
                    dbClient.from('users').select('id').eq('email', email).maybeSingle()
                ]);

                if (companyEmailCheckError) throw new Error(companyEmailCheckError.message);
                if (userEmailCheckError) throw new Error(userEmailCheckError.message);

                if (existingCompanyByEmail || existingUserByEmail) {
                    const dupMsg = 'هذا البريد الإلكتروني مسجل مسبقاً بالنظام. فعّل خيار "ربط هذه الشركة بحساب دخول موجود" أعلاه إن كنت تريد ربط هذه الشركة بنفس ذلك الحساب.';
                    setFieldError('email', dupMsg);
                    showFormAlert(dupMsg, 'error');
                    return;
                }

                // 2. إنشاء حساب Authentication فعلي لمسؤول الشركة
                //    نحفظ جلسة المسؤول الحالي أولاً لأن signUp() قد يبدّل الجلسة النشطة
                //    تلقائياً إلى المستخدم الجديد (لو "Confirm email" غير مفعّل بالمشروع).
                submitBtn.textContent = 'جاري إنشاء حساب الدخول...';
                const { data: { session: adminSessionBeforeCreate } } = await dbClient.auth.getSession();

                const { data: authData, error: authError } = await dbClient.auth.signUp({
                    email: email,
                    password: password,
                    options: {
                        // يقرأها الـ trigger (handle_new_user) تلقائياً عند إنشاء صف users
                        data: {
                            name: name,
                            role: 'company',
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

                const newAuthUserId = (authData && authData.user) ? authData.user.id : crypto.randomUUID();

                // 3. تأكيد بيانات صف users (الـ trigger أنشأه تلقائياً عند signUp أعلاه)
                //    نستخدم upsert بدل insert لتفادي تعارض المفتاح الأساسي مع الصف
                //    الذي أنشأه الـ trigger تلقائياً، ولضمان اكتمال كل الحقول بدقة.
                submitBtn.textContent = 'جاري حفظ حساب المستخدم...';
                const usersPayload = {
                    id: newAuthUserId,
                    name: name,
                    email: email,
                    role: 'company',
                    status: 'active',
                    must_change_password: true
                };

                const { error: userInsertError } = await dbClient
                    .from('users')
                    .upsert([usersPayload], { onConflict: 'id' });

                if (userInsertError) throw new Error(userInsertError.message);

                finalUserId = newAuthUserId;
                finalEmail = email;
            }

            // 4. رفع الشعار والمستندات (لو موجودة) إلى Supabase Storage — وفي وضع "ربط
            //    بحساب موجود"، أي ملف لم يُختَر يُستبدل تلقائياً برابط ملف الشركة الرئيسية
            //    (إن وُجد) بدل تركه فارغاً بالكامل
            submitBtn.textContent = 'جاري رفع المستندات...';
            const companyFolderKey = crypto.randomUUID();

            const [logoUrl, contractUrl, nationalAddressUrl, taxCertificateUrl, crCertificateUrl] = await Promise.all([
                uploadCompanyFileOrReusePrimary('companyLogoFile', `${companyFolderKey}/logo`, 'logo_url', isLinkingExisting),
                uploadCompanyFileOrReusePrimary('companyContractFile', `${companyFolderKey}/contract`, 'contract_url', isLinkingExisting),
                uploadCompanyFileOrReusePrimary('companyAddressFile', `${companyFolderKey}/national_address`, 'national_address_url', isLinkingExisting),
                uploadCompanyFileOrReusePrimary('companyTaxCertFile', `${companyFolderKey}/tax_certificate`, 'tax_certificate_url', isLinkingExisting),
                uploadCompanyFileOrReusePrimary('companyCrCertFile', `${companyFolderKey}/cr_certificate`, 'cr_certificate_url', isLinkingExisting)
            ]);

            // 5. حفظ سجل الشركة الكامل، مربوطاً بحساب المستخدم عبر user_id
            //    (سواء كان حساباً جديداً أُنشئ للتو، أو حساباً موجوداً سابقاً تم اختياره)
            submitBtn.textContent = 'جاري حفظ بيانات الشركة...';
            const payload = {
                user_id: finalUserId,
                name,
                email: finalEmail,
                phone,
                cr_number: crNumber,
                tax_number: taxNumber,
                city,
                sector,
                address,
                status: companyStatus,
                status_note: companyStatusNote,
                subscription: "Basic",
                contract_type: contractType,
                contract_date: contractDate,
                subscription_value: subscriptionValue,
                vat_included: vatIncluded,
                company_refund: companyRefund,
                establishment_number: establishmentNumber,
                establishment_national_id: establishmentNationalId,
                authorized_person: authorizedPerson,
                authorized_person_phone: authorizedPersonPhone,
                representative_name: representativeName,
                logo_url: logoUrl,
                contract_url: contractUrl,
                national_address_url: nationalAddressUrl,
                tax_certificate_url: taxCertificateUrl,
                cr_certificate_url: crCertificateUrl
            };

            const { error: insertError } = await dbClient
                .from('companies')
                .insert([payload]);

            if (insertError) throw new Error(insertError.message);

            const successMsg = isLinkingExisting
                ? 'تم إضافة الشركة بنجاح وربطها بحساب الدخول المختار! جاري التحويل...'
                : `تم إضافة الشركة بنجاح! كلمة المرور الافتراضية لمسؤول الشركة: ${DEFAULT_COMPANY_PASSWORD} — سيُطلب منه تغييرها عند أول تسجيل دخول. جاري التحويل...`;

            showFormAlert(successMsg, 'success');
            setTimeout(() => {
                window.location.href = Routes.url('companies');
            }, 2200);

        } catch (error) {
            console.error('Company Creation Error (raw):', error);
            const rawMsg = error && (error.message || error.error_description || error.hint || error.details);
            const displayMsg = (rawMsg && rawMsg !== '{}')
                ? rawMsg
                : 'حدث خطأ غير متوقع من قاعدة البيانات بدون تفاصيل. افتح أدوات المطوّر (F12) → Console وشاركني ما يظهر هناك.';
            showFormAlert('فشلت العملية: ' + displayMsg, 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = originalBtnText;
        }
    });
});