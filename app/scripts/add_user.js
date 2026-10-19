// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================

// =========================================================================
// 2. قواعد التحقق (Validation Rules) لكل حقل
// =========================================================================
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SAUDI_PHONE_REGEX = /^(05|5)\d{8}$/; // يقبل 05XXXXXXXX أو 5XXXXXXXX

function getErrorMessages(isEnglish) {
    return {
        name_required: isEnglish ? 'Please enter the full name.' : 'الرجاء إدخال الاسم الكامل.',
        name_short: isEnglish ? 'Name must be at least 3 characters.' : 'يجب أن يتكون الاسم من 3 أحرف على الأقل.',
        email_required: isEnglish ? 'Please enter an email address.' : 'الرجاء إدخال البريد الإلكتروني.',
        email_invalid: isEnglish ? 'Please enter a valid email address.' : 'صيغة البريد الإلكتروني غير صحيحة.',
        phone_invalid: isEnglish ? 'Please enter a valid Saudi mobile number.' : 'رقم الجوال غير صحيح (مثال: 05XXXXXXXX).',
        password_required: isEnglish ? 'Please enter a password.' : 'الرجاء إدخال كلمة المرور.',
        password_short: isEnglish ? 'Password must be at least 8 characters.' : 'يجب أن تتكون كلمة المرور من 8 أحرف على الأقل.',
        password_confirm_required: isEnglish ? 'Please confirm the password.' : 'الرجاء تأكيد كلمة المرور.',
        password_mismatch: isEnglish ? 'Passwords do not match.' : 'كلمتا المرور غير متطابقتين.',
        role_required: isEnglish ? 'Please select a role.' : 'الرجاء اختيار الدور / الصلاحية.',
        status_required: isEnglish ? 'Please select a status.' : 'الرجاء اختيار الحالة.'
    };
}

// دالة تتحقق من حقل واحد بالاسم، وترجع رسالة الخطأ أو null إن كان صحيحاً
function validateField(fieldName, form, msgs) {
    const get = (id) => form.querySelector('#' + id);

    switch (fieldName) {
        case 'name': {
            const val = get('userName').value.trim();
            if (!val) return msgs.name_required;
            if (val.length < 3) return msgs.name_short;
            return null;
        }
        case 'email': {
            const val = get('userEmail').value.trim();
            if (!val) return msgs.email_required;
            if (!EMAIL_REGEX.test(val)) return msgs.email_invalid;
            return null;
        }
        case 'phone': {
            const val = get('userPhone').value.trim();
            if (!val) return null; // اختياري
            if (!SAUDI_PHONE_REGEX.test(val)) return msgs.phone_invalid;
            return null;
        }
        case 'password': {
            const val = get('userPassword').value;
            if (!val) return msgs.password_required;
            if (val.length < 8) return msgs.password_short;
            return null;
        }
        case 'password_confirm': {
            const val = get('userPasswordConfirm').value;
            const pass = get('userPassword').value;
            if (!val) return msgs.password_confirm_required;
            if (val !== pass) return msgs.password_mismatch;
            return null;
        }
        case 'role': {
            const val = get('userRole').value;
            if (!val) return msgs.role_required;
            return null;
        }
        case 'status': {
            const val = get('userStatus').value;
            if (!val) return msgs.status_required;
            return null;
        }
        default:
            return null;
    }
}

// عرض/إخفاء رسالة الخطأ تحت الحقل مباشرة
function setFieldError(fieldName, message) {
    const group = document.getElementById('group-' + fieldName);
    const errorEl = document.getElementById('error-' + fieldName);
    if (!group || !errorEl) return;

    if (message) {
        group.classList.add('has-error');
        group.classList.remove('is-valid');
        errorEl.textContent = message;
    } else {
        group.classList.remove('has-error');
        group.classList.add('is-valid');
        errorEl.textContent = '';
    }
}

// تشغيل التحقق على كل الحقول، وترجع true لو الفورم كامل صحيح
function validateAllFields(form) {
    const isEnglish = document.documentElement.getAttribute('lang') === 'en';
    const msgs = getErrorMessages(isEnglish);
    const fieldNames = ['name', 'email', 'phone', 'password', 'password_confirm', 'role', 'status'];

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

    if (firstInvalidField) {
        const el = document.getElementById('group-' + firstInvalidField).querySelector('input, select');
        if (el) el.focus();
    }

    return isValid;
}

// عرض شريط تنبيه عام أعلى الفورم بدل alert()
function showFormAlert(message, type) {
    const alertBox = document.getElementById('formAlert');
    if (!alertBox) return;
    alertBox.textContent = message;
    alertBox.className = 'form-alert ' + (type === 'success' ? 'alert-success' : 'alert-error');
    alertBox.style.display = 'flex';
    alertBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideFormAlert() {
    const alertBox = document.getElementById('formAlert');
    if (!alertBox) return;
    alertBox.style.display = 'none';
}

// =========================================================================
// 3. ربط الأحداث
// =========================================================================
document.addEventListener('DOMContentLoaded', async function() {
    const allowed = await Permissions.guardPage('users');
    if (!allowed) return;

    const form = document.getElementById('addUserForm');
    const cancelBtn = document.getElementById('btnCancel');

    // التحقق اللحظي أثناء الكتابة/الاختيار (بعد أول محاولة إرسال أو عند مغادرة الحقل)
    const fieldIdsMap = {
        userName: 'name',
        userEmail: 'email',
        userPhone: 'phone',
        userPassword: 'password',
        userPasswordConfirm: 'password_confirm',
        userRole: 'role',
        userStatus: 'status'
    };

    Object.keys(fieldIdsMap).forEach((inputId) => {
        const el = document.getElementById(inputId);
        if (!el) return;
        el.addEventListener('blur', () => {
            const isEnglish = document.documentElement.getAttribute('lang') === 'en';
            const msgs = getErrorMessages(isEnglish);
            const fieldName = fieldIdsMap[inputId];
            const errorMsg = validateField(fieldName, form, msgs);
            setFieldError(fieldName, errorMsg);

            // إعادة فحص تأكيد كلمة المرور لو المستخدم عدّل كلمة المرور الأساسية
            if (fieldName === 'password') {
                const confirmVal = document.getElementById('userPasswordConfirm').value;
                if (confirmVal) {
                    const confirmError = validateField('password_confirm', form, msgs);
                    setFieldError('password_confirm', confirmError);
                }
            }
        });
    });

    // 1. حدث الضغط على زر إلغاء للعودة إلى الصفحة الرئيسية
    cancelBtn.addEventListener('click', function() {
        if (confirm('هل أنت متأكد من إلغاء العملية؟ لن يتم حفظ البيانات.')) {
            window.location.href = Routes.url('dashboard');
        }
    });

    // 2. معالجة إرسال استمارة بيانات المستخدم وفحص صحتها
    form.addEventListener('submit', async function(event) {
        event.preventDefault(); // إيقاف إعادة تحميل الصفحة الإجباري
        hideFormAlert();

        const isEnglish = document.documentElement.getAttribute('lang') === 'en';

        // فحص كل الحقول محلياً أولاً، وإظهار الأخطاء تحت كل حقل
        if (!validateAllFields(form)) {
            showFormAlert(
                isEnglish ? 'Please fix the highlighted fields below.' : 'الرجاء تصحيح الحقول المظللة أدناه.',
                'error'
            );
            return;
        }

        const name = document.getElementById('userName').value.trim();
        const email = document.getElementById('userEmail').value.trim().toLowerCase();
        const phone = document.getElementById('userPhone').value.trim();
        const role = document.getElementById('userRole').value;
        const status = document.getElementById('userStatus').value;
        // ⚠️ كانت قيمة كلمة المرور لا تُقرأ إطلاقاً من حقل userPassword قبل استخدامها
        // بطلب dbClient.auth.signUp() أدناه (password: password) — ما كان يُسبّب
        // خطأ "Can't find variable: password" فور محاولة حفظ أي مستخدم جديد، رغم
        // نجاح كل خطوات التحقق من الحقول بالكامل قبل الوصول لهذه النقطة.
        const password = document.getElementById('userPassword').value;

        const submitBtn = form.querySelector('.btn-submit');
        const originalBtnText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = isEnglish ? 'Saving...' : 'جاري الحفظ...';

        try {
            // فحص عدم تكرار البريد الإلكتروني في جدول المستخدمين (خطأ من السيرفر، يظهر بالشريط العام)
            const { data: existingUser, error: checkError } = await dbClient
                .from('users')
                .select('id')
                .eq('email', email)
                .maybeSingle();

            if (checkError) throw new Error(checkError.message);

            if (existingUser) {
                setFieldError('email', isEnglish ? 'This email is already registered.' : 'هذا البريد الإلكتروني مسجل بالفعل لمستخدم آخر.');
                showFormAlert(
                    isEnglish ? 'This email is already registered.' : 'هذا البريد الإلكتروني مسجل بالفعل لمستخدم آخر.',
                    'error'
                );
                document.getElementById('userEmail').focus();
                return;
            }

            // نحفظ جلسة المسؤول الحالي قبل إنشاء حساب الدخول للمستخدم الجديد،
            // لأن dbClient.auth.signUp() قد يبدّل الجلسة النشطة في المتصفح إلى
            // المستخدم الجديد تلقائياً (لو خيار "Confirm email" غير مفعّل بمشروعك).
            const { data: { session: adminSessionBeforeCreate } } = await dbClient.auth.getSession();

            // إنشاء حساب دخول فعلي للمستخدم في نظام Supabase Authentication
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
                throw new Error(rawMsg && rawMsg !== '{}' ? rawMsg : 'تعذّر إنشاء حساب الدخول عبر Supabase Authentication. تحقق من إعدادات Authentication → Providers → Email بلوحة تحكم سوبابيس.');
            }

            // نعيد جلسة المسؤول فوراً حتى لا يُسجَّل خروجه أثناء إضافة مستخدم جديد
            if (adminSessionBeforeCreate) {
                await dbClient.auth.setSession({
                    access_token: adminSessionBeforeCreate.access_token,
                    refresh_token: adminSessionBeforeCreate.refresh_token
                });
            }

            // نربط سجل جدول users بنفس معرّف حساب Authentication (id واحد للاثنين)
            const newAuthUserId = (authData && authData.user) ? authData.user.id : crypto.randomUUID();

            const payload = {
                id: newAuthUserId,
                name: name,
                email: email,
                phone: phone || null,
                role: role,
                status: status,
                must_change_password: true
            };

            // upsert بدل insert: الـ trigger (handle_new_user) أنشأ الصف تلقائياً
            // أثناء signUp أعلاه، فنكمل عليه بدل ما نتعارض معه بمفتاح مكرر.
            const { error: insertError } = await dbClient
                .from('users')
                .upsert([payload], { onConflict: 'id' });

            if (insertError) throw new Error(insertError.message);

            showFormAlert(isEnglish ? 'User added successfully! Redirecting...' : 'تم إضافة المستخدم بنجاح، جاري التحويل...', 'success');
            setTimeout(() => {
                window.location.href = Routes.url('dashboard');
            }, 1200);

        } catch (error) {
            console.error('User Creation Error:', error.message);
            showFormAlert((isEnglish ? 'Operation failed: ' : 'فشلت العملية: ') + error.message, 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = originalBtnText;
        }
    });
});