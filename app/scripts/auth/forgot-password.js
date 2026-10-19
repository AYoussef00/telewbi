// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================

// =========================================================================
// صفحة "نسيت كلمة المرور" — تُرسل رابط إعادة تعيين عبر البريد الإلكتروني
// باستخدام dbClient.auth.resetPasswordForEmail()، والذي يحتاج تفعيل قالب
// بريد "Reset Password" بلوحة تحكم سوبابيس (Authentication → Email Templates)
// وإضافة رابط هذا الموقع ضمن Authentication → URL Configuration →
// Redirect URLs (وإلا رفض سوبابيس التوجيه لصفحة reset-password.html).
// =========================================================================
document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('forgotPasswordForm');
    const emailInput = document.getElementById('fpEmail');

    emailInput.addEventListener('input', () => setFieldError('fp_email', null));

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        hideAlert();

        const email = (emailInput.value || '').trim();
        if (!email) {
            setFieldError('fp_email', 'الرجاء إدخال بريدك الإلكتروني.');
            return;
        }
        setFieldError('fp_email', null);

        const submitBtn = form.querySelector('.btn-cp-submit');
        const btnText = document.getElementById('fpBtnText');
        const btnSpinner = document.getElementById('fpSpinner');
        submitBtn.disabled = true;
        btnSpinner.style.display = 'inline-block';
        btnText.textContent = 'جاري الإرسال...';

        try {
            // رابط الصفحة التي سيُعاد توجيه المستخدم إليها من داخل رسالة البريد
            // الإلكتروني لإدخال كلمة مروره الجديدة — يُبنى ديناميكياً من مسار
            // هذه الصفحة نفسها حتى يعمل تلقائياً محلياً وعلى أي نطاق يُنشر
            // عليه المشروع لاحقاً بلا أي تعديل يدوي بالكود.
            const redirectTo = `${window.location.origin}${window.location.pathname.replace('forgot-password.html', 'reset-password.html')}`;

            const { error } = await dbClient.auth.resetPasswordForEmail(email, { redirectTo });

            // ⚠️ لأسباب أمنية (منع اكتشاف أي بريد إلكتروني مسجّل بالنظام من عدمه
            // بمجرد تجربة إرسال طلبات متكررة) نعرض دائماً نفس رسالة "تحقق من
            // بريدك" حتى لو لم يكن هذا البريد مسجّلاً أصلاً بالنظام — إلا في
            // حالة خطأ فعلي بتجاوز حد المحاولات المسموح به
            if (error && (error.message || '').toLowerCase().includes('rate limit')) {
                showAlert('محاولات كثيرة جداً خلال وقت قصير. يرجى الانتظار قليلاً ثم المحاولة مرة أخرى.', 'error');
                return;
            }
            if (error) {
                console.error('Reset Password Request Error:', error.message);
            }

            form.style.display = 'none';
            document.getElementById('fpSentState').style.display = 'block';

        } catch (err) {
            console.error('Unexpected Reset Password Request Error:', err);
            showAlert('فشل إرسال رابط إعادة التعيين بسبب مشكلة في الاتصال بالشبكة. يرجى التحقق من اتصالك بالإنترنت والمحاولة مرة أخرى.', 'error');
        } finally {
            submitBtn.disabled = false;
            btnSpinner.style.display = 'none';
            btnText.textContent = 'إرسال رابط إعادة التعيين';
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
    const alertBox = document.getElementById('fpAlert');
    alertBox.textContent = message;
    alertBox.className = 'form-alert ' + (type === 'success' ? 'alert-success' : 'alert-error');
    alertBox.style.display = 'block';
}

function hideAlert() {
    document.getElementById('fpAlert').style.display = 'none';
}
