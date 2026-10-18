/**
 * Global App Application Core Init Manager & Translation Engine
 */
let translations = null; // Will now hold just the active language dictionary
let currentLanguage = localStorage.getItem("appLang") || "ar";

// =========================================================================
// 📡 كاشف حالة الاتصال بالإنترنت — يعرض شاشة "لا يوجد اتصال" تغطي الصفحة
// بالكامل فور انقطاع الشبكة (navigator.onLine + حدث 'offline')، ويُحدّث
// الصفحة تلقائياً بالكامل فور عودة الاتصال (حدث 'online') لضمان تحميل أحدث
// البيانات دون أي تدخل يدوي من المستخدم. مكتفٍ ذاتياً (بلا اعتماد على أي
// ملف CSS خارجي) حتى يعمل بنفس الطريقة على كل صفحات النظام دون الحاجة لتعديل
// كل ملف HTML على حدة.
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

        // حقن حركات الأنيميشن مرة واحدة فقط
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
        if (offlineOverlayEl) return; // ظاهرة بالفعل
        offlineOverlayEl = buildOfflineOverlay();
        document.body.appendChild(offlineOverlayEl);
    }

    function showReconnectedMessageThenReload() {
        if (!offlineOverlayEl) {
            // نادراً ما يحدث (مثلاً لو تغيّرت حالة الشبكة دون أن تمر بحالة "غير متصل"
            // مُسجَّلة هنا)، لكن كإجراء احتياطي نُحدّث الصفحة مباشرة لضمان أحدث البيانات
            return;
        }
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

    // فحص فوري عند تحميل السكربت نفسه (لو فُتحت الصفحة والمستخدم غير متصل أصلاً)
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        showOfflineOverlay();
    }
})();

// =========================================================================
// 🔄 شاشة التحميل بشعار الشركة (Page Loader) لصفحات النظام الداخلية — نفس
// شاشة تسجيل الدخول تماماً. توضع (#pageLoader) في بداية <body> بكل صفحة، وتبقى
// ظاهرة إلى أن يُبلّغ كل من sidebar.js و navbar.js باكتمال حقنهما عبر
// notifyLayoutComponentReady()، بدل الاعتماد على window.load وحده (الذي لا
// يرتبط زمنياً بلحظة اكتمال حقن هذين المكوّنين الديناميكيين عبر fetch).
//
// ⚠️ صفحة لوحة التحكم (dashboard.html) تحديداً بها طرف ثالث لا بد من انتظاره
// أيضاً قبل إخفاء شاشة التحميل: تحديد دور المستخدم الحالي (مسؤول/شركة/موظف)
// وإظهار اللوحة الصحيحة تبعاً له (dashboard.js) — وهذا يتطلب استعلام إضافي
// من قاعدة البيانات (Supabase) منفصل تماماً عن جهوزية السايدبار والنافبار
// (طلبان سريعان لجلب قالب HTML ثابت فقط). كان إخفاء شاشة التحميل يعتمد
// سابقاً على جهوزية هذين الطلبين فقط، فتُخفى غالباً *قبل* أن ينتهي
// dashboard.js من تحديد أن المستخدم مثلاً "موظف"، فتظهر للحظة لوحة المسؤول
// العامة (الظاهرة افتراضياً بالـ HTML الخام) قبل أن يستبدلها الكود بلوحة
// تحكم الموظف الصحيحة — وهو الوميض (Flash) المُبلَّغ عنه. الحل: نكتشف وجودنا
// بصفحة لوحة التحكم تحديداً (بوجود عنصر #adminDashboardView المميّز لها)
// ونرفع عدد "الأطراف" المطلوب انتظارها هنا إلى 3 بدل 2، على أن يستدعي
// dashboard.js بنفسه notifyLayoutComponentReady() كطرف ثالث فور اكتمال تحديد
// الدور وإظهار اللوحة الصحيحة (انظر نهاية معالج DOMContentLoaded بملف
// dashboard.js). بقية صفحات النظام غير المتأثرة تستمر بانتظار طرفين فقط كما كانت.
// =========================================================================
let layoutReadyCount = 0;
const LAYOUT_READY_REQUIRED = document.getElementById('adminDashboardView') ? 3 : 2; // السايدبار + شريط التنقل (+ تحديد دور لوحة التحكم إن وُجدت)
const LAYOUT_READY_MIN_DISPLAY_MS = 350; // حد أدنى للعرض حتى لا تومض الشاشة بسرعة مفرطة
let layoutReadyFallbackTimer = null;

function hidePageLoader() {
    const pageLoader = document.getElementById('pageLoader');
    if (!pageLoader) return;
    if (layoutReadyFallbackTimer) {
        clearTimeout(layoutReadyFallbackTimer);
        layoutReadyFallbackTimer = null;
    }
    setTimeout(() => pageLoader.classList.add('loader-hidden'), LAYOUT_READY_MIN_DISPLAY_MS);
}

/**
 * يُستدعى من sidebar.js و navbar.js بعد اكتمال حقن كل منهما (نجاحاً أو فشلاً)،
 * وأيضاً من dashboard.js بعد اكتمال تحديد دور المستخدم وإظهار لوحته الصحيحة
 * (بصفحة لوحة التحكم تحديداً — انظر التعليق أعلاه)، لإخفاء شاشة التحميل بمجرد
 * جهوزية كل الأطراف المطلوبة معاً
 */
window.notifyLayoutComponentReady = function() {
    layoutReadyCount++;
    if (layoutReadyCount >= LAYOUT_READY_REQUIRED) {
        hidePageLoader();
    }
};

document.addEventListener("DOMContentLoaded", () => {
    // Start template assembly and pull target translation file concurrently
    loadTranslations();

    // 🛟 شبكة أمان: لو تعطّل أحد طلبي السايدبار/النافبار (اتصال بطيء جداً أو
    // خطأ شبكة) تُخفى شاشة التحميل تلقائياً بعد مهلة أقصاها حتى لا يبقى
    // المستخدم محجوباً خلفها للأبد
    if (document.getElementById('pageLoader')) {
        layoutReadyFallbackTimer = setTimeout(hidePageLoader, 6000);
    }
    // ملاحظة: تم حذف استدعاء initializeAppArchitecture() من هنا — هذا الملف
    // (app-core.js) لا يُعرّف هذه الدالة أصلاً؛ كان الاستدعاء يعتمد ضمنياً على
    // أن sidebar.js عرّفها بنفس الاسم في النطاق العام المشترك، بينما sidebar.js
    // نفسه يستدعيها أيضاً من مستمع DOMContentLoaded الخاص به. النتيجة كانت
    // تنفيذ الدالة مرتين متزامنتين (سباق Race Condition بين طلبي fetch لنفس
    // sidebar.html)، مما يُسبب أحياناً استبدال محتوى السايدبار بنسخة غير
    // معالَجة من الأيقونات بعد أن تكون قد ظهرت بشكل صحيح — وهو سبب اختفاء
    // الأيقونات العشوائي المُبلّغ عنه في بعض الصفحات (لوحة التحكم، الشركات،
    // الحضور والانصراف، وصفحات التقارير). تهيئة السايدبار أصبحت مسؤولية
    // sidebar.js وحده حصرياً.
});

/**
 * Asynchronously retrieves the specific active language file (ar.json or en.json)
 */
async function loadTranslations() {
    try {
        // Dynamically request only the required language resource file
        const response = await fetch(`${currentLanguage}.json`);
        if (!response.ok) throw new Error(`Could not load ${currentLanguage}.json file.`);

        translations = await response.json();

        // Execute structural layout translation pass
        applyTranslations();
    } catch (error) {
        console.error("Localization asset request failed:", error);
    }
}

/**
 * Switches document rendering directions and maps active strings onto target DOM nodes
 */
function applyTranslations() {
    // Fail-safe protection if file parsing delays or fails entirely
    if (!translations) return;

    // 1. Enforce structural direction switches across document tags
    document.documentElement.lang = currentLanguage;
    document.documentElement.dir = currentLanguage === "ar" ? "rtl" : "ltr";

    // 2. Map structural translation text onto matching DOM key nodes
    document.querySelectorAll("[data-i18n]").forEach(element => {
        const key = element.getAttribute("data-i18n");
        if (translations[key]) {
            element.textContent = translations[key];
        }
    });

    // 3. Dynamic adjustment mapping for form text input field placeholders
    document.querySelectorAll("[placeholder]").forEach(input => {
        if (input.id === "tableSearchInput" && translations["searchCompanyPlaceholder"]) {
            input.placeholder = translations["searchCompanyPlaceholder"];
        }
        // 🔍 حقل بحث صفحة الموظفين (بالاسم أو رقم الهوية) — كان بلا أي مطابقة هنا
        // سابقاً فيبقى النص العربي الثابت بالـ HTML حتى مع التبديل للإنجليزية.
        if (input.id === "employeeSearchInput" && translations["searchEmployeePlaceholder"]) {
            input.placeholder = translations["searchEmployeePlaceholder"];
        }
    });

    // Secure persistent browser state memory records
    localStorage.setItem("appLang", currentLanguage);
}

/**
 * Global window layout click switch trigger binding hook
 */
window.switchLanguage = function() {
    currentLanguage = currentLanguage === "ar" ? "en" : "ar";
    // Fetch and load the newly targeted translation file over the network instantly
    loadTranslations();
};