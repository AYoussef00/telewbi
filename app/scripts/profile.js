// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================

const ROLE_LABELS_AR = {
    super_admin: 'مدير عام النظام',
    admin: 'مسؤول',
    company: 'مسؤول شركة',
    employee: 'موظف'
};

let currentUserId = null;
let currentUserAuthEmail = null;

// 🐛 إصلاح: هذه الصفحة تستخدم حاوية ".page-container" (المخفية افتراضياً
// بـ visibility:hidden عبر global-layout.css إلى أن يُظهرها permissions.js
// صراحةً — انظر شرح الآلية الكامل بتعليق global-layout.css) لكنها لم تكن
// تُحمِّل permissions.js إطلاقاً ولا تستدعي guardPage()/revealGuardedPageContent()
// — فكانت شبكة الأمان الاحتياطية (مهلة 6 ثوانٍ، المُعرَّفة داخل permissions.js
// نفسه) لا تُسجَّل أصلاً بغياب الملف، ويبقى محتوى الصفحة بالكامل مخفياً للأبد
// (تظهر فقط القائمة الجانبية وشريط التنقل، بلا أي محتوى) — تماماً ما لاحظه
// المستخدم: "الملف الشخصي لا يعمل". الحل: تحميل permissions.js، واستدعاء
// guardPage('dashboard') فور بدء الصفحة — قسم "dashboard" مُستثنى دائماً من
// نظام التقييد (انظر permissions.js) فيسمح فوراً لأي مستخدم مسجّل دخول بغض
// النظر عن دوره، ويُظهر المحتوى فور اكتمال التحقق بدل انتظار مهلة الـ6 ثوانٍ.
document.addEventListener('DOMContentLoaded', async () => {
    const allowed = await Permissions.guardPage('dashboard');
    if (!allowed) return;

    await loadCurrentUserProfile();

    document.getElementById('profileForm').addEventListener('submit', handleProfileSave);

    ['profileName', 'profilePhone'].forEach(id => {
        document.getElementById(id).addEventListener('blur', () => validateProfileField(id));
    });
});

// 📥 جلب بيانات المستخدم الحالي وعرضها
async function loadCurrentUserProfile() {
    try {
        const { data: { session } } = await dbClient.auth.getSession();
        // 🛡️ حالة "لا توجد جلسة" أصبحت مُغطّاة مركزياً الآن عبر permissions.js
        // (initPermissions يُحوِّل تلقائياً لصفحة index.html فور اكتشاف غياب
        // الجلسة — نفس الفحص الذي مرّ به Permissions.guardPage أعلاه بالفعل)،
        // فلا داعي لتكرار تحويل مستقل هنا قد يتسابق مع ذلك التحويل المركزي.
        // نكتفي بإيقاف هادئ لتفادي أي خطأ لاحق عند الوصول لبيانات جلسة غير موجودة.
        if (!session) return;

        currentUserId = session.user.id;
        currentUserAuthEmail = session.user.email;

        const { data: profileRow, error } = await dbClient
            .from('users')
            .select('name, email, phone, role, status, created_at')
            .eq('id', currentUserId)
            .maybeSingle();

        if (error) throw new Error(error.message);

        const name = (profileRow && profileRow.name) || session.user.email;
        const email = (profileRow && profileRow.email) || session.user.email;
        const phone = (profileRow && profileRow.phone) || '';
        const role = profileRow && profileRow.role;
        const status = (profileRow && profileRow.status) || 'active';
        const createdAt = profileRow && profileRow.created_at;

        const initial = (name || '?').trim().charAt(0).toUpperCase();

        document.getElementById('profileAvatar').textContent = initial;
        document.getElementById('profileHeroName').textContent = name;
        document.getElementById('profileHeroEmail').textContent = email;
        document.getElementById('profileRoleBadge').textContent = ROLE_LABELS_AR[role] || 'غير محدد';

        const statusBadge = document.getElementById('profileStatusBadge');
        statusBadge.textContent = status === 'active' ? 'نشط' : 'غير نشط';
        statusBadge.classList.add(status === 'active' ? 'status-active' : 'status-inactive');

        document.getElementById('profileName').value = name;
        document.getElementById('profilePhone').value = phone;
        document.getElementById('profileEmail').value = email;

        document.getElementById('profileCreatedAt').textContent = createdAt
            ? new Date(createdAt).toLocaleDateString('ar-SA')
            : '—';

    } catch (error) {
        console.error('تعذّر تحميل بيانات الملف الشخصي:', error.message);
        showProfileAlert('تعذّر تحميل بيانات الملف الشخصي: ' + error.message, 'error');
    }
}

// ✅ تحقق مبسّط من الاسم/الجوال
const SAUDI_PHONE_REGEX = /^(05|5)\d{8}$/;

function validateProfileField(inputId) {
    if (inputId === 'profileName') {
        const val = document.getElementById('profileName').value.trim();
        const msg = !val ? 'الرجاء إدخال الاسم الكامل.' : (val.length < 3 ? 'يجب أن يتكون الاسم من 3 أحرف على الأقل.' : null);
        setFieldError('name', msg);
        return !msg;
    }
    if (inputId === 'profilePhone') {
        const val = document.getElementById('profilePhone').value.trim();
        const msg = (val && !SAUDI_PHONE_REGEX.test(val)) ? 'رقم الجوال غير صحيح (مثال: 05XXXXXXXX).' : null;
        setFieldError('phone', msg);
        return !msg;
    }
    return true;
}

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

function showProfileAlert(message, type) {
    const alertBox = document.getElementById('profileFormAlert');
    alertBox.textContent = message;
    alertBox.className = 'form-alert ' + (type === 'success' ? 'alert-success' : 'alert-error');
    alertBox.style.display = 'flex';
}

function hideProfileAlert() {
    document.getElementById('profileFormAlert').style.display = 'none';
}

// 💾 حفظ التعديلات (الاسم/الجوال) بجدول users
async function handleProfileSave(event) {
    event.preventDefault();
    hideProfileAlert();

    const nameValid = validateProfileField('profileName');
    const phoneValid = validateProfileField('profilePhone');
    if (!nameValid || !phoneValid) {
        showProfileAlert('الرجاء تصحيح الحقول المظللة أدناه.', 'error');
        return;
    }

    const name = document.getElementById('profileName').value.trim();
    const phone = document.getElementById('profilePhone').value.trim() || null;

    const saveBtn = document.getElementById('btnSaveProfile');
    const originalText = saveBtn.textContent;
    saveBtn.disabled = true;
    saveBtn.textContent = 'جاري الحفظ...';

    try {
        // نحاول التحديث أولاً — لو ما فيه صف أصلاً بجدول users لهذا المستخدم
        // (مثلاً حساب أُنشئ يدوياً من Authentication مباشرة بدون صف مرتبط)،
        // ننشئه الآن ونربطه بنفس معرّف حساب Authentication الحالي.
        const { data: updatedRows, error: updateError } = await dbClient
            .from('users')
            .update({ name, phone })
            .eq('id', currentUserId)
            .select('id');

        if (updateError) throw new Error(updateError.message);

        if (!updatedRows || updatedRows.length === 0) {
            // لا يوجد صف مسبق لهذا المستخدم بجدول users → ننشئه الآن مربوطاً بـ Authentication
            const { error: insertError } = await dbClient
                .from('users')
                .insert([{
                    id: currentUserId, // نفس معرّف حساب Authentication (auth.uid())
                    name,
                    phone,
                    email: currentUserAuthEmail,
                    role: 'employee',
                    status: 'active',
                    must_change_password: false
                }]);

            if (insertError) throw new Error(insertError.message);
        }

        document.getElementById('profileHeroName').textContent = name;
        document.getElementById('profileAvatar').textContent = name.trim().charAt(0).toUpperCase();

        showProfileAlert('تم حفظ التغييرات بنجاح.', 'success');

    } catch (error) {
        console.error('فشل حفظ الملف الشخصي:', error.message);
        showProfileAlert('فشل الحفظ: ' + error.message, 'error');
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = originalText;
    }
}