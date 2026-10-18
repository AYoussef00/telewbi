// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================
const SUPABASE_URL = "https://mcdhxdfkuokhmhtfvjev.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_yt9V8lsNU1zN3Ix2CvovbQ_QCA2VDdM";
const dbClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

document.addEventListener('DOMContentLoaded', async () => {
    // لازم يكون فيه جلسة نشطة أصلاً (المستخدم جاي من صفحة تسجيل الدخول)
    const { data: { session } } = await dbClient.auth.getSession();
    if (!session) {
        window.location.replace('login.html');
        return;
    }

    const form = document.getElementById('changePasswordForm');
    const logoutBtn = document.getElementById('btnCpLogout');

    logoutBtn.addEventListener('click', async () => {
        await dbClient.auth.signOut();
        window.location.replace('login.html');
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        hideAlert();

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

        const submitBtn = form.querySelector('.btn-cp-submit');
        const btnText = document.getElementById('cpBtnText');
        const btnSpinner = document.getElementById('cpSpinner');
        submitBtn.disabled = true;
        btnSpinner.style.display = 'inline-block';
        btnText.textContent = 'جاري التحديث...';

        try {
            const { error: updateAuthError } = await dbClient.auth.updateUser({ password: newPassword });
            if (updateAuthError) throw new Error(updateAuthError.message);

            // ⚠️ التحقق الفعلي من نجاح تحديث العلمة must_change_password عبر .select() —
            // نفس نمط الخلل المتكرر بهذه الجلسة: سوبابيس لا يُرجع خطأً عند حظر التحديث
            // بسبب غياب سياسة تحديث (RLS UPDATE Policy)، بل "ينجح" الطلب ظاهرياً بدون أي
            // تأثير فعلي على الصف. لو حدث هذا هنا تحديداً، تبقى العلمة true للأبد فتُطالَب
            // بتغيير كلمة المرور من جديد في كل تسجيل دخول لاحق رغم تغييرها فعلياً.
            const { data: updatedRows, error: updateFlagError } = await dbClient
                .from('users')
                .update({ must_change_password: false })
                .eq('id', session.user.id)
                .select();

            if (updateFlagError) throw new Error(updateFlagError.message);

            if (!updatedRows || updatedRows.length === 0) {
                showAlert('تم تحديث كلمة المرور نفسها بنجاح، لكن تعذّر إلغاء علامة "يجب تغيير كلمة المرور" فعلياً. غالباً السبب عدم وجود سياسة تحديث (RLS UPDATE Policy) تسمح للمستخدم بتعديل صفه الخاص بجدول users — ستستمر مطالبتك بتغيير كلمة المرور عند كل تسجيل دخول حتى تُضاف هذه السياسة.', 'error');
                return;
            }

            showAlert('تم تحديث كلمة المرور بنجاح! جاري التحويل إلى لوحة التحكم...', 'success');
            setTimeout(() => {
                window.location.replace('dashboard.html');
            }, 1000);

        } catch (error) {
            console.error('Change Password Error:', error.message);
            showAlert('فشل تحديث كلمة المرور: ' + error.message, 'error');
        } finally {
            submitBtn.disabled = false;
            btnSpinner.style.display = 'none';
            btnText.textContent = 'تحديث كلمة المرور والمتابعة';
        }
    });
});

function setFieldError(fieldName, message) {
    const group = document.getElementById('group-' + fieldName);
    const errorEl = document.getElementById('error-' + fieldName);
    if (message) {
        group.classList.add('has-error');
        errorEl.textContent = message;
    } else {
        group.classList.remove('has-error');
        errorEl.textContent = '';
    }
}

function showAlert(message, type) {
    const alertBox = document.getElementById('cpAlert');
    alertBox.textContent = message;
    alertBox.className = 'form-alert ' + (type === 'success' ? 'alert-success' : 'alert-error');
    alertBox.style.display = 'block';
}

function hideAlert() {
    document.getElementById('cpAlert').style.display = 'none';
}