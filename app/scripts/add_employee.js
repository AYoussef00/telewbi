// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================

// اسم Bucket المستخدم لتخزين مستندات الموظفين على Supabase Storage
const EMPLOYEE_DOCS_BUCKET = "employee-documents";
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

// كلمة المرور الافتراضية لأي حساب موظف جديد يُنشأ من هذه الشاشة.
// يُجبر الموظف على تغييرها فور أول تسجيل دخول (عبر علامة must_change_password بجدول users).
const DEFAULT_EMPLOYEE_PASSWORD = "Basma@1234";

// =========================================================================
// 3. قواعد التحقق (Validation Rules)
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
        // ملاحظة: عمود employees.email أصبح nullable بقاعدة البيانات (بعد تعديل الجدول)،
        // لذا البريد الإلكتروني مطلوب فقط عند تفعيل "إنشاء حساب دخول للموظف".
        email_required: 'الرجاء إدخال البريد الإلكتروني (مطلوب لإنشاء حساب دخول الموظف).',
        email_invalid: 'صيغة البريد الإلكتروني غير صحيحة.',
        iban_invalid: 'صيغة رقم الآيبان غير صحيحة (مثال: SA0000000000000000000000).',
        status_required: 'الرجاء اختيار الحالة.',
        role_required: 'الرجاء اختيار الدور / الصلاحية.',
        file_too_large: 'حجم الملف أكبر من الحد المسموح (5MB).'
    };
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IBAN_REGEX = /^[A-Z]{2}[0-9A-Z]{20,32}$/;
// رقم جوال سعودي: يبدأ بـ 05 ويتكون من 10 أرقام بالضبط (مثال: 0512345678)
const MOBILE_REGEX = /^05\d{8}$/;

// هل خيار "إنشاء حساب دخول للموظف" مُفعّل حالياً؟ (البريد يصبح مطلوباً فقط في هذه الحالة،
// لأن عمود employees.email أصبح nullable بقاعدة البيانات ويسمح بترك الحقل فارغاً بدون حساب دخول)
// ملاحظة: الحالة الافتراضية للخيار أصبحت "غير مُفعّل" — لذا القيمة الاحتياطية (لو تعذّر
// إيجاد عنصر الـ checkbox بالصفحة لأي سبب) أصبحت false بدل true لتطابق هذا الافتراضي.
function isAccountCreationEnabled() {
    const checkbox = document.getElementById('empCreateAccount');
    return checkbox ? checkbox.checked : false;
}

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
        case 'birth_date': {
            const val = get('empBirthDate').value;
            if (!val) return null; // اختياري
            const birthDate = new Date(val);
            const today = new Date();
            if (birthDate > today) return msgs.birth_date_future;
            const age = today.getFullYear() - birthDate.getFullYear();
            if (age > 100 || age < 15) return msgs.birth_date_unrealistic;
            return null;
        }
        case 'email': {
            const val = get('empEmail').value.trim();
            // البريد مطلوب فقط عند تفعيل إنشاء حساب دخول للموظف؛ غير ذلك فهو اختياري بالكامل
            if (!val) return isAccountCreationEnabled() ? msgs.email_required : null;
            if (!EMAIL_REGEX.test(val)) return msgs.email_invalid;
            return null;
        }
        case 'iban_number': {
            const val = get('empIban').value.trim().toUpperCase();
            if (!val) return null; // اختياري
            if (!IBAN_REGEX.test(val)) return msgs.iban_invalid;
            return null;
        }
        case 'status': {
            const val = get('empStatus').value;
            if (!val) return msgs.status_required;
            return null;
        }
        case 'role': {
            const val = get('empRole').value;
            if (!val) return msgs.role_required;
            return null;
        }
        default:
            return null;
    }
}

function validateFileField(inputId, msgs) {
    const input = document.getElementById(inputId);
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
    const fieldNames = ['name', 'national_id', 'mobile_number', 'birth_date', 'email', 'iban_number', 'status', 'role'];
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

// عرض اسم الملف المختار داخل صندوق الرفع بدل النص الافتراضي
function bindFileNamePreview(inputId, previewId) {
    const input = document.getElementById(inputId);
    const preview = document.getElementById(previewId);
    input.addEventListener('change', () => {
        if (input.files && input.files[0]) {
            // نبني الأيقونة عبر innerHTML (نص ثابت وموثوق من ICONS)، ثم نُلحق اسم
            // الملف كعقدة نصية منفصلة (createTextNode) حتى لا يُفسَّر اسم الملف
            // القادم من المستخدم كـ HTML أبداً (نفس أمان textContent الأصلي).
            preview.innerHTML = ICONS.paperclip + ' ';
            preview.appendChild(document.createTextNode(input.files[0].name));
            preview.classList.add('has-file');
        } else {
            preview.textContent = 'اضغط لاختيار ملف (حد أقصى 5MB)';
            preview.classList.remove('has-file');
        }
    });
}

// =========================================================================
// 3.5 التبديل الحي لواجهة "إنشاء حساب دخول للموظف" (Checkbox)
// =========================================================================
/**
 * يُحدّث حالة الواجهة فور تغيير خيار "إنشاء حساب دخول للموظف":
 * - يُظهر/يُخفي وسم "(اختياري)" بجانب عنوان حقل البريد الإلكتروني.
 * - يُضعّف مظهر حقل الدور/الصلاحية بصرياً عند إلغاء إنشاء الحساب (لأنه غير مستخدم فعلياً بدونه).
 * - يُعيد تقييم رسالة خطأ البريد فوراً حتى تختفي/تظهر دون انتظار فقدان التركيز.
 */
function updateAccountCreationUI() {
    const enabled = isAccountCreationEnabled();

    const emailTag = document.getElementById('emailOptionalTag');
    if (emailTag) emailTag.style.display = enabled ? 'none' : 'inline';

    const roleGroup = document.getElementById('group-role');
    if (roleGroup) roleGroup.style.opacity = enabled ? '1' : '0.5';

    const form = document.getElementById('addEmployeeForm');
    if (form) {
        const msgs = getErrorMessages();
        setFieldError('email', validateField('email', form, msgs));
    }
}

// =========================================================================
// 4. رفع المستندات إلى Supabase Storage
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
            : `تعذّر الوصول لمساحة تخزين الملفات "${EMPLOYEE_DOCS_BUCKET}". على الأغلب الـ Bucket غير موجود بعد بسوبابيس أو سياسات الرفع (RLS) ناقصة.`;
        throw new Error(`تعذّر رفع الملف (${file.name}): ${friendlyMsg}`);
    }

    const { data: publicUrlData } = dbClient.storage
        .from(EMPLOYEE_DOCS_BUCKET)
        .getPublicUrl(filePath);

    return publicUrlData ? publicUrlData.publicUrl : null;
}

// =========================================================================
// 5. ربط الأحداث
// =========================================================================
document.addEventListener('DOMContentLoaded', async function() {
    const allowed = await Permissions.guardPage('employees');
    if (!allowed) return;

    const form = document.getElementById('addEmployeeForm');
    const cancelBtn = document.getElementById('btnCancel');
    const createAccountCheckbox = document.getElementById('empCreateAccount');

    bindFileNamePreview('empCvFile', 'fileNameCv');
    bindFileNamePreview('empIdPhotoFile', 'fileNameIdPhoto');
    bindFileNamePreview('empIbanCertFile', 'fileNameIbanCert');
    bindFileNamePreview('empAddressFile', 'fileNameAddress');

    // تهيئة حالة واجهة "إنشاء حساب دخول للموظف" فور تحميل الصفحة، ثم عند كل تبديل
    if (createAccountCheckbox) {
        updateAccountCreationUI();
        createAccountCheckbox.addEventListener('change', updateAccountCreationUI);
    }

    const blurFieldIdsMap = {
        empName: 'name',
        empId: 'national_id',
        empMobile: 'mobile_number',
        empBirthDate: 'birth_date',
        empEmail: 'email',
        empIban: 'iban_number',
        empStatus: 'status',
        empRole: 'role'
    };

    Object.keys(blurFieldIdsMap).forEach((inputId) => {
        const el = document.getElementById(inputId);
        if (!el) return;
        el.addEventListener('blur', () => {
            const msgs = getErrorMessages();
            const fieldName = blurFieldIdsMap[inputId];
            const localError = validateField(fieldName, form, msgs);
            setFieldError(fieldName, localError);

            // فحص فوري للقائمة السوداء بمجرد اكتمال رقم هوية صحيح الصيغة
            if (inputId === 'empId' && !localError) {
                checkNationalIdAgainstBlacklist(el.value.trim());
            }
        });
        el.addEventListener('change', () => {
            const msgs = getErrorMessages();
            const fieldName = blurFieldIdsMap[inputId];
            setFieldError(fieldName, validateField(fieldName, form, msgs));
        });
    });

    // 🚫 تحقق لحظي من القائمة السوداء (تنبيه مبكر، مستقل عن الفحص النهائي عند الحفظ)
    async function checkNationalIdAgainstBlacklist(nationalIdValue) {
        try {
            const { data: hit } = await dbClient
                .from('employee_blacklist')
                .select('reason')
                .eq('national_id', nationalIdValue)
                .maybeSingle();

            if (hit) {
                setFieldError('national_id', `⚠️ هذا الشخص مُدرج بالقائمة السوداء. السبب: ${hit.reason || 'غير محدد'}`);
            }
        } catch (err) {
            console.error('تعذّر التحقق الفوري من القائمة السوداء:', err.message);
        }
    }

    // 1. زر إلغاء يرجع لصفحة قائمة الموظفين
    cancelBtn.addEventListener('click', function() {
        if (confirm('هل أنت متأكد من إلغاء العملية؟ لن يتم حفظ البيانات.')) {
            window.location.href = Routes.url('employees');
        }
    });

    // 2. حفظ الموظف الجديد
    form.addEventListener('submit', async function(event) {
        event.preventDefault();
        hideFormAlert();

        if (!validateAllFields(form)) {
            showFormAlert('الرجاء تصحيح الحقول المظللة أدناه.', 'error');
            return;
        }

        const createAccount = isAccountCreationEnabled();

        const name = document.getElementById('empName').value.trim();
        const nationalId = document.getElementById('empId').value.trim();
        const mobileNumber = document.getElementById('empMobile').value.trim() || null;
        const birthDate = document.getElementById('empBirthDate').value || null;
        const email = document.getElementById('empEmail').value.trim().toLowerCase() || null;
        // تم حذف حقلي المسمى الوظيفي واسم الشركة من نموذج إضافة الموظف؛ تُحفظ
        // قيمتهما الافتراضية كـ "غير محدد" (المسمى الوظيفي) و null (بدون شركة مرتبطة).
        const jobTitle = 'غير محدد';
        const companyId = null;
        const ibanNumber = document.getElementById('empIban').value.trim().toUpperCase() || null;
        const status = document.getElementById('empStatus').value;
        const role = document.getElementById('empRole').value;
        // كلمة مرور موحّدة لكل الحسابات الجديدة؛ الموظف يُجبر على تغييرها عند أول دخول
        const password = DEFAULT_EMPLOYEE_PASSWORD;

        const submitBtn = form.querySelector('.btn-submit');
        const originalBtnText = submitBtn.textContent;
        submitBtn.disabled = true;

        try {
            // 0. فحص القائمة السوداء أولاً — يمنع إعادة توظيف صاحب رقم الهوية إن كان محظوراً
            submitBtn.textContent = 'جاري التحقق من القائمة السوداء...';
            const { data: blacklistHit, error: blacklistCheckError } = await dbClient
                .from('employee_blacklist')
                .select('reason')
                .eq('national_id', nationalId)
                .maybeSingle();

            if (blacklistCheckError) throw new Error(blacklistCheckError.message);

            if (blacklistHit) {
                const blMsg = `⚠️ رقم الهوية هذا مُدرج بالقائمة السوداء ولا يمكن إضافته كموظف. السبب: ${blacklistHit.reason || 'غير محدد'}`;
                setFieldError('national_id', 'هذا الشخص مُدرج بالقائمة السوداء.');
                showFormAlert(blMsg, 'error');
                return;
            }

            // 1. فحص عدم تكرار رقم الهوية/الإقامة تحديداً في جدول الموظفين
            submitBtn.textContent = 'جاري التحقق من رقم الهوية...';
            const { data: existingByNationalId, error: nationalIdCheckError } = await dbClient
                .from('employees')
                .select('id')
                .eq('national_id', nationalId)
                .maybeSingle();

            if (nationalIdCheckError) throw new Error(nationalIdCheckError.message);

            if (existingByNationalId) {
                const dupMsg = 'رقم الهوية/الإقامة مسجل مسبقاً لموظف آخر.';
                setFieldError('national_id', dupMsg);
                showFormAlert(dupMsg, 'error');
                return;
            }

            // 2. فحص عدم تكرار البريد الإلكتروني (لو تم إدخاله) في جدولي الموظفين والمستخدمين.
            //    جدول users يُفحص فقط لو سيُنشأ حساب دخول فعلياً (بما إنه سيُستخدم لإنشاء
            //    حساب Authentication)؛ بدون إنشاء حساب، يكفي فحص جدول الموظفين فقط.
            if (email) {
                submitBtn.textContent = 'جاري التحقق من البريد الإلكتروني...';
                const duplicateChecks = [
                    dbClient.from('employees').select('id').eq('email', email).maybeSingle()
                ];
                if (createAccount) {
                    duplicateChecks.push(dbClient.from('users').select('id').eq('email', email).maybeSingle());
                }

                const duplicateResults = await Promise.all(duplicateChecks);

                if (duplicateResults[0].error) throw new Error(duplicateResults[0].error.message);
                let isDuplicateEmail = !!duplicateResults[0].data;

                if (createAccount && duplicateResults[1]) {
                    if (duplicateResults[1].error) throw new Error(duplicateResults[1].error.message);
                    isDuplicateEmail = isDuplicateEmail || !!duplicateResults[1].data;
                }

                if (isDuplicateEmail) {
                    const dupMsg = 'هذا البريد الإلكتروني مسجل مسبقاً بالنظام.';
                    setFieldError('email', dupMsg);
                    showFormAlert(dupMsg, 'error');
                    return;
                }
            }

            // 3. رفع المستندات (لو موجودة) إلى Supabase Storage
            submitBtn.textContent = 'جاري رفع المستندات...';
            const employeeFolderKey = nationalId || crypto.randomUUID();

            const [cvUrl, idPhotoUrl, ibanCertUrl, nationalAddressUrl] = await Promise.all([
                uploadEmployeeFile('empCvFile', `${employeeFolderKey}/cv`),
                uploadEmployeeFile('empIdPhotoFile', `${employeeFolderKey}/id`),
                uploadEmployeeFile('empIbanCertFile', `${employeeFolderKey}/iban`),
                uploadEmployeeFile('empAddressFile', `${employeeFolderKey}/address`)
            ]);

            // 4. إنشاء حساب Authentication فعلي للموظف — فقط إن كان خيار "إنشاء حساب
            //    دخول للموظف" مُفعّلاً. غير ذلك، يُحفظ سجل الموظف بدون user_id ودون
            //    إنشاء أي صف بجدول users، ويبقى بإمكان مسؤول النظام تفعيل حساب له لاحقاً.
            let newAuthUserId = null;

            if (createAccount) {
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
                            role: role,
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

                // 5. تأكيد بيانات صف users (الـ trigger أنشأه تلقائياً عند signUp أعلاه)
                //    نستخدم upsert بدل insert لتفادي تعارض المفتاح الأساسي مع الصف
                //    الذي أنشأه الـ trigger تلقائياً، ولضمان اكتمال كل الحقول بدقة.
                submitBtn.textContent = 'جاري حفظ حساب المستخدم...';
                const usersPayload = {
                    id: newAuthUserId,
                    name: name,
                    email: email,
                    role: role,
                    status: status,
                    must_change_password: true
                };

                const { error: userInsertError } = await dbClient
                    .from('users')
                    .upsert([usersPayload], { onConflict: 'id' });

                if (userInsertError) throw new Error(userInsertError.message);
            }

            // 6. حفظ سجل الموظف الكامل، مربوطاً بحساب المستخدم عبر user_id (لو تم إنشاؤه)
            submitBtn.textContent = 'جاري حفظ بيانات الموظف...';
            const payload = {
                user_id: newAuthUserId,
                name,
                national_id: nationalId,
                mobile_number: mobileNumber,
                birth_date: birthDate,
                email,
                job_title: jobTitle,
                company_id: companyId,
                iban_number: ibanNumber,
                status,
                cv_url: cvUrl,
                id_photo_url: idPhotoUrl,
                iban_certificate_url: ibanCertUrl,
                national_address_url: nationalAddressUrl
            };

            const { error: insertError } = await dbClient
                .from('employees')
                .insert([payload]);

            if (insertError) throw new Error(insertError.message);

            const successMsg = createAccount
                ? `تم إضافة الموظف بنجاح! كلمة المرور الافتراضية: ${DEFAULT_EMPLOYEE_PASSWORD} — سيُطلب من الموظف تغييرها عند أول تسجيل دخول.`
                : 'تم إضافة الموظف بنجاح! لم يتم إنشاء حساب دخول له.';

            showFormAlert(successMsg, 'success');

            // 🧹 نبقى بنفس الصفحة بعد الحفظ (بدون تحويل لصفحة أخرى) لتسهيل إضافة
            // موظف آخر مباشرة، مع إعادة تعيين النموذج بالكامل لحالته الافتراضية.
            form.reset();

            // إعادة ضبط معاينات أسماء الملفات المختارة إلى نصها الافتراضي
            ['fileNameCv', 'fileNameIdPhoto', 'fileNameIbanCert', 'fileNameAddress'].forEach((id) => {
                const el = document.getElementById(id);
                if (el) {
                    el.textContent = 'اضغط لاختيار ملف (حد أقصى 5MB)';
                    el.classList.remove('has-file');
                }
            });

            // مسح أي رسائل خطأ متبقية على الحقول (بما فيها حقول الملفات)
            ['name', 'national_id', 'mobile_number', 'birth_date', 'email', 'iban_number', 'status', 'role',
             'cv_file', 'id_photo_file', 'iban_certificate_file', 'national_address_file'].forEach((fieldName) => {
                setFieldError(fieldName, null);
            });

            // إعادة مزامنة واجهة خيار "إنشاء حساب دخول للموظف" مع حالتها الافتراضية بعد reset()
            updateAccountCreationUI();

            // إعادة التركيز لأول حقل بالنموذج لتسهيل إدخال بيانات الموظف التالي مباشرة
            const nameInput = document.getElementById('empName');
            if (nameInput) nameInput.focus();

        } catch (error) {
            console.error('Employee Creation Error (raw):', error);
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