// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================

// اسم Bucket المستخدم لتخزين شعار ومستندات الشركة على Supabase Storage
const COMPANY_DOCS_BUCKET = "company-documents";
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

// معرّف الشركة الجاري تعديلها والنسخة الأصلية من بياناتها
let currentCompanyId = null;
let currentCompanyRecord = null;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// =========================================================================
// 1.5 إدارة حذف/إرفاق المستندات الرسمية — العقد/العنوان الوطني/الشهادة
//     الضريبية/شهادة السجل التجاري. كل مستند إما يبقى كما هو، أو يُستبدل
//     بملف جديد (اختيار ملف)، أو يُعلَّم للحذف عبر زر "حذف الملف الحالي".
// =========================================================================
const DOCUMENT_FIELD_MAP = {
    contract_url: { noteId: 'currentFileContract', inputId: 'modalCompanyContractFile' },
    national_address_url: { noteId: 'currentFileAddress', inputId: 'modalCompanyAddressFile' },
    tax_certificate_url: { noteId: 'currentFileTaxCert', inputId: 'modalCompanyTaxCertFile' },
    cr_certificate_url: { noteId: 'currentFileCrCert', inputId: 'modalCompanyCrCertFile' }
};

// حالة "معلّم للحذف" لكل نوع مستند؛ تُصفَّر تلقائياً عند اختيار ملف جديد لنفس الحقل
let documentRemovalFlags = {
    contract_url: false,
    national_address_url: false,
    tax_certificate_url: false,
    cr_certificate_url: false
};

// يبني محتوى صندوق "الملف الحالي" لمستند معيّن حسب حالته (موجود / معلّم للحذف / غير موجود)
// 🎨 يعتمد على أيقونات SVG الموحّدة (icons.js) بدل رموز الإيموجي (🗑️/📎) القديمة
function renderDocumentNote(key) {
    const fieldInfo = DOCUMENT_FIELD_MAP[key];
    if (!fieldInfo) return;
    const el = document.getElementById(fieldInfo.noteId);
    if (!el) return;

    const url = currentCompanyRecord ? currentCompanyRecord[key] : null;
    el.style.display = 'block';

    if (documentRemovalFlags[key]) {
        // 🩹 الأيقونات هنا تُبنى عبر data-icon + applyIconPlaceholders بدل تضمين
        // كود ICONS.xxx الخام مباشرة داخل innerHTML: بلا هذا، تُدرَج وسوم <svg>
        // بلا أي عنصر أب يحمل [data-icon] الذي تعتمد عليه قاعدة التحجيم بـ icons.js
        // (width/height: 1em)، فيرثها المتصفح بأبعادها الافتراضية الضخمة (~300×150px)
        // بدل حجم النص المحيط بها — وهذا بالضبط سبب ظهور الأيقونة "كبيرة".
        el.innerHTML = `<span style="color:#ef4444;"><span data-icon="trash" class="icon-inline"></span> سيتم حذف الملف الحالي عند حفظ التعديلات.</span> <button type="button" onclick="undoRemoveCompanyDocument('${key}')" style="cursor:pointer; background:none; border:none; color:#2563eb; text-decoration:underline; font-size:0.85rem; margin-inline-start:6px;">تراجع عن الحذف</button>`;
        applyIconPlaceholders(el);
        return;
    }

    if (url) {
        el.innerHTML = `<span data-icon="paperclip" class="icon-inline"></span> الملف الحالي: <a href="${url}" target="_blank" rel="noopener">عرض الملف</a> <button type="button" class="action-icon-btn" data-icon="trash" title="حذف الملف الحالي" onclick="markCompanyDocumentForRemoval('${key}')" style="color:#ef4444; cursor:pointer; background:none; border:none; margin-inline-start:6px; vertical-align:middle;"></button>`;
        applyIconPlaceholders(el);
    } else {
        el.innerHTML = 'لا يوجد ملف مرفوع حالياً.';
    }
}

// 🗑️ يُعلِّم مستنداً معيّناً للحذف عند الحفظ، ويُلغي أي ملف جديد كان قد اختير لنفس الحقل
function markCompanyDocumentForRemoval(key) {
    documentRemovalFlags[key] = true;
    const fieldInfo = DOCUMENT_FIELD_MAP[key];
    if (fieldInfo) {
        const input = document.getElementById(fieldInfo.inputId);
        if (input) input.value = '';
    }
    renderDocumentNote(key);
}

// ↩️ تراجع عن تعليم مستند للحذف، فيعود لعرض رابط الملف الحالي كما كان
function undoRemoveCompanyDocument(key) {
    documentRemovalFlags[key] = false;
    renderDocumentNote(key);
}

// 📎 عرض روابط الملفات المرفوعة مسبقاً (إن وُجدت) أعلى كل صندوق رفع
function renderCurrentFileLinks() {
    Object.keys(DOCUMENT_FIELD_MAP).forEach((key) => renderDocumentNote(key));
}

// =========================================================================
// 1.6 مكوّن قائمة قابلة للبحث (Searchable Combobox) — نفس منطق شاشة "إضافة
//     شركة"، يُستخدم هنا لاختيار حساب دخول آخر عند تفعيل خيار "ربط هذه
//     الشركة بحساب دخول آخر (بدلاً من الحساب الحالي)
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

let relinkAccountCombobox = null;
// خريطة سريعة من معرّف الحساب إلى بريده الإلكتروني (نحتاج البريد الفعلي عند الحفظ)
let relinkAccountsById = {};

// يحمّل قائمة حسابات "مسؤول شركة" (role = company) المتاحة للربط، باستثناء
// الحساب المرتبط حالياً بهذه الشركة (لا فائدة من "الربط" بنفس الحساب الحالي)
async function loadAccountsForRelinkCombobox() {
    relinkAccountCombobox = setupSearchableCombobox({
        inputId: 'companyRelinkAccountSearch',
        hiddenId: 'companyRelinkAccountId',
        dropdownId: 'companyRelinkAccountDropdown',
        options: [],
        emptyText: 'لا توجد حسابات شركات مطابقة',
        onSelectExtra: () => {
            setFieldError('group-relink_existing_account', false);
            const errEl = document.getElementById('error-relink_existing_account');
            if (errEl) errEl.textContent = '';
        }
    });

    try {
        const { data, error } = await dbClient
            .from('users')
            .select('id, name, email')
            .eq('role', 'company')
            .order('name', { ascending: true });

        if (error) throw new Error(error.message);

        relinkAccountsById = {};
        const currentUserId = currentCompanyRecord ? String(currentCompanyRecord.user_id || '') : '';
        const options = (data || [])
            .filter(u => String(u.id) !== currentUserId)
            .map(u => {
                relinkAccountsById[String(u.id)] = u;
                return { value: String(u.id), label: `${u.name} — ${u.email}` };
            });

        relinkAccountCombobox.setOptions(options);
        relinkAccountCombobox.enable(options.length ? 'ابحث أو اختر الحساب' : 'لا توجد حسابات أخرى متاحة للربط');
    } catch (error) {
        console.error('تعذّر تحميل قائمة حسابات الشركات:', error.message);
        const input = document.getElementById('companyRelinkAccountSearch');
        if (input) input.placeholder = 'تعذّر تحميل القائمة';
    }
}

// يُظهر/يُخفي حقل "البريد الإلكتروني" الحالي (مقفل) مقابل حقل "اختيار حساب آخر"
// حسب حالة خيار "ربط هذه الشركة بحساب دخول آخر"
function updateRelinkModeVisibility() {
    const isRelinking = document.getElementById('companyRelinkAccount').checked;
    const emailGroup = document.getElementById('group-email');
    const relinkGroup = document.getElementById('group-relink_existing_account');

    emailGroup.style.display = isRelinking ? 'none' : '';
    relinkGroup.style.display = isRelinking ? '' : 'none';

    if (!isRelinking) {
        setFieldError('group-relink_existing_account', false);
        const errEl = document.getElementById('error-relink_existing_account');
        if (errEl) errEl.textContent = '';
        if (relinkAccountCombobox) relinkAccountCombobox.clear();
    }
}

// 🟢🔴 إظهار/إخفاء حقل "ملاحظة" الحالة — يظهر فقط عند اختيار "غير نشط"
function updateCompanyStatusNoteVisibility() {
    const statusSelect = document.getElementById('modalCompanyStatus');
    const noteGroup = document.getElementById('group-status_note');
    if (!statusSelect || !noteGroup) return;
    const isInactive = statusSelect.value === 'inactive';
    noteGroup.style.display = isInactive ? '' : 'none';
}

// =========================================================================
// 2. أدوات مساعدة لعرض شريط التنبيه ورسائل الحقول
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

function setFieldError(groupId, hasError) {
    const group = document.getElementById(groupId);
    if (!group) return;
    group.classList.toggle('has-error', !!hasError);
}

// معاينة الشعار المرفوع محلياً (ملاحظة: لا يُحفظ رابطه بقاعدة البيانات حالياً)
function previewCompanyLogo(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            document.getElementById('avatarPreview').style.backgroundImage = `url('${e.target.result}')`;
        };
        reader.readAsDataURL(file);
    }
}

// عرض اسم الملف المختار داخل صندوق الرفع بدل النص الافتراضي، وإلغاء أي تعليم سابق للحذف
function bindFileNamePreview(inputId, previewId, docKey) {
    const input = document.getElementById(inputId);
    const preview = document.getElementById(previewId);
    if (!input || !preview) return;
    input.addEventListener('change', () => {
        if (input.files && input.files[0]) {
            // 🎨 أيقونة SVG موحّدة (icons.js) بدل إيموجي 📎 القديم — عبر data-icon +
            // applyIconPlaceholders (وليس ICONS.paperclip الخام) حتى تُطبَّق قاعدة
            // تحجيم الأيقونة (1em) الموجودة بـ icons.js ولا تظهر الأيقونة بحجمها
            // الافتراضي الضخم؛ اسم الملف يبقى عقدة نصية منفصلة (createTextNode) حتى
            // لا يُفسَّر اسم الملف القادم من المستخدم كـ HTML أبداً
            preview.innerHTML = '<span data-icon="paperclip" class="icon-inline"></span> ';
            preview.appendChild(document.createTextNode(input.files[0].name));
            preview.classList.add('has-file');
            applyIconPlaceholders(preview);
            if (docKey) {
                documentRemovalFlags[docKey] = false; // اختيار ملف جديد يُلغي تلقائياً أي تعليم سابق للحذف
            }
        } else {
            preview.textContent = 'اختر ملفاً جديداً لاستبدال الحالي (حد أقصى 5MB)';
            preview.classList.remove('has-file');
        }
    });
}

function validateFileField(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return null;
    const file = input.files && input.files[0];
    if (!file) return null; // كل الملفات اختيارية
    if (file.size > MAX_FILE_SIZE_BYTES) return 'حجم الملف أكبر من الحد المسموح (5MB).';
    return null;
}

// =========================================================================
// 3. جلب بيانات الشركة المطلوب تعديلها
// =========================================================================
async function fetchCompanyRecord(id) {
    const { data, error } = await dbClient
        .from('companies')
        .select('*')
        .eq('id', id)
        .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) throw new Error('COMPANY_NOT_FOUND');
    return data;
}

function populateFormWithCompany(company) {
    document.getElementById('modalCompanyName').value = company.name || '';
    document.getElementById('modalCompanyEmail').value = company.email || '';
    document.getElementById('modalCompanyPhone').value = company.phone || '';
    document.getElementById('modalCompanyCR').value = company.cr_number || '';
    document.getElementById('modalCompanyTax').value = company.tax_number || '';
    document.getElementById('modalCompanyCity').value = company.city || '';
    // قطاع العمل مقفل الآن على خيار واحد فقط ("خاص")، فلا داعٍ لضبط قيمته من بيانات
    // الشركة المحفوظة سابقاً (قد تكون "حكومي" من بيانات قديمة، وهي قيمة لم تعد متاحة بالقائمة)
    document.getElementById('modalCompanyAddress').value = company.address || '';

    // الحالة (نشط/غير نشط) وملاحظتها — تُعبَّأ "نشط" افتراضياً لو لم تُحدَّد الحالة
    // بعد بسجلات قديمة أُنشئت قبل إضافة هذا الحقل
    const statusSelect = document.getElementById('modalCompanyStatus');
    if (statusSelect) statusSelect.value = company.status || 'active';
    document.getElementById('modalCompanyStatusNote').value = company.status_note || '';
    updateCompanyStatusNoteVisibility();

    // الحقول الاختيارية الجديدة: نوع العقد، تاريخ العقد، قيمة الاشتراك (وهل هي شاملة الضريبة)، رقم المنشأة،
    // رقم هوية المنشأة، الشخص المفوض ورقم جواله، اسم المندوب
    document.getElementById('modalCompanyContractType').value = company.contract_type || 'إستضافة';
    document.getElementById('modalCompanyContractDate').value = company.contract_date ? String(company.contract_date).split('T')[0] : '';
    document.getElementById('modalCompanySubscriptionValue').value = company.subscription_value != null ? company.subscription_value : '';
    document.getElementById('modalCompanyVatIncluded').checked = !!company.vat_included;
    document.getElementById('modalCompanyEstablishmentNumber').value = company.establishment_number || '';
    document.getElementById('modalCompanyEstablishmentId').value = company.establishment_national_id || '';
    document.getElementById('modalCompanyAuthorizedPerson').value = company.authorized_person || '';
    document.getElementById('modalCompanyAuthorizedPersonPhone').value = company.authorized_person_phone || '';
    // 🆕 اسم المندوب
    document.getElementById('modalCompanyRepresentativeName').value = company.representative_name || '';

    // إعادة تصفير خيار "ربط بحساب آخر" عند كل تحميل جديد للبيانات
    const relinkCheckbox = document.getElementById('companyRelinkAccount');
    if (relinkCheckbox) relinkCheckbox.checked = false;
    updateRelinkModeVisibility();

    // إعادة تصفير حالات "معلّم للحذف" عند كل تحميل جديد للبيانات، ثم عرض روابط الملفات الحالية
    Object.keys(documentRemovalFlags).forEach((key) => { documentRemovalFlags[key] = false; });
    renderCurrentFileLinks();

    const fieldsWrapper = document.getElementById('editCompanyFields');
    const submitBtn = document.getElementById('btnSubmitEditCompany');
    if (fieldsWrapper) fieldsWrapper.style.display = 'block';
    if (submitBtn) submitBtn.style.display = 'inline-block';
}

// =========================================================================
// 4. رفع/استبدال المستندات في Supabase Storage
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

// يرفع الملف الجديد فقط لو تم اختياره؛ وإلا — لو عُلِّم هذا المستند للحذف يُعاد null
// (فيُحذف الرابط عند الحفظ)، وإلا يُبقي على رابط الملف الحالي كما هو دون تغيير
async function uploadCompanyFileIfSelected(inputId, folderName, existingUrl, isMarkedForRemoval) {
    const input = document.getElementById(inputId);
    const file = input.files && input.files[0];
    if (file) return await uploadCompanyFile(inputId, folderName);
    if (isMarkedForRemoval) return null;
    return existingUrl || null;
}

// =========================================================================
// 5. حفظ التعديلات
// =========================================================================
async function handleEditCompanySubmit(event) {
    event.preventDefault();
    hideFormAlert();

    if (!currentCompanyId || !currentCompanyRecord) return;

    const companyName = document.getElementById('modalCompanyName').value.trim();
    // البريد الإلكتروني مقفل ولا يمكن تعديله مباشرة من هذه الشاشة: يُؤخذ من السجل الأصلي المحمَّل دائماً،
    // وليس من الحقل بالنموذج (حتى لو تم التلاعب بخاصية readonly عبر أدوات المطوّر).
    // القيمة الفعلية المحفوظة قد تُستبدل ببريد حساب آخر إن تم تفعيل خيار "ربط بحساب آخر" أدناه.
    const companyEmail = (currentCompanyRecord.email || '').trim().toLowerCase();
    const companyPhone = document.getElementById('modalCompanyPhone').value.trim();
    const companyCR = document.getElementById('modalCompanyCR').value.trim();
    const companyTax = document.getElementById('modalCompanyTax').value.trim();
    const companyCity = document.getElementById('modalCompanyCity').value.trim();
    // قطاع العمل مقفل الآن على خيار واحد فقط ("خاص")؛ نعتمد قيمة افتراضية احتياطية
    // بنفس أسلوب شاشة إضافة شركة جديدة تحسباً لأي حالة يكون فيها الحقل فارغاً
    const companySector = document.getElementById('modalCompanySector').value.trim() || 'خاص';
    const companyAddress = document.getElementById('modalCompanyAddress').value.trim();

    // الحالة (نشط/غير نشط) وملاحظتها الاختيارية (تُحفظ فقط عند "غير نشط")
    const companyStatus = document.getElementById('modalCompanyStatus').value || 'active';
    const companyStatusNote = companyStatus === 'inactive'
        ? (document.getElementById('modalCompanyStatusNote').value.trim() || null)
        : null;

    // الحقول الاختيارية الجديدة
    const contractType = document.getElementById('modalCompanyContractType').value.trim() || 'إستضافة';
    const contractDateRaw = document.getElementById('modalCompanyContractDate').value;
    const contractDate = contractDateRaw || null;
    const subscriptionValueRaw = document.getElementById('modalCompanySubscriptionValue').value.trim();
    const vatIncluded = document.getElementById('modalCompanyVatIncluded').checked;
    const establishmentNumber = document.getElementById('modalCompanyEstablishmentNumber').value.trim() || null;
    const establishmentNationalId = document.getElementById('modalCompanyEstablishmentId').value.trim() || null;
    const authorizedPerson = document.getElementById('modalCompanyAuthorizedPerson').value.trim() || null;
    const authorizedPersonPhone = document.getElementById('modalCompanyAuthorizedPersonPhone').value.trim() || null;
    // 🆕 اسم المندوب
    const representativeName = document.getElementById('modalCompanyRepresentativeName').value.trim() || null;

    // خيار "ربط هذه الشركة بحساب دخول آخر"
    const isRelinking = document.getElementById('companyRelinkAccount').checked;
    const relinkAccountIdRaw = document.getElementById('companyRelinkAccountId').value.trim();

    setFieldError('group-name', false);
    setFieldError('group-subscription_value', false);
    setFieldError('group-relink_existing_account', false);

    let hasError = false;
    if (!companyName || companyName.length < 2) {
        setFieldError('group-name', true);
        hasError = true;
    }

    // قيمة الاشتراك اختيارية: لا تُعتبر خطأً إن تُركت فارغة، فقط إن كانت صيغتها غير صحيحة
    let subscriptionValue = null;
    if (subscriptionValueRaw !== '') {
        const num = parseFloat(subscriptionValueRaw);
        if (isNaN(num) || num < 0) {
            setFieldError('group-subscription_value', true);
            hasError = true;
        } else {
            subscriptionValue = num;
        }
    }

    // عند تفعيل "ربط بحساب آخر" يجب اختيار حساب فعلي من القائمة
    if (isRelinking && !relinkAccountIdRaw) {
        setFieldError('group-relink_existing_account', true);
        const relinkErrEl = document.getElementById('error-relink_existing_account');
        if (relinkErrEl) relinkErrEl.textContent = 'الرجاء اختيار الحساب المطلوب الربط به.';
        hasError = true;
    }

    // فحص حجم ملفات المستندات الجديدة المختارة (إن وُجدت)
    const fileFieldMap = {
        contract_file: 'modalCompanyContractFile',
        national_address_file: 'modalCompanyAddressFile',
        tax_certificate_file: 'modalCompanyTaxCertFile',
        cr_certificate_file: 'modalCompanyCrCertFile'
    };
    Object.keys(fileFieldMap).forEach((fieldName) => {
        const errorMsg = validateFileField(fileFieldMap[fieldName]);
        setFieldError('group-' + fieldName, !!errorMsg);
        const errorEl = document.getElementById('error-' + fieldName);
        if (errorEl) errorEl.textContent = errorMsg || '';
        if (errorMsg) hasError = true;
    });

    if (hasError) {
        showFormAlert('الرجاء تصحيح الحقول المظللة أدناه.', 'error');
        return;
    }

    const submitBtn = document.getElementById('btnSubmitEditCompany');
    const originalBtnText = submitBtn.textContent;
    submitBtn.disabled = true;

    try {
        // تحديد الحساب (user_id) والبريد الإلكتروني النهائيين لسجل الشركة:
        // - في الوضع الافتراضي: نفس الحساب الحالي وبريده كما هما دون تغيير
        // - عند تفعيل "ربط بحساب آخر": الحساب المُختار من القائمة وبريده الفعلي
        let finalUserId = currentCompanyRecord.user_id || null;
        let finalEmail = companyEmail;

        if (isRelinking) {
            const selectedAccount = relinkAccountsById[relinkAccountIdRaw];
            if (!selectedAccount) {
                setFieldError('group-relink_existing_account', true);
                showFormAlert('الرجاء اختيار حساب صحيح من القائمة.', 'error');
                submitBtn.disabled = false;
                submitBtn.textContent = originalBtnText;
                return;
            }
            finalUserId = relinkAccountIdRaw;
            finalEmail = (selectedAccount.email || '').trim().toLowerCase();
        }

        // تحديث اسم المستخدم المرتبط بالحساب الحالي فقط عند عدم إعادة الربط —
        // فحساب "الربط الجديد" مشترك وقد يُدير شركات أخرى، فلا يصح تغيير اسمه
        // ليطابق اسم هذه الشركة فقط (بعكس add_company.js الذي يتبع نفس المبدأ
        // عند اختيار "ربط بحساب موجود" منذ البداية)
        if (!isRelinking && currentCompanyRecord.user_id) {
            submitBtn.textContent = 'جاري تحديث حساب المستخدم...';
            const { error: userUpdateError } = await dbClient
                .from('users')
                .update({ name: companyName })
                .eq('id', currentCompanyRecord.user_id);

            if (userUpdateError) throw new Error(userUpdateError.message);
        }

        // رفع/حذف أي مستندات — يُرفع الملف الجديد إن اختير، أو يُحذف الرابط إن عُلِّم
        // المستند للحذف، أو يبقى كما هو دون تغيير في الحالتين الأخريين
        submitBtn.textContent = 'جاري تحديث المستندات...';
        const companyFolderKey = currentCompanyId;

        const [contractUrl, nationalAddressUrl, taxCertificateUrl, crCertificateUrl] = await Promise.all([
            uploadCompanyFileIfSelected('modalCompanyContractFile', `${companyFolderKey}/contract`, currentCompanyRecord.contract_url, documentRemovalFlags.contract_url),
            uploadCompanyFileIfSelected('modalCompanyAddressFile', `${companyFolderKey}/national_address`, currentCompanyRecord.national_address_url, documentRemovalFlags.national_address_url),
            uploadCompanyFileIfSelected('modalCompanyTaxCertFile', `${companyFolderKey}/tax_certificate`, currentCompanyRecord.tax_certificate_url, documentRemovalFlags.tax_certificate_url),
            uploadCompanyFileIfSelected('modalCompanyCrCertFile', `${companyFolderKey}/cr_certificate`, currentCompanyRecord.cr_certificate_url, documentRemovalFlags.cr_certificate_url)
        ]);

        // تحديث سجل الشركة (البريد و/أو معرّف الحساب يتغيران فقط عند تفعيل "ربط بحساب آخر")
        submitBtn.textContent = 'جاري حفظ التعديلات...';
        const payload = {
            name: companyName,
            email: finalEmail,
            user_id: finalUserId,
            phone: companyPhone,
            cr_number: companyCR,
            tax_number: companyTax,
            city: companyCity,
            sector: companySector,
            address: companyAddress,
            status: companyStatus,
            status_note: companyStatusNote,
            contract_type: contractType,
            contract_date: contractDate,
            subscription_value: subscriptionValue,
            vat_included: vatIncluded,
            establishment_number: establishmentNumber,
            establishment_national_id: establishmentNationalId,
            authorized_person: authorizedPerson,
            authorized_person_phone: authorizedPersonPhone,
            representative_name: representativeName,
            contract_url: contractUrl,
            national_address_url: nationalAddressUrl,
            tax_certificate_url: taxCertificateUrl,
            cr_certificate_url: crCertificateUrl
        };

        // نطلب .select() على التحديث حتى نعرف بالضبط هل تم تعديل أي سجل فعلياً؛
        // فبعض إعدادات RLS بسوبابيس تمنع التحديث بصمت (تُرجع نجاحاً بدون أي صف
        // مُعدَّل فعلياً) بدل رسالة خطأ صريحة، فيبدو للمستخدم أن الزر "لا يعمل".
        const { data: updatedRows, error: updateError } = await dbClient
            .from('companies')
            .update(payload)
            .eq('id', currentCompanyId)
            .select();

        if (updateError) throw new Error(updateError.message);

        if (!updatedRows || updatedRows.length === 0) {
            showFormAlert("لم يتم حفظ أي تعديل فعلياً. غالباً السبب عدم وجود سياسة تحديث (RLS UPDATE Policy) على جدول 'companies' في سوبابيس.", 'error');
            return;
        }

        const successMsg = isRelinking
            ? 'تم حفظ تعديلات بيانات الشركة وربطها بحساب الدخول الجديد بنجاح! جاري التحويل...'
            : 'تم حفظ تعديلات بيانات الشركة بنجاح! جاري التحويل...';
        showFormAlert(successMsg, 'success');
        setTimeout(() => {
            window.location.href = Routes.url('companies');
        }, 1600);

    } catch (error) {
        console.error('Company Update Error (raw):', error);
        const rawMsg = error && (error.message || error.details || error.hint);
        showFormAlert('فشلت العملية: ' + (rawMsg || 'حدث خطأ غير متوقع.'), 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalBtnText;
    }
}

// =========================================================================
// 6. ربط الأحداث وتحميل بيانات الشركة عند فتح الصفحة
// =========================================================================
document.addEventListener('DOMContentLoaded', async function() {
    const allowed = await Permissions.guardPage('companies');
    if (!allowed) return;

    const form = document.getElementById('editCompanyForm');
    const cancelBtn = document.getElementById('btnCancel');

    bindFileNamePreview('modalCompanyContractFile', 'fileNameContract', 'contract_url');
    bindFileNamePreview('modalCompanyAddressFile', 'fileNameAddressDoc', 'national_address_url');
    bindFileNamePreview('modalCompanyTaxCertFile', 'fileNameTaxCert', 'tax_certificate_url');
    bindFileNamePreview('modalCompanyCrCertFile', 'fileNameCrCert', 'cr_certificate_url');

    const relinkCheckbox = document.getElementById('companyRelinkAccount');
    relinkCheckbox.addEventListener('change', updateRelinkModeVisibility);
    updateRelinkModeVisibility();

    const statusSelect = document.getElementById('modalCompanyStatus');
    if (statusSelect) statusSelect.addEventListener('change', updateCompanyStatusNoteVisibility);

    const urlParams = new URLSearchParams(window.location.search);
    currentCompanyId = urlParams.get('id');

    cancelBtn.addEventListener('click', function() {
        if (confirm('هل أنت متأكد من إلغاء التعديل؟ لن يتم حفظ أي تغييرات.')) {
            window.location.href = Routes.url('companies');
        }
    });

    if (!currentCompanyId) {
        showFormAlert('لم يتم تحديد أي شركة لتعديل بياناتها.', 'error');
        return;
    }

    try {
        const company = await fetchCompanyRecord(currentCompanyId);
        currentCompanyRecord = company;
        populateFormWithCompany(company);
        // نحمّل قائمة الحسابات المتاحة للربط بعد معرفة الحساب الحالي حتى نستبعده من القائمة
        loadAccountsForRelinkCombobox();
    } catch (error) {
        console.error('تعذّر تحميل بيانات الشركة للتعديل:', error.message);
        const notFound = error.message === 'COMPANY_NOT_FOUND';
        showFormAlert(
            notFound
                ? 'تعذّر العثور على هذه الشركة، ربما تم حذفها.'
                : 'تعذّر تحميل بيانات الشركة: ' + error.message,
            'error'
        );
        return;
    }

    form.addEventListener('submit', handleEditCompanySubmit);
});
