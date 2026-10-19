// =========================================================================
// 🛡️ محرّك الصلاحيات المركزي (Permissions Engine) — مصدر الحقيقة الوحيد لكل
// قرارات "من يرى ماذا، ومن يقدر يفعل ماذا" بجميع صفحات النظام.
//
// يُحمَّل هذا الملف بكل صفحة محمية (بعد icons.js وقبل app-core.js تقريباً)
// ويبدأ جلب دور المستخدم الحالي وصلاحياته فور تحميله مباشرة (بلا انتظار
// DOMContentLoaded) حتى يكتمل الجلب بالتوازي مع حقن السايدبار/النافبار.
//
// نموذج الصلاحيات: لكل "قسم" (section) أربعة إجراءات ممكنة: view / add /
// edit / delete، تُخزَّن بعمود role_permissions.menus كنصوص بصيغة
// "<action>:<section>" (مثال: "add:employees"). التوافق مع الإعدادات القديمة
// محفوظ تلقائياً (انظر normalizeRawMenus أدناه).
//
// طريقتا الاستخدام بكل صفحة محمية:
//   1) حراسة الوصول الكامل للصفحة: أول سطر بمستمع DOMContentLoaded الخاص
//      بملف الصفحة يجب أن يكون:
//          const allowed = await Permissions.guardPage('employees');
//          if (!allowed) return;
//      لو المستخدم لا يملك صلاحية "view" لهذا القسم، تُستبدَل كل محتويات
//      الصفحة برسالة "غير مصرح" فوراً ويتوقف تنفيذ باقي كود الصفحة.
//
//   2) إخفاء/إظهار أزرار الإجراءات (إضافة/تعديل/حذف) دون أي "وميض": أي عنصر
//      HTML (زر، رابط...) يحمل السمة data-perm="add:employees" يبقى مخفياً
//      تماماً منذ أول رسم للصفحة (عبر قاعدة CSS ثابتة بملف global-layout.css)
//      إلى أن يتأكد النظام من الصلاحية فيُظهره — لا يظهر الزر أبداً ثم يختفي؛
//      يبقى مخفياً افتراضياً ولا يظهر إلا بعد التأكد من الصلاحية. يمكن وضع
//      أكثر من صلاحية مفصولة بفاصلة (منطق "أو"): data-perm="edit:tasks,add:tasks".
//      لعناصر تُبنى ديناميكياً بالجافاسكريبت (صفوف جدول مثلاً)، استدعِ
//      Permissions.applyButtonGating() (أو مع تمرير عنصر حاوٍ محدد لتحسين
//      الأداء) بعد كل عملية رسم/تحديث للجدول.
// =========================================================================

const permissionsDbClient = dbClient;

// 📋 كل الأقسام القابلة للتخصيص بالنظام — مصدر واحد مشترك تستخدمه أيضاً شاشة
// "الأدوار والصلاحيات" (roles.js) لبناء جدول الصلاحيات ديناميكياً، حتى لا
// تحتاج لتعديل أكثر من ملف عند إضافة قسم جديد مستقبلاً.
//
// ⚠️ صفحة "الأدوار والصلاحيات" نفسها (roles.html) ليست ضمن هذه القائمة عمداً:
// وصولها مقفل دائماً على دور "مدير عام النظام" فقط بشكل ثابت بالكود (انظر
// Permissions.isSuperAdmin() بأول roles.js)، بمعزل تماماً عن أي إعداد صلاحيات
// قابل للتغيير من هذه الشاشة نفسها — لمنع أي دور آخر من منح نفسه صلاحيات
// إضافية عبر تعديل صلاحياته الخاصة.
//
// ⚠️ "لوحة التحكم" (dashboard) أيضاً ليست ضمن هذه القائمة عمداً: هي الصفحة
// الرئيسية التي يصل إليها أي مستخدم مسجّل دخول فور الدخول للنظام، فليست
// "قسم بيانات" قابل للتقييد مثل بقية الأقسام. صلاحية عرضها ممنوحة دائماً
// للجميع بشكل ثابت بالكود (انظر can() أدناه: حالة خاصة section === 'dashboard')
// — بمعزل تماماً عن أي إعداد محفوظ بجدول role_permissions، حتى لا يُحجب أي
// مستخدم عن صفحته الرئيسية بعد الدخول لمجرد أن إعداداً قديماً محفوظاً لدوره
// لم يتضمن صراحة كلمة "dashboard" (وهي بالضبط المشكلة التي ظهرت فعلياً حين
// أُضيفت حراسة هذه الصفحة أول مرة قبل هذا الاستثناء).
// 📂 بعض الأقسام تُقسَّم فعلياً إلى قوائم فرعية بالسايدبار (المالية ⇐ الفواتير
// + تحصيل الموظفين + أنواع التحصيل، التقارير ⇐ 7 تقارير مستقلة) — بدل صلاحية
// واحدة موحّدة تُظهر/تُخفي كل ما بداخلها معاً، أصبح لكل عنصر فرعي مفتاح صلاحية
// مستقل خاص به (children[].key)، فيمكن منح دور ما وصولاً لـ"الفواتير" فقط بلا
// "تحصيل الموظفين" مثلاً، أو لتقرير واحد بلا بقية التقارير. القسم الأب (finance/
// reports) نفسه أصبح مجرد عنوان تجميعي بجدول الصلاحيات وبالسايدبار، ولا
// يُستخدم بأي حارس صفحة أو data-perm مباشرة بعد الآن — انظر flattenPermissionSections
// وترقية normalizeRawMenus أدناه للتوافق مع الإعدادات المحفوظة قبل هذا التقسيم.
const PERMISSIONS_SECTIONS = [
    { key: 'employees', label: 'الموظفين', icon: 'person' },
    { key: 'employee_links', label: 'ربط الموظفين', icon: 'link' },
    { key: 'end_employee_link', label: 'إنهاء ربط موظف', icon: 'unlink' },
    { key: 'blacklist', label: 'القائمة السوداء', icon: 'blocked' },
    // 🆕 طلبات تسجيل الموظفين: مراجعة/موافقة/رفض طلبات إنشاء الحساب الذاتي
    // التي يرسلها الموظفون من شاشة "دخول الموظفين" (login-employee.html →
    // register-employee.html). لا معنى لصلاحيتي "إضافة"/"حذف" هنا (الطلبات
    // تُنشأ ذاتياً من الموظف نفسه، ولا تُحذف من هذه الشاشة) — فقط "عرض" (فتح
    // الشاشة) و"تعديل" (أزرار الموافقة/الرفض) تُعرَضان بجدول الصلاحيات.
    { key: 'employee_signup_requests', label: 'طلبات تسجيل الموظفين', icon: 'id-card', hiddenActions: ['add', 'delete'] },
    { key: 'companies', label: 'الشركات', icon: 'building' },
    { key: 'job_titles', label: 'المسميات الوظيفية', icon: 'tag' },
    { key: 'attendance', label: 'إدارة الحضور والانصراف', icon: 'clock' },
    { key: 'tasks', label: 'إدارة المهام', icon: 'clipboard' },
    {
        key: 'finance', label: 'المالية (الفواتير والتحصيل)', icon: 'bank',
        children: [
            // 🔒 قسم "الفواتير": صلاحية "إضافة" لم تعد تُعرَض هنا إطلاقاً (hiddenActions)
            // — أصبح إصدار فاتورة جديدة صلاحية مستقلة قائمة بذاتها (انظر
            // 'invoice_issuing' بالأسفل مباشرة) بدل الاعتماد على عمود "إضافة"
            // العام المشترك بين كل الأقسام. "عرض/تعديل/حذف" هنا تبقى كما هي
            // (عرض/طباعة الفاتورة، تعليم كمدفوعة، حذف الفاتورة على التوالي).
            { key: 'finance_invoices', label: 'الفواتير', icon: 'receipt', hiddenActions: ['add'] },
            // 🆕 صلاحية مستقلة قائمة بذاتها: "إصدار فاتورة" — لا علاقة لها بصلاحيات
            // عرض/تعديل/حذف الفواتير أعلاه، وتُعرَض بعمود "إضافة" فقط (بقية
            // الأعمدة معطّلة لهذا الصف عمداً عبر hiddenActions، فلا معنى لعرض/
            // تعديل/حذف منفصلَين لهذه الصلاحية). هذه هي الصلاحية التي تتحكم فعلياً
            // بظهور زر "+ إصدار فاتورة" بصفحة الفواتير وبإمكانية فتح/استخدام صفحة
            // إصدار فاتورة جديدة (add_invoice.html) — انظر مفتاح "add:invoice_issuing"
            // بكل من invoices.html وadd_invoice.html وadd_invoice.js.
            { key: 'invoice_issuing', label: 'إصدار فاتورة', icon: 'receipt', hiddenActions: ['view', 'edit', 'delete'] },
            { key: 'finance_collections', label: 'تحصيل الموظفين', icon: 'people' },
            // 🆕 أنواع التحصيل: شاشة إعداد طرق التحصيل (كاش/بنك/أي طريقة أخرى)
            // التي تظهر كخيار عند تعليم تحصيل موظف كمدفوع بشاشة "تحصيل
            // الموظفين" — صلاحية مستقلة بمعزل عن "تحصيل الموظفين" نفسها، حتى
            // يمكن منح من يدير التحصيل اليومي بلا السماح له بتعديل إعدادات
            // طرق التحصيل نفسها، أو العكس.
            { key: 'collection_types', label: 'أنواع التحصيل', icon: 'bank' }
        ]
    },
    {
        key: 'reports', label: 'التقارير', icon: 'chart-bar',
        children: [
            { key: 'reports_employees', label: 'تقرير الموظفين', icon: 'receipt' },
            { key: 'reports_companies', label: 'تقرير الشركات', icon: 'building' },
            // 🆕 تقرير ربط الشركات: يعرض روابط الموظفين بالشركات (اسم الموظف/رقم
            // الهوية/رقم الجوال/البريد الإلكتروني/حالة الربط) — وُضع مباشرة تحت
            // "تقرير الشركات" لارتباطه الوثيق به، وله مفتاح صلاحية مستقل خاص به
            // تماماً كبقية التقارير (انظر companies-links-report.html/js).
            { key: 'reports_company_links', label: 'تقرير ربط الشركات', icon: 'link' },
            { key: 'reports_collections', label: 'تقرير تحصيل الموظفين', icon: 'people' },
            { key: 'reports_companies_collections', label: 'تقرير تحصيل الشركات', icon: 'bank' },
            { key: 'reports_attendance', label: 'تقرير الحضور والانصراف', icon: 'clock' },
            { key: 'reports_tasks', label: 'تقرير المهام', icon: 'clipboard' }
        ]
    },
    { key: 'users', label: 'المستخدمين', icon: 'people' },
    { key: 'support', label: 'الدعم الفني', icon: 'headset' }
];

// =========================================================================
// 🔒 قائمة "عرض" (view) ثابتة بالكود لدور "مسؤول شركة" حصراً — بناءً على طلب
// صريح: قائمة مسؤول الشركة الجانبية يجب أن تكون موحّدة وثابتة لكل مسؤولي
// الشركات دائماً، بمعزل تماماً عن أي إعداد يُحفظ لهذا الدور بجدول
// role_permissions من شاشة "الأدوار والصلاحيات" — أي حتى لو غيّر مدير عام
// النظام هذه الإعدادات (تفعيلاً أو إلغاءً) لدور "company" تحديداً، لن يُطبَّق
// أي تغيير على ما يظهر لمسؤول الشركة. هذا استثناء متعمَّد يشبه تماماً استثناء
// "roles.html" المقفل دائماً على مدير عام النظام فقط بمعزل عن أي إعداد (انظر
// guardSuperAdminOnly أدناه) — نفس الفلسفة، لكن هنا لدور "company" وعلى مستوى
// صلاحية "عرض" فقط (لا تشمل إضافة/تعديل/حذف، التي تبقى قابلة للتخصيص كالمعتاد
// ضمن هذه الأقسام المسموح بعرضها).
//
// ⚠️ هذا لا يُخفي القوائم بالسايدبار فقط — بل يتحكم أيضاً بالوصول الفعلي عبر
// الرابط المباشر (Permissions.guardPage يستدعي can('view', ...) لكل صفحة)،
// فيمنع مسؤول الشركة من فتح أي صفحة خارج هذه القائمة حتى لو خمّن رابطها.
// =========================================================================
const COMPANY_ROLE_FIXED_VIEW_SECTIONS = new Set([
    'employees',
    'tasks',
    'attendance',
    'reports_employees',
    'reports_companies',
    // 🆕 مسؤول الشركة يرى دائماً تقرير ربط الشركات أيضاً (يخص فقط شركته/شركاته
    // المملوكة بفضل نطاق الرؤية المطبَّق داخل companies-links-report.js نفسه)،
    // بنفس فلسفة إتاحة "تقرير الشركات" له دائماً أعلاه.
    'reports_company_links',
    'reports_attendance',
    'reports_tasks',
    'finance_invoices',
    'support'
]);

// =========================================================================
// 🔒 مسؤول الشركة ليس مسؤولاً عن إصدار الفواتير: يرى الفواتير فقط (صلاحية
// "عرض" ثابتة أعلاه ضمن COMPANY_ROLE_FIXED_VIEW_SECTIONS) — ولا يمكنه أبداً
// إضافة فاتورة جديدة أو تعديل أو حذف أي فاتورة موجودة، بمعزل تماماً عن أي
// إعداد يُمنح له لاحقاً من شاشة "الأدوار والصلاحيات" لقسم "الفواتير"
// (finance_invoices). هذا استثناء إضافي ثابت بالكود، بنفس فلسفة
// COMPANY_ROLE_FIXED_VIEW_SECTIONS أعلاه تماماً، لكن بالاتجاه المعاكس: منع
// دائم (بدل سماح دائم) لا يمكن لأي إعداد لاحق تغييره.
// =========================================================================
const COMPANY_ROLE_BLOCKED_WRITE_SECTIONS = new Set([
    'finance_invoices',
    // 'invoice_issuing' أصبحت الصلاحية المستقلة الفعلية التي تتحكم بإصدار
    // الفاتورة (انظر تعليقها أعلى PERMISSIONS_SECTIONS) — تُضاف هنا أيضاً
    // لضمان بقاء مسؤول الشركة ممنوعاً منها دائماً، حتى بمعزل عن أن action
    // المستخدَم لإصدار الفاتورة أصبح "add:invoice_issuing" بدل "add:finance_invoices"
    'invoice_issuing'
]);

// 📋 نسخة "مسطّحة" من الأقسام أعلاه: الأقسام العادية كما هي، وأقسام finance/
// reports تُستبدَل بعناصرها الفرعية مباشرة (بدل القسم الأب نفسه) — هذه فقط
// هي المفاتيح التي تُستخدم فعلياً بـ can()/guardPage()/data-perm بالصفحات.
function flattenPermissionSections(sections) {
    const flat = [];
    sections.forEach(section => {
        if (Array.isArray(section.children) && section.children.length > 0) {
            section.children.forEach(child => flat.push({ ...child, parentKey: section.key }));
        } else {
            flat.push(section);
        }
    });
    return flat;
}
const PERMISSIONS_LEAF_SECTIONS = flattenPermissionSections(PERMISSIONS_SECTIONS);

const PERMISSIONS_ACTIONS = ['view', 'add', 'edit', 'delete'];
const PERMISSIONS_ACTION_LABELS_AR = { view: 'عرض', add: 'إضافة', edit: 'تعديل', delete: 'حذف' };

// خرائط عرض النصوص العربية للأدوار (مصدر مشترك يستخدمه roles.js أيضاً)
const PERMISSIONS_ROLE_LABELS_AR = {
    super_admin: 'مدير عام النظام',
    admin: 'مسؤول',
    company: 'مسؤول شركة',
    employee: 'موظف'
};

// =========================================================================
// 🔄 توافق مع الإعدادات القديمة: قبل هذا التحديث كان عمود menus يخزّن إما
// اسم القسم مجرداً (مثال: "employees" يعني "أظهر قائمة الموظفين بالسايدبار"،
// بلا تفريق بين عرض/إضافة/تعديل/حذف)، أو مفتاح إجراء دقيق واحد فقط
// ("action:attendance_bulk_add"). هذه الدالة تحوّل أي إعداد قديم محفوظ سابقاً
// إلى مجموعة صلاحيات دقيقة متوافقة، بحيث لا يفقد أي دور أي صلاحية كانت
// متاحة له فعلياً قبل هذا التحديث:
//   - وجود "employees" مجرداً بالمصفوفة  ⇐  يمنح كل الإجراءات الأربعة لقسم employees
//   - وجود "action:attendance_bulk_add"  ⇐  يمنح "add:attendance" أيضاً
//   - وجود مفتاح دقيق صريح مثل "view:employees" يُستخدم كما هو مباشرة
// =========================================================================
function normalizeRawMenus(rawMenus) {
    const grants = new Set();
    const list = Array.isArray(rawMenus) ? rawMenus : [];

    PERMISSIONS_LEAF_SECTIONS.forEach(section => {
        const key = section.key;
        const explicitActions = PERMISSIONS_ACTIONS.filter(action => list.includes(`${action}:${key}`));

        if (explicitActions.length > 0) {
            explicitActions.forEach(action => grants.add(`${action}:${key}`));
        } else if (list.includes(key)) {
            // إعداد قديم: وجود القسم مجرداً كان يعني إظهار كل شيء بلا تفريق
            PERMISSIONS_ACTIONS.forEach(action => grants.add(`${action}:${key}`));
        }
    });

    if (list.includes('action:attendance_bulk_add')) {
        grants.add('add:attendance');
    }

    // 🔄 توافق مع الإعدادات المحفوظة قبل فصل صلاحية "إصدار فاتورة" عن قسم
    // "الفواتير": أي دور كان قد مُنح "add:finance_invoices" (عمود "إضافة" العام
    // بصف "الفواتير" سابقاً) يرث تلقائياً الصلاحية الجديدة "add:invoice_issuing"
    // — حتى لا يفقد أي دور كان يقدر على إصدار الفواتير هذه القدرة فجأة بعد هذا
    // التحديث بلا أي تدخل يدوي من مدير عام النظام.
    if (list.includes('add:finance_invoices')) {
        grants.add('add:invoice_issuing');
    }

    // 🔄 توافق مع الإعدادات المحفوظة قبل تفكيك "المالية" و"التقارير" إلى قوائم
    // فرعية: أي دور كانت له صلاحية على القسم الأب مباشرة (مثلاً "view:finance"،
    // أو المفتاح المجرد القديم "finance") يرث تلقائياً نفس تلك الصلاحية على كل
    // عنصر فرعي تابع له — حتى لا يفقد أي دور وصولاً كان يملكه فعلياً قبل هذا
    // التحديث. يمكن تخصيص كل عنصر فرعي على حدة لاحقاً من شاشة "الأدوار والصلاحيات".
    PERMISSIONS_SECTIONS.forEach(section => {
        if (!Array.isArray(section.children) || section.children.length === 0) return;
        PERMISSIONS_ACTIONS.forEach(action => {
            const legacyGranted = list.includes(`${action}:${section.key}`) || list.includes(section.key);
            if (!legacyGranted) return;
            section.children.forEach(child => grants.add(`${action}:${child.key}`));
        });
    });

    return grants;
}

// =========================================================================
// 🌐 الحالة المُحلَّلة لصلاحيات المستخدم الحالي + وعد جاهزية (Ready Promise)
// =========================================================================
let _permState = { role: null, isSuperAdmin: false, grants: null }; // grants=null يعني "لا يوجد إعداد محفوظ ⇐ السماح بكل شيء افتراضياً" (نفس السلوك الآمن المعتمد سابقاً)

let _resolvePermissionsReady;
window.PermissionsReady = new Promise((resolve) => { _resolvePermissionsReady = resolve; });

async function initPermissions() {
    try {
        const { data: { session } } = await permissionsDbClient.auth.getSession();
        if (!session) {
            _permState = { role: null, isSuperAdmin: false, grants: null };

            // =================================================================
            // 🔒 لا توجد جلسة دخول نشطة إطلاقاً (لم يسجّل الدخول أصلاً، أو
            // انتهت صلاحية الجلسة، أو مسح المستخدم بيانات الموقع/الكوكيز يدوياً
            // من متصفحه). قبل هذا التحديث كانت الحالة أعلاه (grants=null) تُعامَل
            // بنفس منطق "دور موجود فعلاً بلا إعداد صلاحيات محفوظ بعد" فتُفتح كل
            // الصفحات المحمية بالخطأ (can() يُرجع true افتراضياً)، بينما كل
            // استعلامات سوبابيس بكود الصفحة نفسها تفشل بصمت لعدم وجود جلسة فعلية
            // — تظهر الصفحة "عالقة" بحالة تحميل لا تنتهي أو بيانات فارغة، بدل
            // توجيه واضح. هذا بالضبط ما كان يحدث عملياً عند مسح كوكيز/بيانات
            // الموقع (وليس فقط ملفات التخزين المؤقت) بمتصفح المستخدم. نحوّله
            // الآن فوراً للصفحة الرئيسية (index.html) — بنفس الوجهة المستخدمة
            // أصلاً بتسجيل الخروج العادي (انظر window.handleLogout بملف
            // navbar.js) ونص الترجمة الجاهز مسبقاً "sessionExpired" بملفي
            // ar.json/en.json — لكن مركزياً هنا مرة واحدة فيغطي تلقائياً كل
            // صفحة تستخدم محرك الصلاحيات هذا، بلا حاجة لتكرار نفس الفحص يدوياً
            // بكل ملف جافاسكريبت مستقل بكل صفحة.
            // =================================================================
            const currentPage = window.location.pathname.split('/').pop();
            if (currentPage && currentPage !== 'index.html') {
                window.location.replace(Routes.url('index'));
            }
            return;
        }

        const { data: profileRow } = await permissionsDbClient
            .from('users')
            .select('role')
            .eq('id', session.user.id)
            .maybeSingle();

        const role = profileRow?.role || null;

        // مدير عام النظام: كل الصلاحيات دائماً، بلا استثناء وبلا حاجة لاستعلام إضافي
        if (role === 'super_admin') {
            _permState = { role, isSuperAdmin: true, grants: null };
            return;
        }

        const { data: permissionRow } = await permissionsDbClient
            .from('role_permissions')
            .select('menus')
            .eq('role', role)
            .maybeSingle();

        if (!permissionRow || !Array.isArray(permissionRow.menus)) {
            // لا يوجد إعداد محفوظ بعد لهذا الدور ⇐ السماح بكل شيء افتراضياً (نقطة بداية آمنة، حتى لا يُحجب أحد بالخطأ قبل ضبط الصلاحيات من شاشة "الأدوار والصلاحيات")
            _permState = { role, isSuperAdmin: false, grants: null };
        } else {
            _permState = { role, isSuperAdmin: false, grants: normalizeRawMenus(permissionRow.menus) };
        }
    } catch (err) {
        console.error('تعذّر تحميل صلاحيات المستخدم الحالي:', err.message);
        // فشل الشبكة أو غيره: كإجراء آمن افتراضي لا نحجب المستخدم بسبب خطأ تقني عابر
        _permState = { role: null, isSuperAdmin: false, grants: null };
    } finally {
        _resolvePermissionsReady();
    }
}

initPermissions(); // يبدأ فوراً عند تحميل هذا الملف، بالتوازي مع حقن السايدبار/النافبار

// =========================================================================
// 🖥️ شاشة "غير مصرح" الموحّدة — تحل محل محتوى الصفحة بالكامل (تُبقي السايدبار
// والنافبار كما هما ليتمكن المستخدم من التنقل لصفحة أخرى يملك صلاحية عرضها)
// =========================================================================
function renderPermissionsUnauthorizedView() {
    const container = document.querySelector('.dashboard-container')
        || document.querySelector('.page-container')
        || document.querySelector('main.main-content');
    if (!container) return;

    const isEnglish = document.documentElement.getAttribute('lang') === 'en';

    container.innerHTML = `
        <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:60vh; text-align:center; padding:40px 20px;">
            <div style="width:76px; height:76px; border-radius:50%; background:#fef2f2; display:flex; align-items:center; justify-content:center; margin-bottom:20px;">
                <span style="font-size:34px;">🔒</span>
            </div>
            <h2 style="color:#1e293b; font-size:20px; font-weight:700; margin-bottom:10px;">
                ${isEnglish ? 'Access Denied' : 'غير مصرح لك بالوصول لهذه الصفحة'}
            </h2>
            <p style="color:#64748b; font-size:14px; max-width:440px; line-height:1.9; margin-bottom:26px;">
                ${isEnglish
                    ? "You don't have permission to view this page. If you believe this is a mistake, contact your system administrator."
                    : 'ليست لديك الصلاحية اللازمة لعرض هذه الصفحة. إن كنت تعتقد أن هذا خطأ، تواصل مع مسؤول النظام لمراجعة صلاحيات دورك من شاشة "الأدوار والصلاحيات".'}
            </p>
            <a href="dashboard.html" style="background:#0f172a; color:#ffffff; padding:11px 26px; border-radius:8px; text-decoration:none; font-weight:600; font-size:14px;">
                ${isEnglish ? '← Back to Dashboard' : 'العودة للوحة التحكم ←'}
            </a>
        </div>
    `;

    // إخفاء شاشة التحميل فوراً (إن كانت لا تزال ظاهرة) حتى لا تحجب رسالة عدم التصريح
    const loader = document.getElementById('pageLoader');
    if (loader) loader.classList.add('loader-hidden');

    // محتوى الحاوية استُبدل للتو برسالة "غير مصرح" أعلاه — أظهرها الآن (كانت
    // مخفية افتراضياً بـ CSS عبر global-layout.css، انظر revealGuardedPageContent
    // أدناه لشرح كامل الآلية)
    revealGuardedPageContent();
}

// =========================================================================
// 🛡️ إظهار محتوى الصفحة الرئيسي (.dashboard-container / .page-container)
// بعد اكتمال قرار guardPage()/guardSuperAdminOnly() بالسماح أو الرفض — هذا
// المحتوى مخفي افتراضياً بـ CSS منذ أول رسم للصفحة (visibility:hidden بملف
// global-layout.css)، تماماً كفلسفة إخفاء [data-perm]، لمنع ظهور محتوى الصفحة
// الخام (عناوين جدول، فلاتر، بيانات...) للحظة قبل اكتمال التحقق غير الفوري من
// الصلاحيات (استعلام Supabase) ثم اختفائه/استبداله فجأة برسالة "غير مصرح" —
// وميض غير مقبول أمنياً وبصرياً. تُستدعى دائماً بعد اكتمال القرار، سواء بالسماح
// (فيظهر المحتوى الحقيقي) أو بالرفض (فتظهر رسالة "غير مصرح" أعلاه).
// =========================================================================
function revealGuardedPageContent() {
    document.querySelectorAll('.dashboard-container, .page-container').forEach(el => {
        el.style.visibility = 'visible';
    });
}

// 🛟 شبكة أمان: لو تعذّر تحميل permissions.js لأي سبب، أو احتوت صفحة ما على
// .dashboard-container/.page-container (المخفيَين افتراضياً بـ CSS) دون أن
// تستدعي guardPage()/guardSuperAdminOnly() إطلاقاً، لا يبقى محتواها مخفياً
// للأبد بالخطأ — يُظهَر قسراً بعد مهلة أقصاها 6 ثوانٍ (نفس مهلة app-core.js
// الاحتياطية لشاشة التحميل)
setTimeout(revealGuardedPageContent, 6000);

// =========================================================================
// 🔓 كائن Permissions العام — واجهة الاستخدام من كل صفحات النظام
// =========================================================================
window.Permissions = {
    SECTIONS: PERMISSIONS_SECTIONS,
    ACTIONS: PERMISSIONS_ACTIONS,
    ACTION_LABELS_AR: PERMISSIONS_ACTION_LABELS_AR,
    ROLE_LABELS_AR: PERMISSIONS_ROLE_LABELS_AR,
    normalizeRawMenus,

    isSuperAdmin() {
        return _permState.isSuperAdmin;
    },

    getRole() {
        return _permState.role;
    },

    /**
     * هل يملك المستخدم الحالي صلاحية "action" على القسم "section"؟
     * ⚠️ يجب استدعاؤها فقط بعد اكتمال window.PermissionsReady (أو عبر guardPage
     * الذي ينتظرها ضمناً) وإلا فقد تُقيَّم بناءً على حالة أولية غير محسومة بعد.
     */
    can(action, section) {
        if (_permState.isSuperAdmin) return true;
        // 🏠 "لوحة التحكم" مستثناة دائماً من نظام التقييد — انظر التعليق أعلى
        // PERMISSIONS_SECTIONS. أي مستخدم مسجّل دخول يملك صلاحية "view" عليها
        // دائماً بغض النظر عن أي إعداد محفوظ (لا يوجد إجراءات إضافة/تعديل/حذف
        // أصلاً لهذا القسم، فلا داعي لتقييد أي إجراء آخر عليه أيضاً).
        if (section === 'dashboard') return true;
        // 🔒 مسؤول الشركة: صلاحية "عرض" ثابتة بالكود (انظر
        // COMPANY_ROLE_FIXED_VIEW_SECTIONS أعلى الملف) — غير قابلة للتخصيص من
        // شاشة "الأدوار والصلاحيات" إطلاقاً. صلاحيات الإضافة/التعديل/الحذف
        // تبقى قابلة للتخصيص كالمعتاد عبر الإعداد المحفوظ أدناه — باستثناء
        // الأقسام المذكورة صراحة بـ COMPANY_ROLE_BLOCKED_WRITE_SECTIONS أدناه.
        if (_permState.role === 'company' && action === 'view') {
            return COMPANY_ROLE_FIXED_VIEW_SECTIONS.has(section);
        }
        // 🔒 مسؤول الشركة: ممنوع دائماً من إضافة/تعديل/حذف أي قسم ضمن
        // COMPANY_ROLE_BLOCKED_WRITE_SECTIONS (حالياً: الفواتير finance_invoices)
        // — بمعزل تماماً عن أي إعداد يُمنح له لاحقاً من شاشة "الأدوار والصلاحيات".
        // انظر التعليق أعلى تعريف الثابت لشرح كامل السبب.
        if (_permState.role === 'company' && action !== 'view' && COMPANY_ROLE_BLOCKED_WRITE_SECTIONS.has(section)) {
            return false;
        }
        if (_permState.grants === null) return true; // لا يوجد إعداد محفوظ لهذا الدور بعد ⇐ مسموح افتراضياً
        return _permState.grants.has(`${action}:${section}`);
    },

    /**
     * حارس وصول الصفحة الكاملة — يجب استدعاؤه أول سطر فعلي داخل مستمع
     * DOMContentLoaded بملف كل صفحة محمية. يُعيد true لو مسموحاً بالمتابعة،
     * أو false بعد استبدال محتوى الصفحة برسالة "غير مصرح" (على المستدعي حينها
     * إيقاف تنفيذ باقي كوده فوراً عبر `return`).
     *
     * المعامل الثاني `action` اختياري ويبقى "view" افتراضياً (كل الاستدعاءات
     * القديمة بكل صفحات النظام لا تُمرِّره إطلاقاً فتستمر بالعمل بلا أي تغيير) —
     * أُضيف خصيصاً لأجل صفحات تُحرَس بصلاحية غير "عرض" مباشرة، مثل صفحة "إصدار
     * فاتورة جديدة" (add_invoice.html) التي تُستدعى بـ
     * guardPage('invoice_issuing', 'add') لأن صلاحية "إصدار فاتورة" المستقلة
     * لا تملك إجراء "عرض" أصلاً (انظر hiddenActions بتعريفها أعلى الملف).
     */
    async guardPage(section, action = 'view') {
        await window.PermissionsReady;
        if (this.can(action, section)) {
            this.applyButtonGating();
            // 🛡️ إظهار محتوى الصفحة (كان مخفياً افتراضياً بـ CSS منذ أول رسم —
            // انظر revealGuardedPageContent أعلى الملف لشرح كامل الآلية)
            revealGuardedPageContent();
            return true;
        }
        renderPermissionsUnauthorizedView(); // تُظهر محتوى الحاوية بنفسها بعد استبداله برسالة "غير مصرح"
        return false;
    },

    /**
     * حارس خاص لصفحة "الأدوار والصلاحيات" (roles.html) حصراً: وصولها مقفل
     * دائماً على دور "مدير عام النظام" فقط، بمعزل تماماً عن أي إعداد صلاحيات
     * قابل للتخصيص من هذه الشاشة نفسها — لمنع أي دور آخر (حتى لو مُنح صلاحية
     * "settings"/"users" بالخطأ أو عمداً) من الوصول لشاشة تتحكم بصلاحيات كل
     * الأدوار (بما فيها صلاحياته الخاصة) ومنح نفسه صلاحيات أوسع ذاتياً.
     */
    async guardSuperAdminOnly() {
        await window.PermissionsReady;
        if (this.isSuperAdmin()) {
            revealGuardedPageContent();
            return true;
        }
        renderPermissionsUnauthorizedView();
        return false;
    },

    /**
     * يكشف/يُبقي مخفياً كل عنصر يحمل السمة data-perm ضمن الحاوية المُمرَّرة
     * (المستند بالكامل افتراضياً). يُستدعى تلقائياً من guardPage() مرة واحدة
     * عند تحميل الصفحة، ويجب استدعاؤه يدوياً أيضاً بعد أي إعادة رسم ديناميكية
     * لعناصر تحمل هذه السمة (صفوف جدول جديدة مثلاً) كي تُطبَّق عليها نفس القاعدة.
     */
    applyButtonGating(root) {
        const scope = root || document;
        scope.querySelectorAll('[data-perm]').forEach(el => {
            const raw = el.getAttribute('data-perm');
            if (!raw) return;
            const allowed = raw.split(',').some(pair => {
                const [action, section] = pair.trim().split(':');
                return this.can(action, section);
            });
            if (allowed) el.removeAttribute('data-perm');
        });
    }
};
