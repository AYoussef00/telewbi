// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================

const SETTINGS_ROLE_LABELS_AR = {
    super_admin: 'مدير عام النظام',
    admin: 'مسؤول',
    company: 'مسؤول شركة',
    employee: 'موظف'
};

// 🐛 إصلاح: هذه الصفحة تستخدم حاوية ".page-container" (مخفية افتراضياً إلى أن
// يُظهرها permissions.js — انظر الشرح الكامل بتعليق global-layout.css) لكنها
// لم تكن تُحمِّل permissions.js إطلاقاً، فيبقى محتواها مخفياً للأبد (لا تُسجَّل
// حتى شبكة الأمان الاحتياطية بمهلة الـ6 ثوانٍ لغياب الملف نفسه) — بالضبط
// مشكلة "الإعدادات لا تعمل" التي أبلغ عنها المستخدم. الحل: تحميل permissions.js
// واستدعاء guardPage('dashboard') فور بدء الصفحة (قسم مُستثنى دائماً من نظام
// التقييد، فيسمح فوراً لأي مستخدم مسجّل دخول ويُظهر المحتوى بلا انتظار).
document.addEventListener('DOMContentLoaded', async () => {
    const allowed = await Permissions.guardPage('dashboard');
    if (!allowed) return;

    await loadAccountSummary();
    setupLanguageSegmentedControl();
});

// 📥 جلب ملخص بيانات الحساب الحالي (اسم/بريد/دور) للعرض القرائي فقط
async function loadAccountSummary() {
    try {
        const { data: { session } } = await dbClient.auth.getSession();
        // 🛡️ حالة "لا توجد جلسة" أصبحت مُغطّاة مركزياً الآن عبر permissions.js
        // (نفس الفحص الذي مرّ به Permissions.guardPage أعلاه بالفعل، ويُحوِّل
        // تلقائياً لصفحة index.html) — نكتفي هنا بإيقاف هادئ بلا تحويل مستقل
        // قد يتسابق مع ذلك التحويل المركزي.
        if (!session) return;

        const { data: profileRow } = await dbClient
            .from('users')
            .select('name, email, role')
            .eq('id', session.user.id)
            .maybeSingle();

        const name = (profileRow && profileRow.name) || session.user.email;
        const email = (profileRow && profileRow.email) || session.user.email;
        const role = profileRow && profileRow.role;

        document.getElementById('settingsAccountName').textContent = name;
        document.getElementById('settingsAccountEmail').textContent = email;
        document.getElementById('settingsAccountRole').textContent = SETTINGS_ROLE_LABELS_AR[role] || 'غير محدد';

    } catch (error) {
        console.error('تعذّر تحميل ملخص بيانات الحساب:', error.message);
    }
}

// =========================================================================
// 2. مفتاح اللغة المقسّم (Segmented Control) — يعتمد على محرك الترجمة
//    الموجود أصلاً بـ app-core.js (المتغيّرات currentLanguage/loadTranslations
//    عامة النطاق لأن كلا الملفين يُحمّلان كسكربتات classic عادية)
// =========================================================================
function setupLanguageSegmentedControl() {
    const btnAr = document.getElementById('btnLangAr');
    const btnEn = document.getElementById('btnLangEn');

    function refreshActiveState() {
        const lang = localStorage.getItem('appLang') || 'ar';
        btnAr.classList.toggle('active', lang === 'ar');
        btnEn.classList.toggle('active', lang === 'en');
    }

    btnAr.addEventListener('click', () => {
        currentLanguage = 'ar';
        loadTranslations();
        refreshActiveState();
    });

    btnEn.addEventListener('click', () => {
        currentLanguage = 'en';
        loadTranslations();
        refreshActiveState();
    });

    refreshActiveState();
}