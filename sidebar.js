/**
 * Global App Application Core Init Manager
 */
document.addEventListener("DOMContentLoaded", () => {
    initializeAppArchitecture();
});

/**
 * Compiles structural templates and setups event-listener mappings
 */
function initializeAppArchitecture() {
    const sidebarWrapperContainer = document.getElementById("sidebar-container");

    if (sidebarWrapperContainer) {
        fetch("sidebar.html")
            .then(res => {
                if (!res.ok) throw new Error("Resource template connection dropped.");
                return res.text();
            })
            .then(async htmlString => {
                sidebarWrapperContainer.innerHTML = htmlString;

                // 🛡️ العنصر .sidebar مخفي افتراضياً بـ CSS الآن (visibility:hidden
                // بملف sidebar.css نفسه) منذ لحظة حقنه بالصفحة — بنفس فلسفة إخفاء
                // [data-perm] و.dashboard-container/.page-container بملف
                // global-layout.css تماماً، بمعزل كلياً عن توقيت تنفيذ الجافاسكريبت
                // أو وجود/عدم وجود عنصر #pageLoader بصفحة HTML الحالية (كثير من
                // صفحات النظام لا تملكه أصلاً). لا يُظهره الكود أدناه إلا صراحةً
                // (visibility:visible مباشرة، وليس مجرد إزالة القيمة inline) بعد
                // اكتمال تصفية عناصر القائمة فعلياً حسب صلاحيات الدور بالكامل.
                const sidebarEl = sidebarWrapperContainer.querySelector('.sidebar');

                // 🛟 شبكة أمان: try/finally تضمن إظهار السايدبار وإبلاغ page-loader
                // بالجهوزية دائماً، حتى لو رمى أي خطأ غير متوقع أثناء الخطوات
                // الوسيطة أدناه (تعبئة الأيقونات، تمييز الرابط النشط...) — بدون
                // هذا كان أي خطأ نادر سيترك السايدبار مخفياً للأبد (بما أن الإخفاء
                // الافتراضي أصبح بـ CSS ملزماً الآن، على عكس السلوك السابق).
                try {
                    // السايدبار يُحقن ديناميكياً بعد أن يكون DOMContentLoaded قد أُطلق
                    // بالفعل (حيث ينفّذ icons.js تعبئته التلقائية للأيقونات)، لذا
                    // يجب تعبئة أيقونات [data-icon] الجديدة يدوياً هنا صراحة.
                    if (typeof applyIconPlaceholders === 'function') {
                        applyIconPlaceholders(sidebarWrapperContainer);
                    }
                    injectResponsiveOverlays();
                    routeHighlighterEngine();
                    applyStoredSidebarCollapseState();

                    // ⚠️ ننتظر (await) اكتمال الفلترة الفعلية حسب صلاحيات الدور هنا
                    // بالكامل *قبل* إظهار السايدبار — بحيث لا يُكشف للمستخدم إلا
                    // بحالته النهائية الصحيحة مباشرة (القوائم المسموحة فقط، بلا أي
                    // وميض لعناصر سيتم إخفاؤها بعد لحظة).
                    await applyRoleBasedMenuVisibility();
                } catch (err) {
                    console.error("Layout Engine Fault (post-injection):", err);
                } finally {
                    if (sidebarEl) sidebarEl.style.visibility = 'visible';

                    // 🔄 إبلاغ شاشة التحميل العامة (page-loader) بأن حقن السايدبار اكتمل —
                    // تُخفى الشاشة فقط بعد اكتمال السايدبار والنافبار معاً (راجع app-core.js)
                    // (على الصفحات التي تملك #pageLoader أصلاً؛ إخفاء .sidebar بـ CSS
                    // أعلاه هو ما يحمي بقية الصفحات التي لا تملكه)
                    if (typeof window.notifyLayoutComponentReady === 'function') {
                        window.notifyLayoutComponentReady();
                    }
                }
            })
            .catch(err => {
                console.error("Layout Engine Fault:", err);
                if (typeof window.notifyLayoutComponentReady === 'function') {
                    window.notifyLayoutComponentReady();
                }
            });
    }
}

/**
 * Creates and injects background blur elements for seamless mobile rendering
 */
function injectResponsiveOverlays() {
    const overlayElement = document.createElement("div");
    overlayElement.className = "sidebar-overlay";
    overlayElement.id = "mobileSidebarOverlay";
    document.body.appendChild(overlayElement);

    // Close mobile side drawer when clicking the blurred dim area
    overlayElement.addEventListener("click", toggleMobileSidebarAction);
}

/**
 * Toggles responsive state flags on mobile side drawer panels
 */
function toggleMobileSidebarAction() {
    const activeSidebarNode = document.querySelector(".sidebar");
    const structuralOverlayNode = document.getElementById("mobileSidebarOverlay");

    if (activeSidebarNode && structuralOverlayNode) {
        activeSidebarNode.classList.toggle("mobile-open");
        structuralOverlayNode.classList.toggle("visible");
    }
}

/**
 * Toggles expanding/collapsing submenus with an accordion slide effect
 */
function toggleSubmenu(event) {
    event.preventDefault();
    const immediateTargetLi = event.currentTarget.closest(".has-submenu");

    if (!immediateTargetLi) return;

    // Collapses separate active trees to maintain clean layout tracks
    document.querySelectorAll(".has-submenu").forEach(item => {
        if (item !== immediateTargetLi) {
            item.classList.remove("open");
        }
    });

    immediateTargetLi.classList.toggle("open");
}

/**
 * 🔘 يطوي/يفتح القائمة الجانبية بالكامل (وضع الأيقونات فقط) ويحفظ التفضيل محلياً
 */
const SIDEBAR_COLLAPSE_STORAGE_KEY = "sidebarCollapsed";

function toggleSidebarCollapse() {
    const appShell = document.querySelector(".app-container");
    if (!appShell) return;

    const isNowCollapsed = appShell.classList.toggle("sidebar-collapsed");
    localStorage.setItem(SIDEBAR_COLLAPSE_STORAGE_KEY, isNowCollapsed ? "true" : "false");

    // إغلاق أي قائمة فرعية مفتوحة لتفادي بقاءها ظاهرة بشكل غير متوقع أثناء الطي
    if (isNowCollapsed) {
        document.querySelectorAll(".has-submenu.open").forEach(item => item.classList.remove("open"));
    }
}

/**
 * يستعيد حالة الطي المحفوظة من زيارة سابقة فور تحميل القائمة، لمنع أي وميض بصري
 */
function applyStoredSidebarCollapseState() {
    const appShell = document.querySelector(".app-container");
    if (!appShell) return;

    const storedState = localStorage.getItem(SIDEBAR_COLLAPSE_STORAGE_KEY);
    if (storedState === "true") {
        appShell.classList.add("sidebar-collapsed");
    }
}

/**
 * خريطة الصفحات الفرعية إلى صفحة القائمة الرئيسية المرتبطة بها
 * (مثال: صفحة "إضافة مستخدم" تُبقي عنصر "المستخدمين" مُفعّلاً في القائمة الجانبية)
 */
const MENU_PAGE_ALIASES = {
    "add_user.html": "users.html",
    "add_employee.html": "employees.html",
    "add_job.html": "job-titles.html",
    "tasks_bulk.html": "tasks.html",
    "job_tasks.html": "tasks.html",
    "add_task.html": "tasks.html",
    "add_ticket.html": "support.html",
    "view_invoice.html": "invoices.html",
    "employee-collection-details.html": "collections.html"
};

/**
 * Automatically assigns active styling to the nav item matching the current page URL
 */
function routeHighlighterEngine() {
    const rawViewPath = window.location.pathname.split("/").pop() || "dashboard.html";
    const currentViewPath = MENU_PAGE_ALIASES[rawViewPath] || rawViewPath;
    const collectionAnchors = document.querySelectorAll(".menu-list .menu-item a, .menu-list .submenu a");

    // تصفير كل الحالات النشطة أولاً لضمان عدم بقاء عنصر قديم مُفعّلاً
    document.querySelectorAll(".menu-list .menu-item").forEach(el => el.classList.remove("active"));
    document.querySelectorAll(".menu-list .submenu li").forEach(el => el.classList.remove("active"));

    collectionAnchors.forEach(anchor => {
        if (anchor.getAttribute("href") === currentViewPath) {
            const itemLi = anchor.parentElement;
            itemLi.classList.add("active");

            // لو الرابط داخل قائمة فرعية، افتح القائمة المنسدلة للأب فقط (بدون تمييزه كعنصر نشط)
            const insideSubmenu = itemLi.closest(".submenu");
            if (insideSubmenu) {
                const parentMenuItem = insideSubmenu.closest(".has-submenu");
                parentMenuItem.classList.add("open");
            }
        }
    });
}

/**
 * Switches document rendering direction dynamically across RTL and LTR viewports
 */
function toggleSystemDirection() {
    const htmlNode = document.documentElement;
    const currentDirectionSetting = htmlNode.getAttribute("dir") || "rtl";

    if (currentDirectionSetting === "rtl") {
        htmlNode.setAttribute("dir", "ltr");
        htmlNode.setAttribute("lang", "en");
    } else {
        htmlNode.setAttribute("dir", "rtl");
        htmlNode.setAttribute("lang", "ar");
    }
}

// =========================================================================
// 🛡️ فلترة القوائم الجانبية حسب صلاحيات دور المستخدم الحالي — تُستمَد الآن
// من محرّك الصلاحيات المركزي المشترك (permissions.js) بدل استعلام سوبابيس
// مستقل خاص بالسايدبار وحده كما كان سابقاً، حتى لا يُكرَّر نفس الجلب مرتين
// بكل صفحة (مرة هنا ومرة أخرى داخل Permissions.guardPage بملف الصفحة نفسها).
// =========================================================================

// 📂 مجموعتا "المالية" و"التقارير" مُفكَّكتان الآن بمحرّك الصلاحيات إلى عناصر
// فرعية مستقلة (كل رابط بالقائمة الفرعية له مفتاح صلاحية view خاص به وحده
// بدل صلاحية واحدة موحّدة على القسم الأب — انظر PERMISSIONS_SECTIONS بأول
// permissions.js). هذه الخريطة تربط رابط كل عنصر فرعي بمفتاحه الدقيق.
// ⚠️ القيمة عادة نص مفتاح القسم (يُقيَّم بصلاحية "view" افتراضياً)، أو كائن
// { section, action } لرابط تُحدَّد رؤيته بإجراء غير "عرض" — الحالة الوحيدة
// حالياً رابط "إصدار فاتورة" (add_invoice.html): ليست له صلاحية "عرض" أصلاً
// (أصبح صلاحية مستقلة "invoice_issuing" بعمود "إضافة" فقط — انظر hiddenActions
// بتعريفها أعلى permissions.js)، فلا يصح تقييم رؤيته بصلاحية "view:finance_invoices"
// كما كان سابقاً (وهو ما كان يُبقي هذا الرابط ظاهراً لمسؤول الشركة رغم منعه
// فعلياً من صفحة إصدار الفاتورة نفسها — القسمان مختلفان تماماً الآن).
//
// 🆕 'collection_types.html': أُضيفت لهذه الخريطة عند إضافة شاشة "أنواع
// التحصيل" الجديدة تحت نفس مجموعة "المالية" الفرعية — بمفتاح صلاحية مستقل
// خاص بها (collection_types)، فيمكن منح/منع الوصول إليها بمعزل عن "تحصيل
// الموظفين" أو "الفواتير".
const SIDEBAR_SUBMENU_PERMISSION_MAP = {
    'invoices.html': 'finance_invoices',
    'add_invoice.html': { section: 'invoice_issuing', action: 'add' },
    'collections.html': 'finance_collections',
    'collection_types.html': 'collection_types',
    'employee-report.html': 'reports_employees',
    'companies-report.html': 'reports_companies',
    'companies-links-report.html': 'reports_company_links',
    'collections-report.html': 'reports_collections',
    'companies-collections-report.html': 'reports_companies_collections',
    'attendance-report.html': 'reports_attendance',
    'tasks-report.html': 'reports_tasks'
};

// المجموعات ذات القوائم الفرعية القابلة للتخصيص عنصراً بعنصر (بمعزل عن أي
// صلاحية موحّدة على القسم الأب — القسم الأب نفسه أصبح مجرد عنوان تجميعي)
const SIDEBAR_EXPANDABLE_GROUP_KEYS = ['finance', 'reports'];

/**
 * يُخفي أي عنصر رئيسي بالقائمة الجانبية لا يملك المستخدم الحالي صلاحية
 * "view" على قسمه (data-menu-key)، ويُخفي كل رابط فرعي داخل مجموعتي
 * "المالية"/"التقارير" لا يملك المستخدم صلاحية "view" عليه تحديداً (ثم يُخفي
 * المجموعة الأب بالكامل تلقائياً لو لم يعد بها أي رابط ظاهر)، ويُخفي رابط
 * "الأدوار والصلاحيات" الفرعي تحديداً لغير مدير عام النظام دائماً (وصول ثابت
 * بالكود، غير قابل للتخصيص — انظر التعليق بأول roles.js لسبب هذا التقييد الأمني).
 */
async function applyRoleBasedMenuVisibility() {
    try {
        // permissions.js يبدأ الجلب فور تحميله (بالتوازي مع حقن السايدبار)؛
        // لو لم يكن هذا الملف مُحمَّلاً بهذه الصفحة لأي سبب، لا نكسر شيئاً —
        // نكتفي بعرض كل القوائم كما كانت (سلوك السابق قبل هذا التحديث).
        if (typeof window.PermissionsReady === 'undefined' || typeof window.Permissions === 'undefined') return;

        await window.PermissionsReady;

        // مدير عام النظام يرى كل القوائم دائماً بلا استثناء
        if (window.Permissions.isSuperAdmin()) return;

        // عناصر القائمة العادية (بلا تفكيك فرعي بصلاحيات مستقلة): تُخفى بالكامل
        // لو لم يملك المستخدم صلاحية "عرض" على قسمها مباشرة — يشمل هذا أيضاً
        // مجموعة "الإعدادات" (data-menu-key="users") التي تبقى صلاحية واحدة
        // موحّدة تتحكم بظهورها بالكامل (المستخدمين + رابط الأدوار المقفل أدناه)
        document.querySelectorAll('.menu-list > .menu-item[data-menu-key]').forEach(menuLi => {
            const menuKey = menuLi.getAttribute('data-menu-key');
            if (SIDEBAR_EXPANDABLE_GROUP_KEYS.includes(menuKey)) return; // تُعالَج بمنطق مستقل أدناه
            if (!window.Permissions.can('view', menuKey)) {
                menuLi.style.display = 'none';
            }
        });

        // "المالية"/"التقارير": كل رابط فرعي يُقيَّم بمفتاح صلاحيته الخاص، ثم
        // تُخفى المجموعة الأب بالكامل لو انتهى بها الأمر بلا أي رابط ظاهر
        // (بدل بقاء عنوان فارغ بلا أي محتوى تحته بالسايدبار)
        SIDEBAR_EXPANDABLE_GROUP_KEYS.forEach(groupKey => {
            const groupLi = document.querySelector(`.menu-list > .menu-item.has-submenu[data-menu-key="${groupKey}"]`);
            if (!groupLi) return;

            let visibleChildrenCount = 0;
            groupLi.querySelectorAll('.submenu > li').forEach(childLi => {
                const link = childLi.querySelector('a[href]');
                const href = link ? link.getAttribute('href') : null;
                const mapping = href ? SIDEBAR_SUBMENU_PERMISSION_MAP[href] : null;

                let allowed = true;
                if (mapping) {
                    const isObjectMapping = typeof mapping === 'object' && mapping !== null;
                    const permSection = isObjectMapping ? mapping.section : mapping;
                    const permAction = isObjectMapping && mapping.action ? mapping.action : 'view';
                    allowed = window.Permissions.can(permAction, permSection);
                }

                if (!allowed) {
                    childLi.style.display = 'none';
                } else {
                    visibleChildrenCount++;
                }
            });

            if (visibleChildrenCount === 0) groupLi.style.display = 'none';
        });

        // 🔒 "الأدوار والصلاحيات" مقفلة دائماً على مدير عام النظام فقط، بمعزل
        // عن أي صلاحية "settings" ممنوحة لدور آخر (التي تتحكم فقط بظهور "المستخدمين")
        const rolesLink = document.querySelector('.menu-list .submenu a[href="roles.html"]');
        if (rolesLink) {
            const rolesLi = rolesLink.closest('li');
            if (rolesLi) rolesLi.style.display = 'none';
        }

    } catch (err) {
        console.error('تعذّر تطبيق صلاحيات القوائم حسب الدور:', err.message);
    }
}