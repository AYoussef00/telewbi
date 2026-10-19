/**
 * Component Loader Pipeline - Injects Navbar Framework cleanly
 */
document.addEventListener("DOMContentLoaded", () => {
    const navbarContainer = document.getElementById("navbar-container");

    if (navbarContainer) {
        fetch("../shared/navbar.html")
            .then(response => {
                if (!response.ok) throw new Error("Navbar framework file missing.");
                return response.text();
            })
            .then(htmlContent => {
                navbarContainer.innerHTML = htmlContent;
                // النافبار يُحقن ديناميكياً بعد أن يكون DOMContentLoaded قد أُطلق
                // بالفعل (حيث ينفّذ icons.js تعبئته التلقائية للأيقونات)، لذا
                // يجب تعبئة أيقونات [data-icon] الجديدة (🌐/🔔/⌄ وقائمة الحساب
                // المنسدلة) يدوياً هنا صراحة — بنفس الحل المطبّق على السايدبار.
                if (typeof applyIconPlaceholders === 'function') {
                    applyIconPlaceholders(navbarContainer);
                }
                setupNavbarEventListeners(); // Bind fresh listeners right after HTML mounts
                syncNavbarUserIdentity();    // Populate the real logged-in user's name/avatar

                // 🔄 إبلاغ شاشة التحميل العامة (page-loader) بأن حقن النافبار اكتمل —
                // تُخفى الشاشة فقط بعد اكتمال السايدبار والنافبار معاً (راجع app-core.js)
                if (typeof window.notifyLayoutComponentReady === 'function') {
                    window.notifyLayoutComponentReady();
                }
            })
            .catch(error => {
                console.error("Header Component Error:", error);
                if (typeof window.notifyLayoutComponentReady === 'function') {
                    window.notifyLayoutComponentReady();
                }
            });
    }
});

/**
 * Modern Event Delegation Listener Framework
 * Binds functions securely to window memory channels
 */
function setupNavbarEventListeners() {
    // Global backdrop click blur window to dismiss profile popovers safely
    document.addEventListener("click", (event) => {
        const dropdownMenu = document.getElementById("profileDropdown");
        const profileTrigger = document.querySelector(".profile-trigger");

        if (dropdownMenu && dropdownMenu.classList.contains("show")) {
            // If the click is outside both the profile trigger and the dropdown card content, close it
            if (!profileTrigger.contains(event.target) && !dropdownMenu.contains(event.target)) {
                dropdownMenu.classList.remove("show");
                if (profileTrigger) profileTrigger.classList.remove("open");
            }
        }
    });
}

/**
 * 1. Profile Dropdown Switch Toggler
 * Explicitly bound directly onto global window context memory
 */
window.toggleProfileDropdown = function(event) {
    event.stopPropagation(); // Stop click from bleeding into document body listener
    const dropdownMenu = document.getElementById("profileDropdown");
    const trigger = document.querySelector(".profile-trigger");
    if (dropdownMenu) {
        dropdownMenu.classList.toggle("show");
    }
    if (trigger) {
        trigger.classList.toggle("open");
    }
};

// =========================================================================
// 2. مزامنة هوية المستخدم الحقيقي (الاسم/البريد/الحرف الأول) في شريط التنقل
// =========================================================================

/**
 * عميل سوبابيس مستقل خاص بالنافبار فقط، بأسماء متغيرات مميزة حتى لا يتعارض
 * مع "dbClient" المُعرّف داخل سكربت كل صفحة (dashboard.js, employees.js...الخ)
 */
const navbarDbClient = dbClient;

const NAVBAR_ROLE_LABELS_AR = {
    super_admin: 'مدير عام النظام',
    admin: 'مسؤول',
    company: 'مسؤول شركة',
    employee: 'موظف'
};

// =========================================================================
// 🗄️ ذاكرة تخزين مؤقت (sessionStorage) لهوية المستخدم بالنافبار — تُستخدَم
// لعرض الاسم/الدور فوراً عند كل تنقل بين صفحات النظام (كل صفحة = تحميل كامل
// جديد للمتصفح) بدل ظهوره فارغاً/متأخراً ريثما يكتمل طلب الشبكة لسوبابيس في
// كل مرة. تبقى القيمة المخزَّنة مؤقتة فقط لعرض فوري؛ التحقق الفعلي من الجلسة
// وجلب أحدث بيانات الاسم/الدور وتطبيق تحويلة "يجب تغيير كلمة المرور" الأمنية
// يستمر دائماً في الخلفية (لا يُعتمد على القيمة المخزَّنة لأي قرار أمني)،
// ويُحدَّث التخزين المؤقت بأحدث نتيجة بعد كل تحقق. تُمسَح عند تسجيل الخروج.
// sessionStorage (لا localStorage) عمداً: تُمسَح تلقائياً عند إغلاق التبويب/
// النافذة، فلا يبقى اسم مستخدم سابق ظاهراً على جهاز مشترك بعد إغلاق المتصفح.
// =========================================================================
const NAVBAR_IDENTITY_CACHE_KEY = 'navbarUserIdentityCache_v1';

function readCachedNavbarIdentity() {
    try {
        const raw = sessionStorage.getItem(NAVBAR_IDENTITY_CACHE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null; // مثلاً وضع التصفح الخاص الذي يمنع sessionStorage ببعض المتصفحات
    }
}

function writeCachedNavbarIdentity(identity) {
    try {
        sessionStorage.setItem(NAVBAR_IDENTITY_CACHE_KEY, JSON.stringify(identity));
    } catch (e) {
        // تجاهل أي قصور بالتخزين — لا يؤثر على صحة الصفحة، فقط تُفقد ميزة العرض الفوري
    }
}

function clearCachedNavbarIdentity() {
    try {
        sessionStorage.removeItem(NAVBAR_IDENTITY_CACHE_KEY);
    } catch (e) { /* تجاهل */ }
}

/**
 * يطبّق كائن هوية (اسم/دور/حرف أول/بريد) على عناصر DOM الخاصة بالنافبار
 */
function applyNavbarIdentityToDom(identity) {
    const { displayName, roleLabel, initial, email } = identity;

    const adminNameEl = document.getElementById('adminName');
    const adminRoleEl = document.getElementById('adminRoleLabel');
    const userBadgeEl = document.getElementById('userBadge');
    const welcomeAvatarEl = document.getElementById('welcomeAvatar');
    const dropdownAvatarEl = document.getElementById('dropdownAvatar');
    const dropdownNameEl = document.getElementById('dropdownUserName');
    const dropdownEmailEl = document.getElementById('dropdownUserEmail');

    if (adminNameEl) adminNameEl.textContent = displayName;
    if (adminRoleEl && roleLabel) adminRoleEl.textContent = roleLabel;
    if (userBadgeEl) userBadgeEl.textContent = initial;
    if (welcomeAvatarEl) welcomeAvatarEl.textContent = initial;
    if (dropdownAvatarEl) dropdownAvatarEl.textContent = initial;
    if (dropdownNameEl) dropdownNameEl.textContent = displayName;
    if (dropdownEmailEl) dropdownEmailEl.textContent = email || '—';
}

/**
 * يجلب جلسة الدخول الحالية من Supabase Auth، ثم بيانات الاسم/الدور من جدول users،
 * ويحدّث كل عناصر النافبار (اسم الترحيب، الحرف الأول بالشارة، رأس القائمة المنسدلة)
 */
async function syncNavbarUserIdentity() {
    // ⚡ عرض فوري من الذاكرة المؤقتة (إن وُجدت) — يمنع ظهور اسم فارغ/متأخر عند
    // كل تنقل، ريثما يكتمل التحقق الفعلي من سوبابيس أدناه في الخلفية
    const cached = readCachedNavbarIdentity();
    if (cached) applyNavbarIdentityToDom(cached);

    try {
        const { data: { session }, error: sessionError } = await navbarDbClient.auth.getSession();
        if (sessionError || !session) return; // يبقى الاسم الافتراضي لو ما فيه جلسة نشطة (مثلاً صفحة عامة)

        const authUser = session.user;
        let displayName = authUser.email;
        let roleLabel = '';

        const { data: profileRow } = await navbarDbClient
            .from('users')
            .select('name, email, role, must_change_password')
            .eq('id', authUser.id)
            .maybeSingle();

        // 🔒 إجبار تغيير كلمة المرور: لو الحساب مطلوب منه ذلك، يُمنع من فتح أي صفحة
        // محمية أخرى ويُعاد توجيهه لصفحة تغيير كلمة المرور مباشرة
        // (قرار أمني — لا يُعتمَد فيه إطلاقاً على القيمة المخزَّنة مؤقتاً أعلاه)
        const currentPage = window.location.pathname.split('/').pop();
        if (profileRow && profileRow.must_change_password && currentPage !== 'change-password.html') {
            clearCachedNavbarIdentity();
            window.location.replace(Routes.url('change-password'));
            return;
        }

        if (profileRow) {
            displayName = profileRow.name || profileRow.email || authUser.email;
            roleLabel = NAVBAR_ROLE_LABELS_AR[profileRow.role] || '';
        }

        const initial = (displayName || '?').trim().charAt(0).toUpperCase();
        const identity = { userId: authUser.id, displayName, roleLabel, initial, email: authUser.email || '—' };

        applyNavbarIdentityToDom(identity);
        writeCachedNavbarIdentity(identity);

    } catch (err) {
        console.error("تعذّرت مزامنة هوية المستخدم بشريط التنقل:", err.message);
    }
}

/**
 * 3. User Authentication Exit Clearer
 * Explicitly bound directly onto global window context memory
 */
window.handleLogout = async function() {
    const isEnglish = document.documentElement.getAttribute('lang') === 'en';
    const confirmMsg = isEnglish
        ? 'Are you sure you want to log out?'
        : 'هل أنت متأكد من رغبتك في تسجيل الخروج؟';

    if (!confirm(confirmMsg)) return;

    try {
        await navbarDbClient.auth.signOut();
    } catch (err) {
        console.error("خطأ أثناء تسجيل الخروج:", err.message);
    } finally {
        clearCachedNavbarIdentity(); // لا يبقى اسم المستخدم السابق مخزّناً بعد الخروج
        window.location.href = Routes.url('index');
    }
};