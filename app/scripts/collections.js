// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================

// =========================================================================
// شاشة "تحصيل الموظفين": تسجيل تحصيل الرسوم الشهرية (صافي الراتب) الخاصة
// بموظفي "اضافة" فقط (employee_links.link_type = 'اضافة') — بلا أي علاقة
// بالفواتير، فقط حالة "مدفوع/غير مدفوع" + تفاصيل التحصيل (تاريخ التحصيل،
// المبلغ المستلم، الملاحظات) لكل موظف عن كل شهر على حدة، عبر جدول
// employee_collections (employee_link_id + collection_month فريدان معاً).
//
// ⚠️ يتطلب هذا الملف وجود جدول employee_collections التالي بسوبابيس:
//   CREATE TABLE employee_collections (
//     id bigserial PRIMARY KEY,
//     employee_link_id integer NOT NULL REFERENCES employee_links(id) ON DELETE CASCADE,
//     collection_month date NOT NULL,          -- أول يوم من الشهر، مثال: 2026-08-01
//     amount numeric NOT NULL DEFAULT 0,       -- نسخة من المبلغ المستحق (بعد التناسب إن وُجد) وقت آخر تحديث لحالة هذا الشهر
//     received_amount numeric NOT NULL DEFAULT 0,  -- المبلغ الفعلي المستلم من الموظف (قد يكون جزئياً)
//     status text NOT NULL DEFAULT 'unpaid',
//     paid_at timestamptz,                     -- تاريخ/وقت التحصيل الفعلي (قابل للتعديل يدوياً)
//     notes text,
//     created_at timestamptz NOT NULL DEFAULT now(),
//     UNIQUE (employee_link_id, collection_month)
//   );
//   ALTER TABLE employee_collections ENABLE ROW LEVEL SECURITY;
//   CREATE POLICY "authenticated full access" ON employee_collections FOR ALL TO authenticated USING (true) WITH CHECK (true);
//
//   -- إن كان الجدول قد أُنشئ سابقاً بدون عمود received_amount، نفّذ فقط:
//   ALTER TABLE employee_collections ADD COLUMN IF NOT EXISTS received_amount numeric NOT NULL DEFAULT 0;
//
// 🗓️ المبلغ المستحق عن الشهر المختار لا يُؤخذ دائماً كامل الصافي، بل يُحسب
// "حتى تاريخه" (Accrual-to-date): يُقارَن نطاق ربط الموظف (employee_links
// .link_date إلى link_end_date، أو حتى الآن إن لم يُحدَّد تاريخ انتهاء) بالشهر
// المختار، ولا يُحتسب أي يوم بعد تاريخ اليوم الفعلي إطلاقاً — حتى لو كان
// الربط لا يزال نشطاً بلا تاريخ انتهاء. لذلك:
//   • الأشهر المنقضية بالكامل (شهور سابقة): تُحتسب كامل الصافي إن غطّاها
//     الربط بالكامل، أو تناسبياً إن بدأ/انتهى الربط خلالها.
//   • الشهر الجاري (لم ينتهِ بعد): المستحق يزداد يومياً بحسب عدد الأيام التي
//     مضت فعلياً من الشهر حتى اليوم — وليس افتراض الشهر كاملاً مقدَّماً.
//   • عند إنهاء ربط موظف خلال الشهر: يُحتسب المستحق بعدد الأيام حتى تاريخ
//     الفصل بالضبط (سواء كان تاريخ الفصل ماضياً أو لاحقاً، يبقى هو الحد
//     الأقصى للأيام المحتسبة عن ذلك الشهر).
// كل ذلك على أساس شهر تجاري ثابت من 30 يوماً عند الحساب التناسبي (نفس
// اتفاقية شاشة "إصدار فاتورة جديدة"). الموظف الذي لا يتقاطع ربطه إطلاقاً مع
// الشهر المختار (ربط مستقبلي، أو انتهى قبل بداية الشهر، أو شهر مستقبلي لم
// يبدأ منه شيء بعد) لا يظهر بجدول ذلك الشهر أصلاً.
//
// ⚠️ ملاحظة هامة: بمجرد انتهاء ربط موظف (تسجيل link_end_date عبر شاشة "إنهاء
// ربط موظف")، فإنه يختفي تلقائياً من جدول التحصيل الرئيسي بمجرد ألا يبقى له
// أي مستحق عن الشهر المختار حالياً (overlapDays = 0، أي عادة بعد أول شهر
// كامل يلي تاريخ الإنهاء) — هذا سلوك مقصود، إذ لا يوجد مبلغ مستحق فعلياً عن
// ذلك الشهر. لمعرفة/مراجعة الموظفين الذين انتهى ربطهم، انظر جدول "العقود
// المنتهية" المنفصل أسفل الجدول الرئيسي (localEndedLinksCache/renderEndedLinksTable).
//
// ملاحظة: اسم الموظف بجدول هذه الشاشة رابط ينقل لصفحة مستقلة
// (employee-collection-details.html?linkId=...) تعرض بيانات الموظف وكامل
// سجل تحصيله الشهري عبر كل الأشهر — انظر ذلك الملف.
//
// 🆕 عمود "المبلغ المستلم" أصبح ظاهراً الآن كعمود مستقل بجدول هذه الشاشة
// (بين عمودي "المستحق" و"المتبقي")، بدل الاطلاع عليه فقط عبر فتح نافذة
// "تعديل" لكل موظف على حدة — القيمة (row.receivedAmount) كانت مُحتسبة أصلاً
// ضمن fetchAndRenderCollections، فقط لم تكن تُعرض كعمود بالجدول من قبل.
//
// 🆕 زر "تعليم كمدفوع" السريع (toggleCollectionStatus) أصبح يعرض الآن المبلغ
// المستحق المحسوب كقيمة مبدئية قابلة للتعديل (عبر prompt) قبل التأكيد النهائي،
// بدل تعليمه كمدفوع مباشرة بلا تدخل — يتيح تصحيح المبلغ يدوياً عند الحاجة
// (مثلاً خصم متفق عليه). القيمة المُدخلة تُحفظ بعمودي amount وreceived_amount
// معاً. وبناءً عليه، السجلات المُعلَّمة "مدفوع" تعرض الآن هذا المبلغ المحفوظ
// فعلياً (وليس المُعاد حسابه حياً من تاريخ اليوم) ضمن fetchAndRenderCollections
// — لتفادي أن يظل "المستحق" يكبر يوماً بعد يوم بشهر جارٍ رغم تعليم الموظف
// كمدفوع بالكامل فعلاً. السجلات غير المدفوعة تبقى على مسار الاستحقاق الحي كالمعتاد.
//
// 🆕 عمود "تاريخ ربط الموظف" أصبح ظاهراً الآن بجدول هذه الشاشة (بين عمودي
// "رقم الهوية" و"الشركة") — يعرض employee_links.link_date (تاريخ بدء ربط
// الموظف بالشركة عبر شاشة "ربط الموظفين")، وكان يُجلب أصلاً لاحتساب
// "المستحق" التراكمي (computeLinkDueForMonth) دون أن يُعرض كعمود مستقل من قبل.
//
// 🆕 جدول "العقود المنتهية": قائمة منفصلة أسفل الجدول الرئيسي تعرض كل روابط
// "اضافة" التي انتهت فعلياً (employee_links.link_end_date وصل أو تجاوز تاريخ
// اليوم الفعلي — سواء بإنهاء يدوي عبر شاشة "إنهاء ربط موظف"، أو بوصول تاريخ
// الانتهاء التلقائي المحسوب عند الربط [سنة كاملة من تاريخ الربط]) — الهدف
// إبقاء الموظفين المُنهى ربطهم فعلياً مرئيين دائماً كمرجع (بدل اختفائهم كلياً
// من الشاشة)، مع رابط مباشر لعرض سجل تحصيلهم الكامل عبر كل الأشهر. مصدر
// بياناتها additionLinks نفسه المُستخدم بالجدول الرئيسي (لا طلب شبكة إضافي)،
// فقط بفلترة/ترتيب مختلفين (الأحدث انتهاءً أولاً)، بمعزل تام عن منطق الاستحقاق
// الشهري وبيانات employee_collections.
//
// ⚠️ إصلاح مهم: بما أن link_end_date يُحسب تلقائياً دائماً (سنة كاملة من تاريخ
// الربط) حتى لو لم يُنهِ أحد الربط يدوياً، كان هذا الجدول سابقاً يُظهر خطأً
// *كل* موظفي الإضافة (بمن فيهم النشطون فعلياً بعقد لم ينتهِ بعد، فقط لأن له
// تاريخ انتهاء متوقع مستقبلي) — تم تقييد الفلترة الآن لتشترط أن يكون تاريخ
// الانتهاء قد مضى أو هو اليوم فعلاً (link_end_date <= اليوم)، فلا يظهر بهذا
// الجدول إلا من انتهى ربطه بالفعل (يدوياً أو تلقائياً ببلوغ تاريخ الانتهاء).
// =========================================================================

let localCollectionsCache = [];    // دمج بيانات الروابط (اضافة) + سجل تحصيل الشهر المختار
let filteredCollectionsCache = [];
let currentCollectionPage = 1;
const collectionsPerPage = 15;
let currentMonthValue = '';        // بصيغة YYYY-MM (من حقل <input type="month">)

// 🆕 قائمة "العقود المنتهية" (روابط اضافة لها link_end_date ماضٍ أو اليوم) + تقسيم صفحاتها
// المستقل — منفصلة تماماً عن localCollectionsCache/filteredCollectionsCache
let localEndedLinksCache = [];
let filteredEndedLinksCache = [];   // 🆕 بعد تطبيق بحث قسم "العقود المنتهية" المستقل (searchEndedLinks)
let currentEndedLinksPage = 1;
const endedLinksPerPage = 15;

// 🆕 طرق التحصيل "النشطة" فقط (تُدار من شاشة الإعدادات "أنواع التحصيل") —
// تُحمَّل مرة واحدة عند تحميل الصفحة وتُستخدم لتعبئة قائمتي الاختيار بنافذتي
// "تعليم كمدفوع" و"تعديل بيانات التحصيل" (انظر collection_types_setup.sql)
let activeCollectionTypesCache = [];

// =========================================================================
// 🛡️ نطاق رؤية المستخدم الحالي — نفس المنطق المستخدم بباقي شاشات النظام:
// مسؤول الشركة (role='company') يرى فقط تحصيل موظفي شركته/شركاته المملوكة،
// والموظف (role='employee') يرى سجل تحصيله الشخصي فقط (وهو بيانات مالية
// حساسة: صافي الراتب الشهري والمبالغ المستلمة/المتبقية)، بينما super_admin/
// admin يريان كل السجلات بلا قيود.
//
// ⚠️ إصلاح أمني حرج: هذه الشاشة لم تكن تحتوي إطلاقاً على أي تقييد بحسب
// الدور — كانت تجلب دائماً تحصيل *كل* الموظفين بكل الشركات، بما فيها رقم
// الهوية الوطنية وصافي الراتب، طالما يملك المستخدم صلاحية عرض القسم فقط.
let currentUserScope = { role: null, companyIds: null, employeeId: null };

async function loadCurrentUserScope() {
    try {
        const { data: { session } } = await dbClient.auth.getSession();
        if (!session) return;

        const { data: profileRow } = await dbClient.from('users').select('role').eq('id', session.user.id).maybeSingle();
        const role = profileRow?.role || null;

        if (role === 'company') {
            const { data: ownedCompanies } = await dbClient.from('companies').select('id').eq('user_id', session.user.id);
            currentUserScope = { role, companyIds: (ownedCompanies || []).map(c => c.id), employeeId: null };
        } else if (role === 'employee') {
            const { data: employeeRow } = await dbClient.from('employees').select('id').eq('user_id', session.user.id).maybeSingle();
            // employeeId = -1 لو تعذّر إيجاد سجل موظف مرتبط بهذا الحساب، حتى لا
            // يُفسَّر عدم التقييد بالخطأ ⇐ عرض تحصيل كل الموظفين
            currentUserScope = { role, companyIds: null, employeeId: employeeRow ? employeeRow.id : -1 };
        } else {
            currentUserScope = { role, companyIds: null, employeeId: null };
        }
    } catch (error) {
        console.error('تعذّر تحديد نطاق صلاحيات المستخدم الحالي:', error.message);
    }
}

// =========================================================================
// 🆕 طرق التحصيل: جلب الطرق "النشطة" فقط (تُدار من شاشة "أنواع التحصيل")
// وتعبئتها بقائمتي الاختيار بنافذتي "تعليم كمدفوع" و"تعديل بيانات التحصيل"
// =========================================================================
async function loadActiveCollectionTypes() {
    try {
        const { data, error } = await dbClient
            .from('collection_types')
            .select('id, name')
            .eq('status', 'active')
            .order('name', { ascending: true });
        if (error) throw new Error(error.message);
        activeCollectionTypesCache = data || [];
    } catch (error) {
        console.error('تعذّر تحميل طرق التحصيل:', error.message);
        activeCollectionTypesCache = [];
    }
    populateCollectionMethodSelect('markPaidMethod', null);
    populateCollectionMethodSelect('collectionModalMethod', null);
}

// يملأ عنصر <select> بطرق التحصيل النشطة، مع إضافة طريقة السجل الحالي حتى لو
// أصبحت "موقَفة" لاحقاً (حتى لا تختفي بصمت عند فتح نافذة تعديل لسجل قديم)
function populateCollectionMethodSelect(selectId, selectedId, selectedLabel) {
    const select = document.getElementById(selectId);
    if (!select) return;

    const options = [...activeCollectionTypesCache];
    if (selectedId != null && !options.some(o => String(o.id) === String(selectedId))) {
        options.push({ id: selectedId, name: (selectedLabel || 'طريقة موقَفة') + ' (موقَفة)' });
    }

    select.innerHTML = '<option value="">— اختر طريقة التحصيل —</option>' +
        options.map(o => `<option value="${o.id}">${o.name}</option>`).join('');
    select.value = selectedId != null ? String(selectedId) : '';
}

// =========================================================================
// جلب كامل صفوف جدول ما على دفعات (Pagination) — سوبابيس (PostgREST) يفرض
// حداً افتراضياً 1000 صف كحد أقصى لكل طلب (نفس الحل المعتمد بباقي شاشات المنصة)
// =========================================================================
const COLLECTIONS_FETCH_PAGE_SIZE = 1000;
async function fetchAllRows(builderFactory) {
    let allRows = [];
    let from = 0;
    while (true) {
        const { data, error } = await builderFactory(from, from + COLLECTIONS_FETCH_PAGE_SIZE - 1);
        if (error) throw error;
        allRows = allRows.concat(data || []);
        if (!data || data.length < COLLECTIONS_FETCH_PAGE_SIZE) break;
        from += COLLECTIONS_FETCH_PAGE_SIZE;
    }
    return allRows;
}

document.addEventListener('DOMContentLoaded', async () => {
    const allowed = await Permissions.guardPage('finance_collections');
    if (!allowed) return;

    await loadCurrentUserScope();
    await loadActiveCollectionTypes();

    const monthPicker = document.getElementById('collectionMonthPicker');

    // الشهر الحالي الفعلي (وقت تحميل الصفحة بالمتصفح) كقيمة افتراضية
    const now = new Date();
    currentMonthValue = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    if (monthPicker) {
        monthPicker.value = currentMonthValue;
        monthPicker.addEventListener('change', () => {
            currentMonthValue = monthPicker.value || currentMonthValue;
            fetchAndRenderCollections();
        });
    }

    fetchAndRenderCollections();

    const editForm = document.getElementById('editCollectionForm');
    if (editForm) editForm.addEventListener('submit', handleEditCollectionSubmit);
});

// 💰 تنسيق القيم المالية بمنزلتين عشريتين بأرقام إنجليزية دائماً
function formatCollectionCurrency(value) {
    const num = parseFloat(value);
    if (isNaN(num)) return '0.00';
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
}

// 📅 تنسيق تاريخ/وقت بصيغة DD/MM/YYYY
function formatCollectionDate(dateStr) {
    if (!dateStr) return '—';
    const datePart = String(dateStr).split('T')[0];
    const parts = datePart.split('-');
    if (parts.length !== 3) return String(dateStr);
    const [y, m, d] = parts;
    return `${d}/${m}/${y}`;
}

// 📅 تاريخ اليوم بصيغة YYYY-MM-DD حسب توقيت جهاز المستخدم (نفس اتفاقية
// end_employee_link.js) — يُستخدم لتحديد هل تاريخ انتهاء ربط ما مضى فعلاً
function getTodayDateString() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

// =========================================================================
// 🗓️ حساب المبلغ المستحق فعلياً عن الشهر المختار "حتى تاريخه" — بناءً على
// تداخل فترة ربط الموظف (link_date → link_end_date) مع الشهر، مع عدم احتساب
// أي يوم مستقبلي بعد تاريخ اليوم الفعلي (سواء لعدم انتهاء الشهر بعد، أو
// لتاريخ فصل مستقبلي) — تناسبياً على أساس شهر تجاري ثابت من 30 يوماً إن كانت
// الفترة المحتسبة أقل من الشهر بالكامل (بنفس اتفاقية شاشة إصدار الفواتير).
// =========================================================================

// 📅 تحويل نص تاريخ YYYY-MM-DD إلى كائن Date بمنتصف الليل المحلي
function parseCollectionDateOnly(dateStr) {
    return new Date(dateStr + 'T00:00:00');
}

// 🔢 عدد أيام شهر تقويمي فعلي مُعيّن (month بالترقيم صفري كما في Date)
function daysInCollectionCalendarMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
}

// ثابت: شهر تجاري من 30 يوماً دائماً كأساس للمعدل اليومي عند الاستحقاق
// التناسبي — نفس الاتفاقية المعتمدة بشاشة "إصدار فاتورة جديدة"
const COLLECTION_PRORATION_DAYS_PER_MONTH = 30;

// 🔁 عدد أيام تداخل فترة الربط مع الشهر المختار (year/month بالترقيم الصفري)،
// محسوبة "حتى تاريخ اليوم" فقط — لا تُحتسب أي أيام مستقبلية لم تأتِ بعد، حتى
// لو كان الربط لا يزال نشطاً بلا تاريخ انتهاء (فيتوقف الاحتساب عند اليوم
// الحالي بدل افتراض اكتمال الشهر مقدَّماً)
function computeLinkOverlapWithMonth(linkDateStr, linkEndDateStr, year, month) {
    const monthStart = new Date(year, month, 1);
    const monthCalendarEnd = new Date(year, month, daysInCollectionCalendarMonth(year, month));

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // "حتى تاريخه": الحد الأقصى للأيام المحتسبة بهذا الشهر هو الأقل بين آخر
    // يوم فعلي بالشهر وبين اليوم الحالي — بلا أثر على الأشهر المنقضية بالكامل
    const accrualEnd = monthCalendarEnd < today ? monthCalendarEnd : today;

    const linkStart = linkDateStr ? parseCollectionDateOnly(linkDateStr) : null;
    const linkEnd = linkEndDateStr ? parseCollectionDateOnly(linkEndDateStr) : null;

    const effectiveStart = (linkStart && linkStart > monthStart) ? linkStart : monthStart;
    const effectiveEnd = (linkEnd && linkEnd < accrualEnd) ? linkEnd : accrualEnd;

    if (effectiveEnd < effectiveStart) {
        return { overlapDays: 0, isFullMonth: false };
    }

    const overlapDays = Math.round((effectiveEnd - effectiveStart) / 86400000) + 1;
    const isFullMonth = effectiveStart.getTime() === monthStart.getTime() && effectiveEnd.getTime() === monthCalendarEnd.getTime();
    return { overlapDays, isFullMonth };
}

// 💰 المبلغ المستحق عن الشهر المختار حتى تاريخه: كامل الصافي إن غطّى الربط
// الشهر بالكامل (شهر منقضٍ فعلاً)، أو محسوباً تناسبياً على أساس شهر من 30
// يوماً إن بدأ الربط أو انتهى خلال الشهر، أو إن كان الشهر الجاري لم ينتهِ
// بعد. overlapDays = 0 يعني أنه لا شيء مستحق بعد عن هذا الشهر إطلاقاً
function computeLinkDueForMonth(netSalaryValue, linkDateStr, linkEndDateStr, year, month) {
    const baseValue = parseFloat(netSalaryValue) || 0;
    const { overlapDays, isFullMonth } = computeLinkOverlapWithMonth(linkDateStr, linkEndDateStr, year, month);

    if (overlapDays <= 0) return { dueAmount: 0, overlapDays: 0, isFullMonth: false };
    if (isFullMonth) return { dueAmount: Math.round(baseValue * 100) / 100, overlapDays, isFullMonth: true };

    const dailyRate = baseValue / COLLECTION_PRORATION_DAYS_PER_MONTH;
    return { dueAmount: Math.round(dailyRate * overlapDays * 100) / 100, overlapDays, isFullMonth: false };
}

// 📊 جلب موظفي "اضافة" (الروابط النشطة) مع بيانات الموظف والشركة، ثم دمجها
// بسجل تحصيل الشهر المختار (إن وُجد) — الموظف بلا سجل تحصيل لهذا الشهر يُعامَل
// كـ"غير مدفوع" افتراضياً بمبلغ مستلم صفر (متبقي = كامل المستحق) بلا الحاجة
// لإنشاء صف بقاعدة البيانات مسبقاً. الروابط التي لا تتقاطع إطلاقاً مع الشهر
// المختار (بدأت لاحقاً، أو انتهت قبل بدايته، أو لم يمضِ منها شيء بعد إن كان
// شهراً مستقبلياً) تُستبعَد من الجدول تماماً (لكنها تبقى ظاهرة، إن انتهى
// ربطها فعلياً، بجدول "العقود المنتهية" المنفصل أسفله — انظر localEndedLinksCache).
async function fetchAndRenderCollections() {
    const tableBody = document.getElementById('collectionsTableBody');
    const endedTableBody = document.getElementById('endedLinksTableBody');
    if (!tableBody) return;

    tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding: 40px; color:#94a3b8;">جاري جلب بيانات التحصيل...</td></tr>`;
    if (endedTableBody) endedTableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 30px; color:#94a3b8;">جاري جلب بيانات العقود المنتهية...</td></tr>`;

    try {
        const additionLinks = await fetchAllRows((from, to) => {
            let q = dbClient.from('employee_links')
                .select('id, employee_id, company_id, job_title, net_salary_value, link_date, link_end_date, employees(name, national_id), companies(name)')
                .eq('link_type', 'اضافة')
                .order('id', { ascending: true })
                .range(from, to);
            // 🛡️ تقييد بنطاق المستخدم الحالي (انظر تعليق نطاق الرؤية أعلى الملف)
            if (currentUserScope.companyIds !== null) q = q.in('company_id', currentUserScope.companyIds);
            if (currentUserScope.employeeId !== null) q = q.eq('employee_id', currentUserScope.employeeId);
            return q;
        });

        const monthDateStr = `${currentMonthValue}-01`;
        const [monthYearStr, monthNumStr] = currentMonthValue.split('-');
        const selectedYear = parseInt(monthYearStr, 10);
        const selectedMonthIndex = parseInt(monthNumStr, 10) - 1;

        // 🛡️ تقييد إضافي (دفاع بعمق): لو كان نطاق المستخدم مُقيَّداً، نجلب فقط
        // سجلات التحصيل الخاصة بروابطه المسموح بها (additionLinks أعلاه، وهي
        // مُقيَّدة بالفعل)، بدل جلب سجلات تحصيل كل الموظفين عبر الشبكة لمجرد
        // عدم عرضها لاحقاً بالجدول.
        const allowedLinkIds = (currentUserScope.companyIds !== null || currentUserScope.employeeId !== null)
            ? additionLinks.map(l => l.id)
            : null;

        const collectionRows = allowedLinkIds !== null && allowedLinkIds.length === 0
            ? []
            : await fetchAllRows((from, to) => {
                let q = dbClient.from('employee_collections')
                    .select('employee_link_id, amount, received_amount, status, paid_at, notes, collection_type_id, collection_types(name)')
                    .eq('collection_month', monthDateStr)
                    .range(from, to);
                if (allowedLinkIds !== null) q = q.in('employee_link_id', allowedLinkIds);
                return q;
            });

        const collectionByLinkId = new Map();
        collectionRows.forEach(row => collectionByLinkId.set(String(row.employee_link_id), row));

        localCollectionsCache = additionLinks
            .map(link => {
                const netSalaryValue = link.net_salary_value != null ? parseFloat(link.net_salary_value) : 0;
                const dueInfo = computeLinkDueForMonth(netSalaryValue, link.link_date, link.link_end_date, selectedYear, selectedMonthIndex);

                // لا شيء مستحق بعد عن هذا الشهر (لا تداخل، أو شهر مستقبلي لم
                // يبدأ منه شيء بعد): لا داعٍ لإظهار الموظف بجدول هذا الشهر تحديداً
                if (dueInfo.overlapDays <= 0) return null;

                const collection = collectionByLinkId.get(String(link.id));
                const receivedAmount = collection && collection.received_amount != null ? parseFloat(collection.received_amount) : 0;

                // 🆕 السجلات المؤكَّدة "مدفوع" تعتمد على المبلغ المحفوظ فعلياً بقاعدة
                // البيانات (collection.amount) بدل إعادة حسابه حياً من تاريخ اليوم —
                // لأن المستخدم قد يكون عدَّل هذا المبلغ يدوياً عند التعليم كمدفوع
                // (انظر toggleCollectionStatus)، ولتفادي أن يظل "المستحق" يكبر يوماً
                // بعد يوم بشهر جارٍ رغم أن الموظف مُعلَّم كمدفوع بالكامل فعلاً (ما كان
                // يجعل "المتبقي" يظهر كمبلغ موجب زائف رغم شارة "مدفوع"). السجلات غير
                // المدفوعة تبقى تماماً على مسار الاستحقاق التراكمي الحي كما كان.
                const isPaidRecord = !!(collection && collection.status === 'paid');
                const dueAmount = (isPaidRecord && collection.amount != null) ? parseFloat(collection.amount) : dueInfo.dueAmount;
                const remaining = Math.max(dueAmount - receivedAmount, 0);

                return {
                    linkId: link.id,
                    employeeName: (link.employees && link.employees.name) ? link.employees.name : '----',
                    nationalId: (link.employees && link.employees.national_id) ? link.employees.national_id : '----',
                    // 🆕 تاريخ بدء ربط الموظف بالشركة (employee_links.link_date) —
                    // كان يُجلب أصلاً فقط لاحتساب الاستحقاق التراكمي، وأصبح الآن
                    // يُعرض أيضاً كعمود مستقل بجدول هذه الشاشة
                    linkDate: link.link_date || null,
                    // 🆕 تاريخ انتهاء الربط (employee_links.link_end_date) — يُعرض مع
                    // تاريخ الربط بسطر واحد تحت رقم الهوية (تاريخ الربط - تاريخ الانتهاء)
                    linkEndDate: link.link_end_date || null,
                    companyName: (link.companies && link.companies.name) ? link.companies.name : '----',
                    jobTitle: link.job_title || '----',
                    netSalaryValue,           // كامل الصافي الشهري المرجعي (بغض النظر عن التناسب)
                    dueAmount,                // المستحق المعروض: محفوظ (إن كان مدفوعاً ومُعدَّلاً) أو محسوب حياً
                    isFullMonth: isPaidRecord ? true : dueInfo.isFullMonth,
                    overlapDays: dueInfo.overlapDays,
                    receivedAmount,
                    remaining,
                    status: collection ? (collection.status || 'unpaid') : 'unpaid',
                    paidAt: collection ? collection.paid_at : null,
                    notes: collection ? (collection.notes || '') : '',
                    // 🆕 طريقة التحصيل المُختارة عند تعليم هذا الشهر كمدفوع (قد تكون
                    // فارغة لسجلات قديمة أُنشئت قبل إضافة هذه الميزة)
                    collectionTypeId: collection ? collection.collection_type_id : null,
                    collectionTypeName: (collection && collection.collection_types && collection.collection_types.name) ? collection.collection_types.name : null
                };
            })
            .filter(Boolean);

        // 🆕 قائمة "العقود المنتهية" — كل روابط "اضافة" التي انتهت فعلياً حتى
        // تاريخ اليوم (link_end_date <= اليوم)، سواء بإنهاء يدوي عبر شاشة "إنهاء
        // ربط موظف" أو ببلوغ تاريخ الانتهاء التلقائي المحسوب عند الربط — بمعزل
        // تام عن الشهر المختار أعلاه ومنطق الاستحقاق الشهري، مرتبة تنازلياً
        // بتاريخ الإنهاء (الأحدث انتهاءً أولاً). ⚠️ لا يكفي وجود link_end_date
        // فقط (كل الروابط لها تاريخ انتهاء متوقع محسوب تلقائياً سنة كاملة من
        // تاريخ الربط، حتى النشطة منها فعلياً) — يُشترط أن يكون هذا التاريخ قد
        // مضى أو هو اليوم بالضبط، وإلا يُعامَل الموظف كموظف نشط عادي.
        const todayStr = getTodayDateString();
        localEndedLinksCache = additionLinks
            .filter(link => !!link.link_end_date && String(link.link_end_date).split('T')[0] <= todayStr)
            .map(link => ({
                linkId: link.id,
                employeeName: (link.employees && link.employees.name) ? link.employees.name : '----',
                nationalId: (link.employees && link.employees.national_id) ? link.employees.national_id : '----',
                companyName: (link.companies && link.companies.name) ? link.companies.name : '----',
                jobTitle: link.job_title || '----',
                linkDate: link.link_date || null,
                linkEndDate: link.link_end_date
            }))
            .sort((a, b) => String(b.linkEndDate || '').localeCompare(String(a.linkEndDate || '')));

    } catch (error) {
        console.error('تعذّر تحميل بيانات تحصيل الموظفين:', error.message);
        tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:#ef4444; padding:20px;">فشل تحميل بيانات التحصيل: ${(error && error.message) || 'خطأ غير معروف'}. تأكد من إنشاء جدول 'employee_collections' (بعمود received_amount) بقاعدة بيانات سوبابيس.</td></tr>`;
        if (endedTableBody) endedTableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#ef4444; padding:20px;">تعذّر تحميل بيانات العقود المنتهية.</td></tr>`;
        return;
    }

    currentCollectionPage = 1;
    searchCollections();

    currentEndedLinksPage = 1;
    searchEndedLinks();
}

// 📈 تحديث بطاقات الإحصائيات الأربع بناءً على كامل بيانات الشهر الحالي (قبل الفلترة)
// المحصَّل/المتبقي هنا يعتمدان على المبلغ المستلم الفعلي لكل موظف (وليس فقط
// حالة مدفوع/غير مدفوع)، لأن التحصيل قد يكون جزئياً الآن. "إجمالي المستحق"
// يعتمد على المبلغ المستحق الفعلي حتى تاريخه (dueAmount) وليس كامل الصافي دائماً.
function updateCollectionStats() {
    const totalCount = localCollectionsCache.length;
    let totalDue = 0, totalReceived = 0;

    localCollectionsCache.forEach(row => {
        totalDue += parseFloat(row.dueAmount) || 0;
        totalReceived += parseFloat(row.receivedAmount) || 0;
    });
    const totalRemaining = Math.max(totalDue - totalReceived, 0);

    const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    setText('statEmployeeCount', totalCount);
    setText('statTotalDue', formatCollectionCurrency(totalDue));
    setText('statTotalPaid', formatCollectionCurrency(totalReceived));
    setText('statTotalUnpaid', formatCollectionCurrency(totalRemaining));
}

// 📑 بناء صفوف الجدول (مع تقسيم صفحات)
function renderCollectionsTable(data) {
    const tableBody = document.getElementById('collectionsTableBody');
    if (!tableBody) return;
    RowActions.closeMenu();
    tableBody.innerHTML = '';

    if (!data || data.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:30px; color:#94a3b8;">لا توجد بيانات مطابقة لخيارات البحث الحالية.</td></tr>`;
        setupCollectionsPaginationControls(0);
        return;
    }

    const startIndex = (currentCollectionPage - 1) * collectionsPerPage;
    const endIndex = startIndex + collectionsPerPage;
    const paginatedData = data.slice(startIndex, endIndex);

    paginatedData.forEach(row => {
        const tr = document.createElement('tr');
        const isPaid = row.status === 'paid';
        const statusBadgeClass = isPaid ? 'status-badge-active' : 'status-badge-unpaid';
        const statusLabel = isPaid ? 'مدفوع' : 'غير مدفوع';
        const hasRemaining = row.remaining > 0.004; // هامش صغير لتفادي أخطاء الفاصلة العشرية
        const remainingClass = hasRemaining ? 'has-remaining' : 'no-remaining';

        // 📌 عند وجود استحقاق جزئي (شهر جارٍ لم ينتهِ بعد، أو بداية/نهاية ربط
        // خلال الشهر) نعرض عدد الأيام المحتسبة تحت المبلغ، مع تلميح (title)
        // يوضّح كامل الصافي الشهري للمقارنة
        const dueTitleAttr = !row.isFullMonth
            ? ` title="الصافي الكامل: ${formatCollectionCurrency(row.netSalaryValue)} — المستحق حتى الآن عن ${row.overlapDays} يوم من ${COLLECTION_PRORATION_DAYS_PER_MONTH}"`
            : '';
        const dueProratedNote = !row.isFullMonth
            ? `<div class="due-prorated-note">(${row.overlapDays} يوم)</div>`
            : '';

        // 🆕 عمود "الموظف": الاسم + اسم الشركة بسطر ثانوي رمادي تحته، بدل عمود
        // "الشركة" المنفصل السابق. عمود "رقم الهوية": الرقم + (تاريخ الربط - تاريخ انتهاء الربط)
        // بسطر ثانوي واحد تحته، بدل عمود "تاريخ ربط الموظف" المنفصل السابق.
        tr.innerHTML = `
            <td>
                <div class="employee-name-link">${row.employeeName}</div>
                <div class="collection-subtext">${row.companyName}</div>
            </td>
            <td class="collection-national-id-cell">
                <div>${row.nationalId}</div>
                <div class="collection-subtext" style="white-space:nowrap;">${formatCollectionDate(row.linkDate)} - ${formatCollectionDate(row.linkEndDate)}</div>
            </td>
            <td class="collection-net-cell"${dueTitleAttr} style="text-align:center;">${formatCollectionCurrency(row.dueAmount)}${dueProratedNote}</td>
            <td class="collection-received-cell" style="text-align:center;">${formatCollectionCurrency(row.receivedAmount)}</td>
            <td class="collection-remaining-cell ${remainingClass}" style="text-align:center;">${formatCollectionCurrency(row.remaining)}</td>
            <td style="text-align:center;"><span class="${statusBadgeClass}">${statusLabel}</span></td>
            <td style="text-align:center;">
                <div style="font-family: monospace;">${row.paidAt ? formatCollectionDate(row.paidAt) : '—'}</div>
                ${row.collectionTypeName ? `<div class="collection-subtext">${row.collectionTypeName}</div>` : ''}
            </td>
            <td style="text-align:center;"><div class="ra-actions-cell">${RowActions.viewBtnHtml('view:finance_collections', 'عرض تفاصيل الموظف ودفعات السداد')}${RowActions.moreBtnHtml('edit:finance_collections')}</div></td>
        `;

        // 🆕 السطر بالكامل قابل للنقر (ينقل لصفحة تفاصيل الموظف ودفعات السداد)،
        // وعمود الإجراءات: أيقونة عين + زر ثلاث نقاط (⋮) تفتح قائمة فيها
        // تعليم كمدفوع / إلغاء التعليم، وتعديل بيانات التحصيل (انظر row-actions.js)
        RowActions.bindRow(tr, {
            rowTitle: 'عرض تفاصيل الموظف ودفعات السداد',
            onView: () => { window.location.href = `${Routes.url('employee-collection-details')}?linkId=${row.linkId}`; },
            getMenuItems: () => [
                isPaid
                    ? { perm: 'edit:finance_collections', icon: ICONS.refresh, label: 'إلغاء تعليم كمدفوع', run: () => toggleCollectionStatus(row.linkId, 'unpaid') }
                    : { perm: 'edit:finance_collections', icon: ICONS['check-circle'], label: 'تعليم كمدفوع', run: () => toggleCollectionStatus(row.linkId, 'paid') },
                { perm: 'edit:finance_collections', icon: ICONS.edit, label: 'تعديل بيانات التحصيل', run: () => openEditCollectionModal(row.linkId) }
            ]
        });

        tableBody.appendChild(tr);
    });

    if (window.applyIconPlaceholders) applyIconPlaceholders(tableBody);
    setupCollectionsPaginationControls(data.length);

    // 🛡️ أزرار الصف أعلاه (تعليم كمدفوع/إلغاء التعليم، تعديل) بُنيت للتو
    // ديناميكياً وتحمل السمة data-perm — يجب تطبيق حارس الصلاحيات عليها يدوياً
    // هنا لإظهارها فقط لمن يملك الصلاحية المطابقة (تُستدعى هذه الدالة أيضاً
    // بكل إعادة رسم عبر البحث/الفلترة/التنقل بين الصفحات/تغيير الشهر، فتغطي
    // كل حالات إعادة الرسم تلقائياً).
    Permissions.applyButtonGating(tableBody);
}

// 📟 بناء وتحديث أزرار الصفحات
function setupCollectionsPaginationControls(totalItems) {
    const controlsContainer = document.getElementById('collectionsPaginationControls');
    if (!controlsContainer) return;
    controlsContainer.innerHTML = '';

    const totalPages = Math.ceil(totalItems / collectionsPerPage);
    if (totalPages <= 1) return;

    const prevBtn = document.createElement('button');
    prevBtn.innerHTML = '&rarr; السابقة';
    prevBtn.disabled = currentCollectionPage === 1;
    prevBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;';
    if (prevBtn.disabled) prevBtn.style.opacity = '0.5';
    prevBtn.onclick = () => {
        if (currentCollectionPage > 1) {
            currentCollectionPage--;
            renderCollectionsTable(filteredCollectionsCache);
        }
    };
    controlsContainer.appendChild(prevBtn);

    const countLabel = document.createElement('span');
    countLabel.style.cssText = 'font-size: 0.9rem; color: #475569; font-weight: 600; font-family: system-ui, sans-serif;';
    countLabel.textContent = `صفحة ${currentCollectionPage} من ${totalPages}`;
    controlsContainer.appendChild(countLabel);

    const nextBtn = document.createElement('button');
    nextBtn.innerHTML = 'التالية &larr;';
    nextBtn.disabled = currentCollectionPage === totalPages;
    nextBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;';
    if (nextBtn.disabled) nextBtn.style.opacity = '0.5';
    nextBtn.onclick = () => {
        if (currentCollectionPage < totalPages) {
            currentCollectionPage++;
            renderCollectionsTable(filteredCollectionsCache);
        }
    };
    controlsContainer.appendChild(nextBtn);
}

// =========================================================================
// 🆕 جدول "العقود المنتهية": عرض بسيط (بلا مبالغ/حالة تحصيل) لكل موظفي
// الإضافة الذين انتهى ربطهم فعلياً — مرجع دائم بمعزل عن الشهر المختار أعلاه،
// مع رابط "عرض السجل" لصفحة تفاصيل الموظف الكاملة (كل أشهر تحصيله السابقة)
// =========================================================================
function renderEndedLinksTable() {
    const tableBody = document.getElementById('endedLinksTableBody');
    if (!tableBody) return;
    tableBody.innerHTML = '';

    if (!filteredEndedLinksCache || filteredEndedLinksCache.length === 0) {
        const emptyMessage = (localEndedLinksCache && localEndedLinksCache.length > 0)
            ? 'لا توجد نتائج مطابقة لبحثك ضمن العقود المنتهية.'
            : 'لا توجد عقود منتهية حالياً.';
        tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; color:#94a3b8;">${emptyMessage}</td></tr>`;
        setupEndedLinksPaginationControls(0);
        return;
    }

    const startIndex = (currentEndedLinksPage - 1) * endedLinksPerPage;
    const endIndex = startIndex + endedLinksPerPage;
    const paginatedData = filteredEndedLinksCache.slice(startIndex, endIndex);

    paginatedData.forEach(row => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><a href="employee-collection-details.html?linkId=${row.linkId}" class="employee-name-link" title="عرض تفاصيل الموظف وسجل تحصيله">${row.employeeName}</a></td>
            <td class="collection-national-id-cell">${row.nationalId}</td>
            <td style="color:#334155;">${row.companyName}</td>
            <td style="color:#475569;">${row.jobTitle}</td>
            <td style="text-align:center; font-family: monospace; color:#475569;">${formatCollectionDate(row.linkDate)}</td>
            <td style="text-align:center; font-family: monospace; color:#b45309; font-weight:600;">${formatCollectionDate(row.linkEndDate)}</td>
            <td style="text-align:center;"><a href="employee-collection-details.html?linkId=${row.linkId}" style="color:#2563eb; font-weight:600; text-decoration:underline; font-size:12.5px;">عرض السجل</a></td>
        `;
        tableBody.appendChild(tr);
    });

    setupEndedLinksPaginationControls(filteredEndedLinksCache.length);
}

// 🔍 بحث مستقل داخل جدول "العقود المنتهية" (اسم الموظف/رقم الهوية/اسم الشركة)
// — بمعزل تام عن بحث الجدول الرئيسي أعلاه (searchCollections/localCollectionsCache)
function searchEndedLinks() {
    const text = (document.getElementById('endedLinksSearchInput')?.value || '').toLowerCase().trim();

    filteredEndedLinksCache = !text
        ? localEndedLinksCache
        : localEndedLinksCache.filter(row =>
            row.employeeName.toLowerCase().includes(text) ||
            row.nationalId.toLowerCase().includes(text) ||
            row.companyName.toLowerCase().includes(text)
        );

    currentEndedLinksPage = 1;
    renderEndedLinksTable();
}

// 📟 أزرار تنقل صفحات جدول "العقود المنتهية" — نفس نمط setupCollectionsPaginationControls تماماً، بمعزل عن تقسيم صفحات الجدول الرئيسي
function setupEndedLinksPaginationControls(totalItems) {
    const controlsContainer = document.getElementById('endedLinksPaginationControls');
    if (!controlsContainer) return;
    controlsContainer.innerHTML = '';

    const totalPages = Math.ceil(totalItems / endedLinksPerPage);
    if (totalPages <= 1) return;

    const prevBtn = document.createElement('button');
    prevBtn.innerHTML = '&rarr; السابقة';
    prevBtn.disabled = currentEndedLinksPage === 1;
    prevBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;';
    if (prevBtn.disabled) prevBtn.style.opacity = '0.5';
    prevBtn.onclick = () => {
        if (currentEndedLinksPage > 1) {
            currentEndedLinksPage--;
            renderEndedLinksTable();
        }
    };
    controlsContainer.appendChild(prevBtn);

    const countLabel = document.createElement('span');
    countLabel.style.cssText = 'font-size: 0.9rem; color: #475569; font-weight: 600; font-family: system-ui, sans-serif;';
    countLabel.textContent = `صفحة ${currentEndedLinksPage} من ${totalPages}`;
    controlsContainer.appendChild(countLabel);

    const nextBtn = document.createElement('button');
    nextBtn.innerHTML = 'التالية &larr;';
    nextBtn.disabled = currentEndedLinksPage === totalPages;
    nextBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;';
    if (nextBtn.disabled) nextBtn.style.opacity = '0.5';
    nextBtn.onclick = () => {
        if (currentEndedLinksPage < totalPages) {
            currentEndedLinksPage++;
            renderEndedLinksTable();
        }
    };
    controlsContainer.appendChild(nextBtn);
}

// 🔍 دالة البحث: تجمع البحث النصي الحر (اسم الموظف/رقم الهوية/اسم الشركة) مع فلتر الحالة
function searchCollections() {
    const text = (document.getElementById('collectionSearchInput')?.value || '').toLowerCase().trim();
    const statusValue = document.getElementById('collectionStatusFilter')?.value || 'all';

    filteredCollectionsCache = localCollectionsCache.filter(row => {
        const matchesText = !text
            || row.employeeName.toLowerCase().includes(text)
            || row.nationalId.toLowerCase().includes(text)
            || row.companyName.toLowerCase().includes(text);
        const matchesStatus = statusValue === 'all' || row.status === statusValue;
        return matchesText && matchesStatus;
    });

    currentCollectionPage = 1;
    updateCollectionStats();
    renderCollectionsTable(filteredCollectionsCache);
}

// ✅ تبديل حالة تحصيل موظف عن الشهر المختار حالياً (مدفوع ⇄ غير مدفوع) بشكل سريع.
// 🆕 التعليم كمدفوع لم يعد يعتمد على prompt() المتصفح — يفتح الآن نافذة
// "تعليم تحصيل كمدفوع" التي تُلزم باختيار طريقة التحصيل وتاريخ التحصيل، مع
// إمكانية تعديل المبلغ المستحق المقترح وإضافة ملاحظة اختيارية (انظر
// handleMarkPaidSubmit أدناه). إلغاء التعليم كمدفوع يبقى تأكيداً مباشراً بلا
// حاجة لهذه الحقول (لا معنى لطريقة/تاريخ تحصيل لسجل أصبح غير مدفوع).
async function toggleCollectionStatus(linkId, newStatus) {
    const row = localCollectionsCache.find(r => String(r.linkId) === String(linkId));
    if (!row) return;

    if (newStatus === 'paid') {
        openMarkPaidModal(linkId);
        return;
    }

    if (!confirm('هل تريد إلغاء تعليم تحصيل هذا الموظف عن هذا الشهر كمدفوع؟')) return;

    const payload = {
        employee_link_id: parseInt(linkId, 10),
        collection_month: `${currentMonthValue}-01`,
        amount: parseFloat(row.dueAmount) || 0,
        received_amount: 0,
        status: 'unpaid',
        paid_at: null,
        collection_type_id: null,
        notes: row.notes || null
    };

    try {
        const { data: upsertedRows, error } = await dbClient
            .from('employee_collections')
            .upsert([payload], { onConflict: 'employee_link_id,collection_month' })
            .select();

        if (error) throw error;
        if (!upsertedRows || upsertedRows.length === 0) {
            alert("لم يتم حفظ حالة التحصيل فعلياً. تحقق من وجود سياسات إضافة/تعديل (RLS INSERT/UPDATE Policies) على جدول employee_collections في سوبابيس.");
            return;
        }

        await fetchAndRenderCollections();
    } catch (error) {
        console.error('Toggle Collection Status Error:', error);
        alert('فشلت العملية: ' + error.message);
    }
}

// =========================================================================
// 🆕 نافذة "تعليم تحصيل كمدفوع": طريقة التحصيل وتاريخ التحصيل إلزاميان، مع
// إمكانية تعديل المبلغ المستحق المقترح (كما كان متاحاً سابقاً عبر prompt())
// وإضافة ملاحظة اختيارية تُحفظ مباشرة على نفس سجل تحصيل هذا الشهر
// =========================================================================
function openMarkPaidModal(linkId) {
    const row = localCollectionsCache.find(r => String(r.linkId) === String(linkId));
    if (!row) return;

    document.getElementById('markPaidLinkId').value = row.linkId;
    document.getElementById('markPaidEmployeeName').value = `${row.employeeName} — ${row.companyName}`;
    document.getElementById('markPaidAmount').value = (parseFloat(row.dueAmount) || 0).toFixed(2);
    document.getElementById('markPaidDate').value = getTodayDateString();
    document.getElementById('markPaidNotes').value = row.notes || '';

    populateCollectionMethodSelect('markPaidMethod', row.collectionTypeId, row.collectionTypeName);

    document.getElementById('error-mark_paid_amount').textContent = '';
    document.getElementById('error-mark_paid_method').textContent = '';
    document.getElementById('error-mark_paid_date').textContent = '';
    hideMarkPaidModalAlert();

    document.getElementById('markPaidModal').classList.add('open');
}

function closeMarkPaidModal() {
    document.getElementById('markPaidModal').classList.remove('open');
}

function showMarkPaidModalAlert(message) {
    const alertBox = document.getElementById('markPaidModalAlert');
    alertBox.textContent = message;
    alertBox.className = 'form-alert alert-error';
    alertBox.style.display = 'block';
}
function hideMarkPaidModalAlert() {
    const alertBox = document.getElementById('markPaidModalAlert');
    if (alertBox) alertBox.style.display = 'none';
}

async function handleMarkPaidSubmit(event) {
    event.preventDefault();
    hideMarkPaidModalAlert();

    const linkId = document.getElementById('markPaidLinkId').value;
    const row = localCollectionsCache.find(r => String(r.linkId) === String(linkId));
    if (!row) return;

    const amountRaw = document.getElementById('markPaidAmount').value.trim();
    const methodValue = document.getElementById('markPaidMethod').value;
    const dateValue = document.getElementById('markPaidDate').value;
    const notesValue = document.getElementById('markPaidNotes').value.trim();

    let isValid = true;

    const amountNum = parseFloat(amountRaw);
    if (amountRaw === '' || isNaN(amountNum) || amountNum < 0) {
        document.getElementById('error-mark_paid_amount').textContent = 'الرجاء إدخال مبلغ مستحق صحيح (رقم موجب أو صفر).';
        isValid = false;
    } else {
        document.getElementById('error-mark_paid_amount').textContent = '';
    }

    if (!methodValue) {
        document.getElementById('error-mark_paid_method').textContent = 'الرجاء اختيار طريقة التحصيل.';
        isValid = false;
    } else {
        document.getElementById('error-mark_paid_method').textContent = '';
    }

    if (!dateValue) {
        document.getElementById('error-mark_paid_date').textContent = 'الرجاء تحديد تاريخ التحصيل.';
        isValid = false;
    } else {
        document.getElementById('error-mark_paid_date').textContent = '';
    }

    if (!isValid) return;

    const dueValue = Math.round(amountNum * 100) / 100;

    const submitBtn = event.target.querySelector('.btn-modal-save');
    const originalText = submitBtn ? submitBtn.textContent : '';
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'جاري الحفظ...'; }

    const payload = {
        employee_link_id: parseInt(linkId, 10),
        collection_month: `${currentMonthValue}-01`,
        amount: dueValue,
        received_amount: dueValue,
        status: 'paid',
        paid_at: new Date(dateValue + 'T12:00:00').toISOString(),
        collection_type_id: parseInt(methodValue, 10),
        notes: notesValue || null
    };

    try {
        const { data: upsertedRows, error } = await dbClient
            .from('employee_collections')
            .upsert([payload], { onConflict: 'employee_link_id,collection_month' })
            .select();

        if (error) throw error;
        if (!upsertedRows || upsertedRows.length === 0) {
            showMarkPaidModalAlert('لم يتم حفظ حالة التحصيل فعلياً. تحقق من وجود سياسات إضافة/تعديل (RLS INSERT/UPDATE Policies) على جدول employee_collections في سوبابيس.');
            return;
        }

        closeMarkPaidModal();
        await fetchAndRenderCollections();
    } catch (error) {
        console.error('Mark Paid Error:', error);
        showMarkPaidModalAlert('فشلت العملية: ' + error.message);
    } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = originalText; }
    }
}

// =========================================================================
// ✏️ نافذة تعديل تفاصيل التحصيل: تاريخ التحصيل + المبلغ المستلم + الملاحظات
// =========================================================================
function openEditCollectionModal(linkId) {
    const row = localCollectionsCache.find(r => String(r.linkId) === String(linkId));
    if (!row) return;

    document.getElementById('collectionModalLinkId').value = row.linkId;
    document.getElementById('collectionModalEmployeeName').value = `${row.employeeName} — ${row.companyName}`;
    document.getElementById('collectionModalPaidDate').value = row.paidAt ? String(row.paidAt).split('T')[0] : '';
    document.getElementById('collectionModalReceivedAmount').value = row.receivedAmount || '';
    document.getElementById('collectionModalNotes').value = row.notes || '';
    populateCollectionMethodSelect('collectionModalMethod', row.collectionTypeId, row.collectionTypeName);

    hideCollectionModalAlert();
    document.getElementById('editCollectionModal').classList.add('open');
}

function closeEditCollectionModal() {
    document.getElementById('editCollectionModal').classList.remove('open');
}

function showCollectionModalAlert(message, type) {
    const alertBox = document.getElementById('collectionModalAlert');
    if (!alertBox) return;
    alertBox.textContent = message;
    alertBox.className = 'form-alert ' + (type === 'success' ? 'alert-success' : 'alert-error');
    alertBox.style.display = 'block';
}
function hideCollectionModalAlert() {
    const alertBox = document.getElementById('collectionModalAlert');
    if (alertBox) alertBox.style.display = 'none';
}

// 💾 حفظ تعديلات التحصيل — يُشتق status تلقائياً من مقارنة المبلغ المستلم
// بالمبلغ المستحق عن هذا الشهر حتى تاريخه (dueAmount، بعد التناسب إن وُجد):
// مستلم بالكامل (أو أكثر) ⇐ "مدفوع"، أي شيء أقل ⇐ "غير مدفوع" (حتى لو كان
// تحصيلاً جزئياً)، بحيث يبقى شارة الحالة متسقة دائماً مع عمود "المتبقي"
async function handleEditCollectionSubmit(event) {
    event.preventDefault();
    hideCollectionModalAlert();

    const linkId = document.getElementById('collectionModalLinkId').value;
    const row = localCollectionsCache.find(r => String(r.linkId) === String(linkId));
    if (!row) return;

    const paidDateRaw = document.getElementById('collectionModalPaidDate').value;
    const methodValue = document.getElementById('collectionModalMethod').value;
    const receivedAmountRaw = document.getElementById('collectionModalReceivedAmount').value.trim();
    const notesRaw = document.getElementById('collectionModalNotes').value.trim();

    let receivedAmount = 0;
    if (receivedAmountRaw !== '') {
        receivedAmount = parseFloat(receivedAmountRaw);
        if (isNaN(receivedAmount) || receivedAmount < 0) {
            showCollectionModalAlert('الرجاء إدخال مبلغ مستلم صحيح (رقم موجب) أو ترك الحقل فارغاً.', 'error');
            return;
        }
    }

    const dueValue = parseFloat(row.dueAmount) || 0;
    const newStatus = (dueValue > 0 && receivedAmount >= dueValue) ? 'paid' : 'unpaid';

    const submitBtn = event.target.querySelector('.btn-modal-save');
    const originalText = submitBtn ? submitBtn.textContent : '';
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'جاري الحفظ...'; }

    const payload = {
        employee_link_id: parseInt(linkId, 10),
        collection_month: `${currentMonthValue}-01`,
        amount: dueValue,
        received_amount: receivedAmount,
        status: newStatus,
        // إن أدخل المستخدم تاريخاً صريحاً نستخدمه (منتصف اليوم UTC لتفادي فروقات
        // المنطقة الزمنية)، وإلا نُفرغ تاريخ التحصيل فقط إن لم يوجد مبلغ مستلم بعد
        paid_at: paidDateRaw ? new Date(paidDateRaw + 'T12:00:00').toISOString() : (receivedAmount > 0 ? new Date().toISOString() : null),
        collection_type_id: methodValue ? parseInt(methodValue, 10) : null,
        notes: notesRaw || null
    };

    try {
        const { data: upsertedRows, error } = await dbClient
            .from('employee_collections')
            .upsert([payload], { onConflict: 'employee_link_id,collection_month' })
            .select();

        if (error) throw error;
        if (!upsertedRows || upsertedRows.length === 0) {
            showCollectionModalAlert('لم يتم حفظ التعديلات فعلياً. تحقق من وجود سياسات إضافة/تعديل (RLS INSERT/UPDATE Policies) على جدول employee_collections في سوبابيس.', 'error');
            return;
        }

        closeEditCollectionModal();
        await fetchAndRenderCollections();
    } catch (error) {
        console.error('Edit Collection Error:', error);
        showCollectionModalAlert('فشلت العملية: ' + error.message, 'error');
    } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = originalText; }
    }
}
