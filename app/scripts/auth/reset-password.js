// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================

// =========================================================================
// صفحة "تعيين كلمة مرور جديدة" — الصفحة التي يصل إليها المستخدم بالضغط على
// رابط إعادة التعيين المُرسَل من forgot-password.js. الرابط يحمل رمز تحقق
// مؤقت (#access_token=...&type=recovery) تقرأه مكتبة سوبابيس تلقائياً فور
// تحميل هذه الصفحة (detectSessionInUrl، مفعّلة افتراضياً بالمكتبة) وتُنشئ منه
// جلسة "استرجاع" مؤقتة صالحة فقط لتغيير كلمة المرور — لا نسمح بتفعيل نموذج
// الحفظ إلا بعد تأكيد اكتمال هذا التحقق (حدث PASSWORD_RECOVERY)، تفادياً لأي
// محاولة حفظ قبل أن تصبح الجلسة المؤقتة جاهزة فعلياً.
// =========================================================================
let recoverySessionReady = false;

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('resetPasswordForm');
    const submitBtn = document.getElementById('rpSubmitBtn');
    const subtitle = document.getElementById('rpSubtitle');

    submitBtn.disabled = true;

    dbClient.auth.onAuthStateChange((event) => {
        if (event === 'PASSWORD_RECOVERY') {
            recoverySessionReady = true;
            submitBtn.disabled = false;
            subtitle.textContent = 'أدخل كلمة المرور الجديدة الخاصة بحسابك.';
        }
    });

    // احتياط: لو كانت الجلسة قد أُنشئت بالفعل قبل تسجيل المستمع أعلاه (سباق
    // نادر بين تنفيذ الكود وحدث onAuthStateChange)، أو لو انتهت صلاحية الرابط
    // أو كان تالفاً أصلاً (لا يوجد رمز تحقق بالرابط من الأساس)
    setTimeout(async () => {
        if (recoverySessionReady) return;

        const { data: { session } } = await dbClient.auth.getSession();
        if (session) {
            recoverySessionReady = true;
            submitBtn.disabled = false;
            subtitle.textContent = 'أدخل كلمة المرور الجديدة الخاصة بحسابك.';
        } else {
            subtitle.textContent = 'هذا الرابط غير صالح أو منتهي الصلاحية.';
            showAlert('تعذّر التحقق من رابط إعادة التعيين. الرجاء العودة لصفحة "نسيت كلمة المرور" وطلب رابط جديد.', 'error');
            form.style.display = 'none';
        }
    }, 2500);

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        hideAlert();

        if (!recoverySessionReady) {
            showAlert('لم يكتمل التحقق من رابط إعادة التعيين بعد. الرجاء الانتظار لحظة والمحاولة مرة أخرى.', 'error');
            return;
        }

        const newPassword = document.getElementById('newPassword').value;
        const confirmPassword = document.getElementById('confirmPassword').value;

        let hasError = false;
        if (!newPassword) {
            setFieldError('new_password', 'الرجاء إدخال كلمة المرور الجديدة.');
            hasError = true;
        } else if (newPassword.length < 8) {
            setFieldError('new_password', 'يجب أن تتكون كلمة المرور من 8 أحرف على الأقل.');
            hasError = true;
        } else {
            setFieldError('new_password', null);
        }

        if (!confirmPassword) {
            setFieldError('confirm_password', 'الرجاء تأكيد كلمة المرور.');
            hasError = true;
        } else if (confirmPassword !== newPassword) {
            setFieldError('confirm_password', 'كلمتا المرور غير متطابقتين.');
            hasError = true;
        } else {
            setFieldError('confirm_password', null);
        }

        if (hasError) return;

        const btnText = document.getElementById('rpBtnText');
        const btnSpinner = document.getElementById('rpSpinner');
        submitBtn.disabled = true;
        btnSpinner.style.display = 'inline-block';
        btnText.textContent = 'جاري التحديث...';

        try {
            const { error } = await dbClient.auth.updateUser({ password: newPassword });
            if (error) throw new Error(error.message);

            showAlert('تم تحديث كلمة المرور بنجاح! جاري تحويلك لصفحة تسجيل الدخول...', 'success');
            form.style.display = 'none';

            // 🔒 نُسجّل خروج هذه الجلسة المؤقتة (خاصة بإعادة التعيين فقط) بعد
            // نجاح التحديث، حتى يدخل المستخدم من صفحة الدخول العادية ببياناته الجديدة
            await dbClient.auth.signOut();

            setTimeout(() => {
                window.location.replace(Routes.url('login'));
            }, 1800);

        } catch (error) {
            console.error('Reset Password Error:', error.message);
            showAlert('فشل تحديث كلمة المرور: ' + error.message, 'error');
            btnSpinner.style.display = 'none';
            btnText.textContent = 'تحديث كلمة المرور';
            submitBtn.disabled = false;
        }
    });
});

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

function showAlert(message, type) {
    const alertBox = document.getElementById('rpAlert');
    alertBox.textContent = message;
    alertBox.className = 'form-alert ' + (type === 'success' ? 'alert-success' : 'alert-error');
    alertBox.style.display = 'block';
}

function hideAlert() {
    document.getElementById('rpAlert').style.display = 'none';
}
