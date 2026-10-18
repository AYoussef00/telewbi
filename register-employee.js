// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================
const SUPABASE_URL = "https://mcdhxdfkuokhmhtfvjev.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_yt9V8lsNU1zN3Ix2CvovbQ_QCA2VDdM";
const dbClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const EMPLOYEE_DOCS_BUCKET = "employee-documents";
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const MOBILE_REGEX = /^5\d{8}$/; // بعد إزالة مقدمة +966: يبدأ بـ5 ويتكون من 9 أرقام
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// =========================================================================
// 2. رسائل الأخطاء
// =========================================================================
function getErrorMessages() {
    return {
        name_required: 'الرجاء إدخال الاسم الكامل.',
        name_parts: 'الرجاء إدخال الاسم رباعياً (4 أسماء على الأقل مفصولة بمسافات).',
        national_id_required: 'الرجاء إدخال رقم الهوية أو الإقامة.',
        national_id_invalid: 'يجب أن يتكون رقم الهوية/الإقامة من 10 أرقام بالضبط.',
        mobile_required: 'الرجاء إدخال رقم الجوال.',
        mobile_invalid: 'رقم الجوال يجب أن يتكون من 9 أرقام ويبدأ بـ5، مثال: 512345678.',
        email_required: 'الرجاء إدخال البريد الإلكتروني.',
        email_invalid: 'صيغة البريد الإلكتروني غير صحيحة.',
        password_required: 'الرجاء إدخال كلمة المرور.',
        password_short: 'يجب أن تتكون كلمة المرور من 8 أحرف على الأقل.',
        confirm_password_required: 'الرجاء تأكيد كلمة المرور.',
        confirm_password_mismatch: 'كلمتا المرور غير متطابقتين.',
        file_required: 'هذا المستند إلزامي، الرجاء إرفاقه.',
        file_too_large: 'حجم الملف أكبر من الحد المسموح (5MB).'
    };
}

// =========================================================================
// 3. أدوات مساعدة عامة (تنبيهات / أخطاء حقول)
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
    if (alertBox) alertBox.style.display = 'none';
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

// عرض اسم الملف المختار داخل صندوق الرفع بدل النص الافتراضي
function bindFileNamePreview(inputId, previewId) {
    const input = document.getElementById(inputId);
    const preview = document.getElementById(previewId);
    if (!input || !preview) return;
    input.addEventListener('change', () => {
        if (input.files && input.files[0]) {
            preview.innerHTML = (window.ICONS ? ICONS.paperclip : '📎') + ' ';
            preview.appendChild(document.createTextNode(input.files[0].name));
            preview.classList.add('has-file');
        } else {
            preview.textContent = 'اضغط لاختيار ملف (حد أقصى 5MB)';
            preview.classList.remove('has-file');
        }
    });
}

function togglePasswordView(inputId, eyeIconId) {
    const input = document.getElementById(inputId);
    const eyeIcon = document.getElementById(eyeIconId);
    if (!input) return;
    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    if (eyeIcon) {
        eyeIcon.innerHTML = isHidden
            ? `<path stroke-linecap="round" stroke-linejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />`
            : `<path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />`;
    }
}

// =========================================================================
// 4. التحقق من الحقول
// =========================================================================
function countNameParts(fullName) {
    return (fullName || '').trim().split(/\s+/).filter(Boolean).length;
}

function validateField(fieldName, msgs) {
    switch (fieldName) {
        case 'name': {
            const val = document.getElementById('regName').value.trim();
            if (!val) return msgs.name_required;
            if (countNameParts(val) < 4) return msgs.name_parts;
            return null;
        }
        case 'national_id': {
            const val = document.getElementById('regNationalId').value.trim();
            if (!val) return msgs.national_id_required;
            if (val.length !== 10 || isNaN(val)) return msgs.national_id_invalid;
            return null;
        }
        case 'mobile_number': {
            const val = document.getElementById('regMobile').value.trim();
            if (!val) return msgs.mobile_required;
            if (!MOBILE_REGEX.test(val)) return msgs.mobile_invalid;
            return null;
        }
        case 'email': {
            const val = document.getElementById('regEmail').value.trim();
            if (!val) return msgs.email_required;
            if (!EMAIL_REGEX.test(val)) return msgs.email_invalid;
            return null;
        }
        case 'password': {
            const val = document.getElementById('regPassword').value;
            if (!val) return msgs.password_required;
            if (val.length < 8) return msgs.password_short;
            return null;
        }
        case 'confirm_password': {
            const val = document.getElementById('regConfirmPassword').value;
            const original = document.getElementById('regPassword').value;
            if (!val) return msgs.confirm_password_required;
            if (val !== original) return msgs.confirm_password_mismatch;
            return null;
        }
        default:
            return null;
    }
}

// جميع المستندات إلزامية الآن — لا بد من وجود ملف مختار قبل السماح بالإرسال
function validateFileField(inputId, msgs) {
    const input = document.getElementById(inputId);
    const file = input.files && input.files[0];
    if (!file) return msgs.file_required;
    if (file.size > MAX_FILE_SIZE_BYTES) return msgs.file_too_large;
    return null;
}

function validateAllFields() {
    const msgs = getErrorMessages();
    const fieldNames = ['name', 'national_id', 'mobile_number', 'email', 'password', 'confirm_password'];
    const fileFieldMap = {
        id_photo_file: 'regIdPhotoFile',
        national_address_file: 'regAddressFile',
        iban_certificate_file: 'regIbanCertFile',
        cv_file: 'regCvFile',
        education_qualification_file: 'regEducationFile',
        cr_status_file: 'regCrStatusFile',
        mudad_wage_certificate_file: 'regMudadFile',
        qiwa_contracts_file: 'regQiwaFile'
    };

    let isValid = true;
    let firstInvalidField = null;

    fieldNames.forEach((fieldName) => {
        const errorMsg = validateField(fieldName, msgs);
        setFieldError(fieldName, errorMsg);
        if (errorMsg) { isValid = false; if (!firstInvalidField) firstInvalidField = fieldName; }
    });

    Object.keys(fileFieldMap).forEach((fieldName) => {
        const errorMsg = validateFileField(fileFieldMap[fieldName], msgs);
        setFieldError(fieldName, errorMsg);
        if (errorMsg) { isValid = false; if (!firstInvalidField) firstInvalidField = fieldName; }
    });

    if (firstInvalidField) {
        const group = document.getElementById('group-' + firstInvalidField);
        const el = group ? group.querySelector('input') : null;
        if (el) el.focus();
    }

    return isValid;
}

// =========================================================================
// 6. رفع مستند إلى Supabase Storage (بعد إنشاء حساب الموظف والدخول به)
// =========================================================================
async function uploadRegisterFile(inputId, folderName) {
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
        throw new Error(`تعذّر رفع الملف (${file.name}): ${rawMsg || 'خطأ غير معروف'}`);
    }

    const { data: publicUrlData } = dbClient.storage.from(EMPLOYEE_DOCS_BUCKET).getPublicUrl(filePath);
    return publicUrlData ? publicUrlData.publicUrl : null;
}

// =========================================================================
// 7. ترجمة أخطاء التسجيل الخام القادمة من سوبابيس إلى رسائل عربية واضحة
// =========================================================================
function getFriendlySignupErrorMessage(rawMessage) {
    const msg = (rawMessage || '').toLowerCase();
    if (msg.includes('already registered') || msg.includes('already exists') || msg.includes('duplicate')) {
        return 'هذا البريد الإلكتروني مسجّل بالفعل بالنظام. إن كان لديك حساب، يمكنك تسجيل الدخول مباشرة، وإلا استخدم بريداً إلكترونياً آخر.';
    }
    if (msg.includes('password') && (msg.includes('weak') || msg.includes('short') || msg.includes('at least'))) {
        return 'كلمة المرور ضعيفة جداً. الرجاء اختيار كلمة مرور أقوى (8 أحرف على الأقل).';
    }
    if (msg.includes('fetch') || msg.includes('network') || msg.includes('load failed') || msg.includes('err_')) {
        return 'تعذّر الاتصال بالخادم. يرجى التحقق من اتصال الإنترنت والمحاولة مرة أخرى.';
    }
    if (msg.includes('rate limit') || msg.includes('too many requests')) {
        return 'محاولات كثيرة خلال وقت قصير. يرجى الانتظار قليلاً ثم المحاولة مرة أخرى.';
    }
    return rawMessage || 'حدث خطأ غير متوقع.';
}

// =========================================================================
// 8. التحقق من توفر ميزة التسجيل الذاتي (يُتحكم بها من لوحة تحكم الإدارة)
// =========================================================================
async function checkSelfRegistrationEnabled() {
    try {
        const { data, error } = await dbClient
            .from('app_settings')
            .select('value')
            .eq('key', 'employee_self_registration_enabled')
            .maybeSingle();

        if (error) throw new Error(error.message);

        // لو لم يوجد الصف بعد لأي سبب (مثلاً قبل تنفيذ سكربت الإعداد)، نُبقي
        // الميزة متاحة افتراضياً بدل حجبها بالخطأ عن الجميع بصمت
        if (!data) return true;
        return data.value === true || data.value === 'true';
    } catch (error) {
        console.error('تعذّر التحقق من حالة ميزة إنشاء الحساب الذاتي:', error.message);
        return true;
    }
}

// =========================================================================
// 9. ربط الأحداث وحفظ طلب التسجيل
// =========================================================================
document.addEventListener('DOMContentLoaded', async () => {
    const isEnabled = await checkSelfRegistrationEnabled();
    if (!isEnabled) {
        document.getElementById('registerEmployeeForm').style.display = 'none';
        document.getElementById('featureDisabledScreen').style.display = 'block';
        return;
    }

    bindFileNamePreview('regIdPhotoFile', 'fileNameIdPhoto');
    bindFileNamePreview('regAddressFile', 'fileNameAddress');
    bindFileNamePreview('regIbanCertFile', 'fileNameIbanCert');
    bindFileNamePreview('regCvFile', 'fileNameCv');
    bindFileNamePreview('regEducationFile', 'fileNameEducation');
    bindFileNamePreview('regCrStatusFile', 'fileNameCrStatus');
    bindFileNamePreview('regMudadFile', 'fileNameMudad');
    bindFileNamePreview('regQiwaFile', 'fileNameQiwa');

    document.getElementById('toggleRegPassword').addEventListener('click', () => togglePasswordView('regPassword', 'regEyeIcon'));
    document.getElementById('toggleRegConfirmPassword').addEventListener('click', () => togglePasswordView('regConfirmPassword', 'regConfirmEyeIcon'));

    // رقم الجوال: أرقام فقط أثناء الكتابة
    const mobileInput = document.getElementById('regMobile');
    mobileInput.addEventListener('input', () => {
        mobileInput.value = mobileInput.value.replace(/\D/g, '').slice(0, 9);
    });

    const blurFieldIdsMap = {
        regName: 'name', regNationalId: 'national_id', regMobile: 'mobile_number',
        regEmail: 'email', regPassword: 'password', regConfirmPassword: 'confirm_password'
    };
    Object.keys(blurFieldIdsMap).forEach((inputId) => {
        const el = document.getElementById(inputId);
        if (!el) return;
        el.addEventListener('blur', () => {
            const msgs = getErrorMessages();
            setFieldError(blurFieldIdsMap[inputId], validateField(blurFieldIdsMap[inputId], msgs));
        });
    });
    // إعادة تقييم تطابق كلمتي المرور فور تعديل كلمة المرور الأصلية
    document.getElementById('regPassword').addEventListener('input', () => {
        if (document.getElementById('regConfirmPassword').value) {
            const msgs = getErrorMessages();
            setFieldError('confirm_password', validateField('confirm_password', msgs));
        }
    });

    const form = document.getElementById('registerEmployeeForm');
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        hideFormAlert();

        if (!validateAllFields()) {
            showFormAlert('الرجاء تصحيح الحقول المظللة أدناه.', 'error');
            return;
        }

        const name = document.getElementById('regName').value.trim();
        const nationalId = document.getElementById('regNationalId').value.trim();
        const mobileLocal = '0' + document.getElementById('regMobile').value.trim(); // 05XXXXXXXX (نفس صيغة باقي النظام)
        const email = document.getElementById('regEmail').value.trim().toLowerCase();
        const password = document.getElementById('regPassword').value;

        const submitBtn = document.getElementById('btnRegisterSubmit');
        const btnText = document.getElementById('registerBtnText');
        const btnSpinner = document.getElementById('registerBtnSpinner');
        submitBtn.disabled = true;
        btnSpinner.style.display = 'inline-block';

        try {
            // 1) فحص أهلية التسجيل: تكرار رقم الهوية + القائمة السوداء
            btnText.textContent = 'جاري التحقق من البيانات...';
            const { data: eligibility, error: eligibilityError } = await dbClient
                .rpc('check_employee_signup_eligibility', { p_national_id: nationalId });

            if (eligibilityError) throw new Error(eligibilityError.message);

            if (eligibility && eligibility.is_blacklisted) {
                const blMsg = `⚠️ لا يمكن إكمال هذا الطلب. السبب: ${eligibility.blacklist_reason || 'غير محدد'}`;
                setFieldError('national_id', 'هذا الرقم مُدرج بالقائمة السوداء.');
                showFormAlert(blMsg, 'error');
                return;
            }
            if (eligibility && eligibility.is_duplicate) {
                const dupMsg = 'رقم الهوية/الإقامة مسجَّل مسبقاً كموظف، أو لديه طلب تسجيل قيد المراجعة بالفعل.';
                setFieldError('national_id', dupMsg);
                showFormAlert(dupMsg, 'error');
                return;
            }

            // 2) إنشاء حساب Authentication
            btnText.textContent = 'جاري إنشاء الحساب...';
            const { data: authData, error: authError } = await dbClient.auth.signUp({
                email, password,
                options: { data: { name, role: 'employee', must_change_password: false } }
            });

            if (authError) throw new Error(getFriendlySignupErrorMessage(authError.message));
            if (!authData || !authData.user) throw new Error('تعذّر إنشاء الحساب لسبب غير معروف. حاول مرة أخرى.');

            const newUserId = authData.user.id;

            // 3) تأكيد صف users (يشمل status='pending_review' — أهم علامة تمنع
            //    الدخول حتى تُوافق الإدارة على الطلب)
            const { error: userUpsertError } = await dbClient.from('users').upsert([{
                id: newUserId, name, email, role: 'employee', status: 'pending_review', must_change_password: false
            }], { onConflict: 'id' });
            if (userUpsertError) throw new Error(userUpsertError.message);

            // 4) رفع المستندات (إلزامية جميعها) — الآن بعد أن أصبح المستخدم موثّقاً
            btnText.textContent = 'جاري رفع المرفقات...';
            const folderKey = nationalId || crypto.randomUUID();
            const [idPhotoUrl, addressUrl, ibanCertUrl, cvUrl, educationUrl, crStatusUrl, mudadUrl, qiwaContractsUrl] = await Promise.all([
                uploadRegisterFile('regIdPhotoFile', `${folderKey}/id`),
                uploadRegisterFile('regAddressFile', `${folderKey}/address`),
                uploadRegisterFile('regIbanCertFile', `${folderKey}/iban`),
                uploadRegisterFile('regCvFile', `${folderKey}/cv`),
                uploadRegisterFile('regEducationFile', `${folderKey}/education`),
                uploadRegisterFile('regCrStatusFile', `${folderKey}/cr_status`),
                uploadRegisterFile('regMudadFile', `${folderKey}/mudad`),
                uploadRegisterFile('regQiwaFile', `${folderKey}/qiwa_contracts`)
            ]);

            // 5) إنشاء سجل الموظف (بحالة "غير نشط" حتى تُربط بياناته فعلياً
            //    بشركة عبر "ربط الموظفين" بعد موافقة الإدارة على الطلب)
            btnText.textContent = 'جاري حفظ بيانات الموظف...';
            const { data: newEmployeeRows, error: employeeInsertError } = await dbClient.from('employees').insert([{
                user_id: newUserId,
                name,
                national_id: nationalId,
                mobile_number: mobileLocal,
                email,
                job_title: 'غير محدد',
                company_id: null,
                status: 'inactive',
                cv_url: cvUrl,
                id_photo_url: idPhotoUrl,
                iban_certificate_url: ibanCertUrl,
                national_address_url: addressUrl,
                education_qualification_url: educationUrl,
                cr_status_url: crStatusUrl,
                mudad_wage_certificate_url: mudadUrl,
                qiwa_contracts_url: qiwaContractsUrl
            }]).select('id');

            if (employeeInsertError) throw new Error(employeeInsertError.message);
            const newEmployeeId = (newEmployeeRows && newEmployeeRows[0]) ? newEmployeeRows[0].id : null;

            // 6) إنشاء طلب التسجيل نفسه (يحمل كل المستندات الإلزامية، لمراجعة الإدارة)
            const { error: requestInsertError } = await dbClient.from('employee_signup_requests').insert([{
                user_id: newUserId,
                employee_id: newEmployeeId,
                name,
                national_id: nationalId,
                mobile_number: mobileLocal,
                email,
                id_photo_url: idPhotoUrl,
                national_address_url: addressUrl,
                iban_certificate_url: ibanCertUrl,
                cv_url: cvUrl,
                education_qualification_url: educationUrl,
                cr_status_url: crStatusUrl,
                mudad_wage_certificate_url: mudadUrl,
                qiwa_contracts_url: qiwaContractsUrl,
                status: 'pending'
            }]);

            if (requestInsertError) throw new Error(requestInsertError.message);

            // 7) تسجيل خروج فوري — لا يجب أن يبقى الحساب مسجَّلاً دخوله هنا؛
            //    الدخول الفعلي يجب أن يمر حصراً عبر شاشة "دخول الموظفين" بعد الموافقة
            await dbClient.auth.signOut();

            form.style.display = 'none';
            document.getElementById('successScreen').style.display = 'block';

        } catch (error) {
            console.error('Employee Self-Registration Error:', error);
            const rawMsg = error && error.message;
            showFormAlert('فشلت عملية إرسال الطلب: ' + (rawMsg || 'خطأ غير متوقع.'), 'error');
        } finally {
            submitBtn.disabled = false;
            btnSpinner.style.display = 'none';
            btnText.textContent = 'إرسال طلب إنشاء الحساب';
        }
    });
});