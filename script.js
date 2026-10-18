// =========================================================================
// 📡 كاشف حالة الاتصال بالإنترنت — يعرض شاشة "لا يوجد اتصال" تغطي الصفحة
// بالكامل فور انقطاع الشبكة (navigator.onLine + حدث 'offline')، ويُحدّث
// الصفحة تلقائياً بالكامل فور عودة الاتصال (حدث 'online') لضمان تحميل أحدث
// البيانات دون أي تدخل يدوي من المستخدم. مكتفٍ ذاتياً (بلا اعتماد على أي
// ملف CSS خارجي) — نفس المنطق المستخدم بـ app-core.js لصفحات النظام الداخلية.
// =========================================================================
(function() {
    let offlineOverlayEl = null;
    let reconnectReloadTimer = null;

    function isEnglishPage() {
        return document.documentElement.getAttribute('lang') === 'en';
    }

    function buildOfflineOverlay() {
        const overlay = document.createElement('div');
        overlay.id = 'offlineOverlay';
        overlay.style.cssText = `
            position: fixed; inset: 0; background: rgba(15, 23, 42, 0.97);
            display: flex; align-items: center; justify-content: center;
            z-index: 999999; text-align: center; padding: 20px;
            font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif;
        `;

        const box = document.createElement('div');
        box.style.cssText = 'max-width: 380px; color: #ffffff;';

        const icon = document.createElement('div');
        icon.textContent = '📡';
        icon.style.cssText = 'font-size: 52px; margin-bottom: 18px; opacity: 0.9; animation: offlinePulse 1.6s ease-in-out infinite;';

        const title = document.createElement('h2');
        title.id = 'offlineOverlayTitle';
        title.style.cssText = 'font-size: 19px; font-weight: 700; margin-bottom: 8px;';
        title.textContent = isEnglishPage() ? 'No Internet Connection' : 'لا يوجد اتصال بالإنترنت';

        const desc = document.createElement('p');
        desc.id = 'offlineOverlayDesc';
        desc.style.cssText = 'font-size: 13.5px; color: #cbd5e1; line-height: 1.8;';
        desc.textContent = isEnglishPage()
            ? "Please check your network connection. The page will refresh automatically once you're back online."
            : 'يرجى التحقق من اتصالك بالشبكة. سيتم تحديث الصفحة تلقائياً فور عودة الاتصال.';

        const spinner = document.createElement('div');
        spinner.style.cssText = 'width: 26px; height: 26px; border: 3px solid rgba(255,255,255,0.25); border-top-color: #d4af37; border-radius: 50%; margin: 22px auto 0; animation: offlineSpin 0.9s linear infinite;';

        box.appendChild(icon);
        box.appendChild(title);
        box.appendChild(desc);
        box.appendChild(spinner);
        overlay.appendChild(box);

        if (!document.getElementById('offlineOverlayKeyframes')) {
            const styleTag = document.createElement('style');
            styleTag.id = 'offlineOverlayKeyframes';
            styleTag.textContent = `
                @keyframes offlineSpin { to { transform: rotate(360deg); } }
                @keyframes offlinePulse { 0%, 100% { opacity: 0.9; transform: scale(1); } 50% { opacity: 0.5; transform: scale(0.92); } }
            `;
            document.head.appendChild(styleTag);
        }

        return overlay;
    }

    function showOfflineOverlay() {
        if (offlineOverlayEl) return;
        offlineOverlayEl = buildOfflineOverlay();
        document.body.appendChild(offlineOverlayEl);
    }

    function showReconnectedMessageThenReload() {
        if (!offlineOverlayEl) return;
        const title = document.getElementById('offlineOverlayTitle');
        const desc = document.getElementById('offlineOverlayDesc');
        if (title) title.textContent = isEnglishPage() ? 'Connection Restored' : 'تم استعادة الاتصال';
        if (desc) desc.textContent = isEnglishPage() ? 'Refreshing the page…' : 'جاري تحديث الصفحة...';

        reconnectReloadTimer = setTimeout(() => {
            window.location.reload();
        }, 900);
    }

    window.addEventListener('offline', () => {
        if (reconnectReloadTimer) { clearTimeout(reconnectReloadTimer); reconnectReloadTimer = null; }
        showOfflineOverlay();
    });

    window.addEventListener('online', () => {
        showReconnectedMessageThenReload();
    });

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        showOfflineOverlay();
    }
})();

// 🔄 إخفاء شاشة التحميل الأولية بعد جهوزية الصفحة (بحد أدنى للعرض حتى لا تومض بسرعة)
window.addEventListener('load', () => {
    const pageLoader = document.getElementById('pageLoader');
    if (!pageLoader) return;
    setTimeout(() => {
        pageLoader.classList.add('loader-hidden');
    }, 500);
});

// 2. دالة إظهار وإخفاء كلمة المرور وتبديل رسمة الـ SVG باحترافية
function togglePasswordView() {
    const passwordInput = document.getElementById('password');
    const eyeIcon = document.getElementById('eyeIcon');

    if (passwordInput && eyeIcon) {
        if (passwordInput.type === 'password') {
            passwordInput.type = 'text';
            // رسمة الـ SVG الجديدة للعين المشطوبة (إخفاء)
            eyeIcon.innerHTML = `
                <path stroke-linecap="round" stroke-linejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
            `;
        } else {
            passwordInput.type = 'password';
            // إعادتها لرسمة العين المفتوحة الأساسية (إظهار)
            eyeIcon.innerHTML = `
                <path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            `;
        }
    }
}

// =========================================================================
// 🌓 تبديل الوضع الليلي/النهاري (Dark/Light Mode)
// =========================================================================

// يعكس شكل الأيقونة (شمس/قمر) بحسب الوضع الحالي المطبّق فعلياً على الصفحة
function applyThemeIcons() {
    const isDark = document.documentElement.classList.contains('dark-mode');
    const sunIcon = document.getElementById('themeIconSun');
    const moonIcon = document.getElementById('themeIconMoon');
    const themeBtn = document.getElementById('themeToggleBtn');
    if (!sunIcon || !moonIcon) return;

    sunIcon.style.display = isDark ? 'block' : 'none';
    moonIcon.style.display = isDark ? 'none' : 'block';

    if (themeBtn) {
        const isEnglish = document.documentElement.getAttribute('lang') === 'en';
        themeBtn.setAttribute('aria-label', isDark
            ? (isEnglish ? 'Switch to light mode' : 'التبديل للوضع النهاري')
            : (isEnglish ? 'Switch to dark mode' : 'التبديل للوضع الليلي'));
    }
}

// تبديل الوضع الليلي/النهاري وحفظ التفضيل محلياً ليبقى ثابتاً بين الزيارات
function toggleTheme() {
    const htmlTag = document.documentElement;
    const isDark = htmlTag.classList.toggle('dark-mode');
    try {
        localStorage.setItem('bi_theme', isDark ? 'dark' : 'light');
    } catch (e) {
        console.warn('تعذّر حفظ تفضيل الوضع الليلي محلياً:', e.message);
    }
    applyThemeIcons();
}

const translations = {
    ar: {
        title: "بصمة الأعمال",
        loginTitle: "تسجيل الدخول",
        subtitle: "أدخل بياناتك للوصول إلى النظام",
        emailLabel: "البريد الإلكتروني",
        emailPlaceholder: "اسم المستخدم أو البريد",
        passwordLabel: "كلمة المرور",
        passwordPlaceholder: "أدخل كلمة المرور",
        forgotPassword: "نسيت كلمة المرور؟",
        loginBtn: "تسجيل دخول",
        promoTitle: "بصمة الأعمال",
        promoDesc: "مرحباً بك في المنصة الذكية لإدارة المتابعة والإنتاجية عن بُعد. نسعى لتوفير بيئة عمل مرنة واحترافية تضمن لك إنجاز مهامك بكل سلاسة وأمان وبأعلى جودة رقمية.",
        promoUpdate: "💡 <strong>تحديث جديد:</strong> تم إطلاق نظام الإشعارات الفورية للمهام اليومية؛ تصفح لوحة التحكم بعد الدخول لمعرفة المزيد!",
        featureChip1: "حماية بيانات موثوقة",
        featureChip2: "أداء سريع وسلس",
        featureChip3: "تقارير لحظية دقيقة",
        errorConnection: "فشلت عملية تسجيل الدخول بسبب مشكلة في الاتصال بالشبكة. يرجى التحقق من اتصالك بالإنترنت والمحاولة مرة أخرى.",
        errorInvalidCredentials: "البريد الإلكتروني أو كلمة المرور غير صحيحة. يرجى التأكد من البيانات والمحاولة مرة أخرى.",
        errorTooManyRequests: "محاولات تسجيل دخول كثيرة خلال وقت قصير. يرجى الانتظار قليلاً ثم المحاولة مرة أخرى.",
        errorEmailNotConfirmed: "لم يتم تأكيد البريد الإلكتروني بعد. يرجى مراجعة بريدك الإلكتروني لإكمال التفعيل.",
        errorNotEmployeeLoginPage: "هذه الشاشة مخصصة لحسابات المسؤولين فقط. حسابك حساب موظف — يرجى تسجيل الدخول من شاشة دخول الموظفين الخاصة.",
        errorNotCompanyLoginPage: "هذه الشاشة مخصصة لحسابات المسؤولين فقط. حسابك حساب مسؤول شركة — يرجى تسجيل الدخول من شاشة دخول الشركات الخاصة."
    },
    en: {
        title: "Business Imprint",
        loginTitle: "Sign In",
        subtitle: "Enter your details to access the system",
        emailLabel: "Email Address",
        emailPlaceholder: "Username or Email",
        passwordLabel: "Password",
        passwordPlaceholder: "Enter your password",
        forgotPassword: "Forgot Password?",
        loginBtn: "Login",
        promoTitle: "Business Imprint",
        promoDesc: "Welcome to the smart platform for remote tracking and productivity management. We strive to provide a flexible and professional work environment that ensures you complete your tasks smoothly, securely, and with the highest digital quality.",
        promoUpdate: "💡 <strong>New Update:</strong> Real-time task notifications have been launched! Check your dashboard after logging in to learn more.",
        featureChip1: "Trusted data protection",
        featureChip2: "Fast, smooth performance",
        featureChip3: "Accurate real-time reports",
        errorConnection: "Login failed due to a connection problem. Please check your internet connection and try again.",
        errorInvalidCredentials: "The email or password is incorrect. Please check your details and try again.",
        errorTooManyRequests: "Too many login attempts in a short time. Please wait a moment and try again.",
        errorEmailNotConfirmed: "This email address has not been confirmed yet. Please check your inbox to complete activation.",
        errorNotEmployeeLoginPage: "This screen is for admin accounts only. Your account is an employee account — please sign in from the dedicated employee login screen.",
        errorNotCompanyLoginPage: "This screen is for admin accounts only. Your account is a company account — please sign in from the dedicated company login screen."
    }
};

// =========================================================================
// 🧭 ترجمة رسائل الأخطاء الخام القادمة من سوبابيس (Supabase) إلى رسائل
// عربية/إنجليزية واضحة وودّية بدل عرض النص التقني الخام (مثل
// "Failed to fetch" أو "Invalid login credentials") مباشرةً للمستخدم النهائي.
// =========================================================================
function getFriendlyLoginErrorMessage(rawMessage, lang) {
    const t = translations[lang] || translations.ar;
    const msg = (rawMessage || '').toLowerCase();

    // فشل الطلب نفسه قبل وصول رد من الخادم (شبكة/CORS/انقطاع اتصال...)
    if (msg.includes('fetch') || msg.includes('network') || msg.includes('load failed') || msg.includes('err_')) {
        return t.errorConnection;
    }

    // بريد إلكتروني أو كلمة مرور غير صحيحة
    if (msg.includes('invalid login credentials') || msg.includes('invalid email or password')) {
        return t.errorInvalidCredentials;
    }

    // محاولات كثيرة جداً خلال فترة قصيرة
    if (msg.includes('rate limit') || msg.includes('too many requests')) {
        return t.errorTooManyRequests;
    }

    // البريد الإلكتروني غير مؤكد بعد
    if (msg.includes('email not confirmed')) {
        return t.errorEmailNotConfirmed;
    }

    // احتياطي: أي خطأ آخر غير معروف يُعرض بصيغته الأصلية مع بادئة مترجمة
    return lang === 'en' ? `Error: ${rawMessage}` : `خطأ: ${rawMessage}`;
}

function toggleLanguage() {
    const htmlTag = document.documentElement;
    const currentLang = htmlTag.getAttribute('lang');

    // تحديد اللغة الجديدة
    const newLang = currentLang === 'ar' ? 'en' : 'ar';

    // تغيير خصائص المستند الأساسية
    htmlTag.setAttribute('lang', newLang);
    htmlTag.setAttribute('dir', newLang === 'ar' ? 'rtl' : 'ltr');

    // تحديث عنوان تبويب المتصفح والنصوص
    document.title = translations[newLang].title;
    document.querySelector('.system-title').textContent = translations[newLang].loginTitle;
    document.querySelector('.system-subtitle').textContent = translations[newLang].subtitle;

    // تحديث تسميات الحقول (Labels) والتلميحات (Placeholders)
    document.querySelector('label[for="email"]').textContent = translations[newLang].emailLabel;
    document.getElementById('email').setAttribute('placeholder', translations[newLang].emailPlaceholder);

    document.querySelector('label[for="password"]').textContent = translations[newLang].passwordLabel;
    document.getElementById('password').setAttribute('placeholder', translations[newLang].passwordPlaceholder);

    document.querySelector('.forgot-password-link').textContent = translations[newLang].forgotPassword;

    // ⚠️ زر الدخول أصبح يحتوي عنصر Spinner مخفياً بجانب النص (لعرض التحميل أثناء
    // الإرسال)، فلم يعد .btn-login نصاً خالصاً؛ الكتابة المباشرة على textContent
    // كانت ستمسح عنصر الـ Spinner بالكامل من الـ DOM. النص الفعلي الآن داخل
    // #loginBtnText تحديداً.
    const loginBtnTextLabelEl = document.getElementById('loginBtnText');
    if (loginBtnTextLabelEl) loginBtnTextLabelEl.textContent = translations[newLang].loginBtn;

    // تحديث نصوص القسم الأيسر (الترويجي) إن وُجدت
    const promoTitleEl = document.querySelector('.left-side h2');
    const promoDescEl = document.querySelector('.left-side p');
    const promoBoxEl = document.getElementById('promoBox');
    if (promoTitleEl) promoTitleEl.textContent = translations[newLang].promoTitle;
    if (promoDescEl) promoDescEl.textContent = translations[newLang].promoDesc;
    if (promoBoxEl) promoBoxEl.innerHTML = translations[newLang].promoUpdate;

    // تحديث نصوص شريط المزايا المختصر (الحماية / الأداء / التقارير) أسفل الفقرة الترويجية
    const featureChipEls = [
        document.getElementById('featureChip1Text'),
        document.getElementById('featureChip2Text'),
        document.getElementById('featureChip3Text')
    ];
    const featureChipKeys = ['featureChip1', 'featureChip2', 'featureChip3'];
    featureChipEls.forEach((el, i) => {
        if (el) el.textContent = translations[newLang][featureChipKeys[i]];
    });

    // تحديث مفتاح تبديل اللغة (Switch) نفسه: موضع الكرة وتمييز اللغة الفعّالة
    const langSwitchWrapper = document.getElementById('langSwitchWrapper');
    if (langSwitchWrapper) langSwitchWrapper.setAttribute('data-lang', newLang);

    const langLabelAr = document.getElementById('langLabelAr');
    const langLabelEn = document.getElementById('langLabelEn');
    if (langLabelAr) langLabelAr.classList.toggle('active', newLang === 'ar');
    if (langLabelEn) langLabelEn.classList.toggle('active', newLang === 'en');

    if (langSwitchWrapper) {
        langSwitchWrapper.setAttribute('aria-label', newLang === 'ar' ? 'تبديل اللغة' : 'Switch language');
    }

    // تحديث تسمية زر الوضع الليلي/النهاري بما يطابق اللغة الجديدة
    applyThemeIcons();

    // إخفاء أي رسالة خطأ ظاهرة حتى لا تبقى معروضة بلغة مختلفة عن باقي الصفحة
    hideLoginError();
}

// =========================================================================
// ⚠️ رسالة خطأ تسجيل الدخول: لوحة مدمجة برسوم متحركة داخل الصفحة بدل نافذة
//    alert() التقليدية المقاطِعة — تظهر بانزلاق ناعم أعلى النموذج مصحوبة
//    باهتزاز خفيف لبطاقة الدخول لجذب الانتباه دون إزعاج المستخدم، وتُخفى
//    تلقائياً بمجرد بدء تصحيح البيانات أو تبديل اللغة.
// =========================================================================
function showLoginError(message) {
    const errorBox = document.getElementById('loginErrorBox');
    const errorText = document.getElementById('loginErrorText');
    const loginBox = document.querySelector('.login-box');
    if (!errorBox || !errorText) return;

    errorText.textContent = message;
    errorBox.classList.add('show');

    if (loginBox) {
        loginBox.classList.remove('shake');
        void loginBox.offsetWidth; // إعادة تشغيل الأنيميشن (Reflow) لضمان تكرار الاهتزاز حتى لو تكرر الخطأ
        loginBox.classList.add('shake');
        loginBox.addEventListener('animationend', () => loginBox.classList.remove('shake'), { once: true });
    }
}

function hideLoginError() {
    const errorBox = document.getElementById('loginErrorBox');
    if (errorBox) errorBox.classList.remove('show');
}



// 1. تهيئة الاتصال بـ Supabase (استبدل القيم بالقيم الخاصة بمشروعك)

// =========================================================================
// 1. INITIALIZATION (Using 'dbClient' to prevent global variable crashes)
// =========================================================================
const SUPABASE_URL = "https://mcdhxdfkuokhmhtfvjev.supabase.co"; // ضع رابط مشروعك هنا
const SUPABASE_ANON_KEY = "sb_publishable_yt9V8lsNU1zN3Ix2CvovbQ_QCA2VDdM";          // ضع مفتاح الـ anon هنا

// Saved into a custom name to prevent shadowing global 'supabase' object
const dbClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);


// =========================================================================
// 2. FORM EVENT LISTENER
// =========================================================================
document.addEventListener('DOMContentLoaded', () => {
    // تفعيل شكل أيقونة الوضع الليلي/النهاري الصحيح فور تحميل الصفحة
    applyThemeIcons();

    // 🎬 تثبيت بطاقة الدخول (.login-box) على opacity:1 بشكل نهائي بمجرد اكتمال
    // أنيميشن ظهورها الأول (loginBoxEnter)، عبر إضافة الكلاس .settled الذي
    // يُلغي خاصية animation عن العنصر بالكامل (راجع التعليق التفصيلي المرافق
    // لـ .login-box.settled بملف style.css لشرح سبب ضرورة هذه الخطوة تحديداً:
    // دون ذلك، يُعاد تشغيل أنيميشن الظهور من الصفر في كل مرة يُعرض فيها خطأ
    // تسجيل دخول لاحق (اهتزاز .shake)، فتختفي البطاقة مؤقتاً بعد كل خطأ).
    // الاستماع لكلا الحدثين animationend و animationcancel معاً يضمن تثبيت
    // الحالة حتى لو قُوطع الأنيميشن الأول مبكراً (مثلاً خطأ فوري جداً بعد
    // فتح الصفحة)، مع مؤقّت احتياطي (Fallback) في حال عدم إطلاق أي منهما
    // لأي سبب متعلق بالمتصفح.
    const loginBoxEl = document.querySelector('.login-box');
    if (loginBoxEl) {
        const settleLoginBox = () => loginBoxEl.classList.add('settled');
        loginBoxEl.addEventListener('animationend', (e) => {
            if (e.animationName === 'loginBoxEnter') settleLoginBox();
        });
        loginBoxEl.addEventListener('animationcancel', (e) => {
            if (e.animationName === 'loginBoxEnter') settleLoginBox();
        });
        setTimeout(settleLoginBox, 950); // احتياطي: 0.15s تأخير + 0.7s مدة + هامش أمان
    }

    // دعم لوحة المفاتيح (Enter / Space) على مفتاح تبديل اللغة لأنه ليس زراً حقيقياً
    const langSwitchWrapper = document.getElementById('langSwitchWrapper');
    if (langSwitchWrapper) {
        langSwitchWrapper.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleLanguage();
            }
        });
    }

    // إخفاء رسالة الخطأ تلقائياً بمجرد أن يبدأ المستخدم بتصحيح بياناته
    ['email', 'password'].forEach((fieldId) => {
        const field = document.getElementById(fieldId);
        if (field) field.addEventListener('input', hideLoginError);
    });

    const loginForm = document.querySelector('form');

    if (loginForm) {
        loginForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            hideLoginError();

            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;

            const loginBtn = document.querySelector('.btn-login');
            const loginBtnText = document.getElementById('loginBtnText');
            const loginBtnSpinner = document.getElementById('loginBtnSpinner');
            const pageLoader = document.getElementById('pageLoader');
            const currentLang = document.documentElement.getAttribute('lang') === 'en' ? 'en' : 'ar';
            const originalBtnText = loginBtnText.textContent;
            loginBtnText.textContent = currentLang === 'en' ? "Signing in..." : "جاري تسجيل الدخول...";
            loginBtnSpinner.style.display = 'inline-block';
            loginBtn.disabled = true;

            // 🔄 إظهار شاشة التحميل الكاملة بشعار الشركة أثناء عملية تسجيل الدخول
            // أيضاً (وليس فقط عند فتح الصفحة أول مرة) — تبقى ظاهرة حتى نجاح
            // الدخول والانتقال للصفحة التالية، أو تُخفى فوراً لو حدث خطأ
            if (pageLoader) pageLoader.classList.remove('loader-hidden');

            try {
                // FIX: Use 'dbClient.auth' here instead of 'supabase.auth'
                const { data, error } = await dbClient.auth.signInWithPassword({
                    email: email,
                    password: password
                });

                if (error) {
                    if (pageLoader) pageLoader.classList.add('loader-hidden');
                    showLoginError(getFriendlyLoginErrorMessage(error.message, currentLang));
                } else {
                    // 🛡️ إصلاح أمني/تصميمي مهم: هذه الشاشة (login.html) أصبحت مخصصة
                    // لحسابات مسؤولي النظام (super_admin/admin) حصراً — كل من حسابات
                    // "موظف" و"مسؤول شركة" لهما شاشتا دخول مستقلتان بديلتان
                    // (login-employee.html / login-companies.html)، وكلتاهما تحتويان
                    // نفس الرفض الصريح بالاتجاه المعاكس (كل شاشة ترفض أي حساب ليس من
                    // دورها المخصَّص لها). قبل هذا الإصلاح، كان بإمكان أي موظف أو مسؤول
                    // شركة يعرف بيانات دخوله تسجيل الدخول من هنا أيضاً بلا أي تمييز،
                    // بينما القصد أن تبقى شاشات الدخول الثلاث منفصلة تماماً بحسب نوع
                    // الحساب — نتحقق الآن من الدور فوراً بعد نجاح المصادقة، ونرفض
                    // حسابات "موظف" و"مسؤول شركة" تحديداً (بتسجيل خروجها فوراً) قبل أي
                    // انتقال للوحة التحكم.
                    let userRole = null;
                    let mustChangePassword = false;
                    try {
                        const { data: profileRow } = await dbClient
                            .from('users')
                            .select('role, must_change_password')
                            .eq('id', data.user.id)
                            .maybeSingle();
                        userRole = profileRow ? profileRow.role : null;
                        mustChangePassword = !!(profileRow && profileRow.must_change_password);
                    } catch (profileErr) {
                        console.error('تعذّر التحقق من بيانات الحساب:', profileErr.message);
                    }

                    if (userRole === 'employee') {
                        await dbClient.auth.signOut();
                        if (pageLoader) pageLoader.classList.add('loader-hidden');
                        showLoginError(translations[currentLang].errorNotEmployeeLoginPage);
                        return;
                    }

                    if (userRole === 'company') {
                        await dbClient.auth.signOut();
                        if (pageLoader) pageLoader.classList.add('loader-hidden');
                        showLoginError(translations[currentLang].errorNotCompanyLoginPage);
                        return;
                    }

                    // تسجيل عملية الدخول هذه بجدول login_logs (سجل عمليات الدخول
                    // المستخدم ببطاقة "آخر عمليات تسجيل الدخول" بلوحة تحكم الشركة)
                    try {
                        await dbClient.from('login_logs').insert([{ user_id: data.user.id }]);
                    } catch (logErr) {
                        console.error('تعذّر تسجيل عملية الدخول بسجل login_logs:', logErr);
                    }

                    // شاشة التحميل تبقى ظاهرة عمداً هنا (لا تُخفى) لحين اكتمال
                    // الانتقال الفعلي للصفحة التالية، فتُغطّي أي وميض بصري بينهما
                    const destination = mustChangePassword ? "change-password.html" : "dashboard.html";
                    setTimeout(() => {
                        window.location.replace(destination);
                    }, 50);
                }
            } catch (err) {
                // ⚠️ كان هذا الفرع سابقاً يكتفي بتسجيل الخطأ في الـ Console فقط دون أي
                // رسالة تصل للمستخدم — فيبدو للمستخدم أن الضغط على "تسجيل دخول" لم
                // يحدث له أي أثر (تعود الشاشة لحقلي البريد وكلمة المرور بصمت)، فيضطر
                // للمحاولة عدة مرات ظنّاً منه أن الضغطة الأولى لم تُسجَّل. هذا الفرع
                // تحديداً (وليس فرع "error" أعلاه) هو ما يُنفَّذ عند فشل الطلب نفسه قبل
                // وصول رد من سوبابيس (انقطاع شبكة مؤقت، بطء اتصال، خطأ CORS...إلخ)
                // — أي بالضبط الحالة المُبلَّغ عنها.
                console.error("Unexpected error:", err);
                if (pageLoader) pageLoader.classList.add('loader-hidden');
                showLoginError(translations[currentLang].errorConnection);
            } finally {
                loginBtnText.textContent = originalBtnText;
                loginBtnSpinner.style.display = 'none';
                loginBtn.disabled = false;
            }
        });
    }
});
// التأكد من استدعاء مكتبة Supabase أولاً في ملف الـ HTML للـ Dashboard بنفس الطريقة السابقة

// دالة التحقق التلقائي من الحماية عند فتح لوحة التحكم
async function checkUserAuthentication() {
    const { data: { session }, error } = await dbClient.auth.getSession();

    if (error || !session) {
        // إذا لم يكن مسجلاً للدخول، يتم توجيهه لصفحة الدخول فوراً لحماية البيانات
        alert("عذراً، يجب تسجيل الدخول أولاً للوصول إلى هذه الصفحة.");
        window.location.href = "index.html";
    } else {
        console.log("مرحباً بك! تم التحقق من الهوية بنجاح:", session.user.email);
        // هنا يمكنك جلب اسم المستخدم الفعلي وعرضه بدلاً من الاسم الثابت إذا أردت
    }
}