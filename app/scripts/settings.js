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

    // 🏢 مستندات المنشأة: لمدير عام النظام فقط (الإخفاء هنا للواجهة؛ والحماية الفعلية
    // بسياسة RLS على جدول facility_documents — انظر facility_documents_setup.sql)
    if (Permissions.isSuperAdmin()) {
        document.getElementById('facilityDocsCard').style.display = '';
        await loadFacilityDocuments();
    }
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

// =========================================================================
// 3. 🏢 مستندات المنشأة (مدير عام النظام فقط): رفع / استبدال / عرض / حذف
//    — ثلاثة مستندات ثابتة، مستند واحد لكل نوع، تُخزَّن الملفات بنفس Bucket
//    مستندات الشركات (company-documents) داخل مجلد facility/، ومراجعها بجدول
//    facility_documents (doc_type مفتاح أساسي ⇐ الرفع الجديد يستبدل القديم).
// =========================================================================
const FACILITY_DOCS_BUCKET = 'company-documents';
const FACILITY_DOC_TYPES = [
    { type: 'cr_certificate', label: 'شهادة السجل التجاري' },
    { type: 'vat_certificate', label: 'شهادة التسجيل في ضريبة القيمة المضافة' },
    { type: 'national_address', label: 'العنوان الوطني' }
];
const FACILITY_DOC_MAX_BYTES = 10 * 1024 * 1024;
const FACILITY_DOC_ALLOWED_EXT = ['pdf', 'png', 'jpg', 'jpeg', 'webp'];

let facilityDocsByType = new Map();

function showFacilityDocsMsg(text, kind) {
    const el = document.getElementById('facilityDocsMsg');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'facility-docs-msg' + (text ? ` show ${kind || 'info'}` : '');
}

async function loadFacilityDocuments() {
    try {
        const { data, error } = await dbClient.from('facility_documents').select('*');
        if (error) throw new Error(error.message);
        facilityDocsByType = new Map((data || []).map(r => [r.doc_type, r]));
        renderFacilityDocuments();
    } catch (error) {
        console.error('تعذّر تحميل مستندات المنشأة:', error.message);
        const list = document.getElementById('facilityDocsList');
        if (list) list.textContent = '';
        showFacilityDocsMsg('تعذّر تحميل المستندات: ' + error.message + ' — تأكد من تنفيذ سكربت facility_documents_setup.sql في Supabase.', 'err');
    }
}

function formatFacilityDocDate(value) {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '';
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function renderFacilityDocuments() {
    const list = document.getElementById('facilityDocsList');
    list.textContent = '';

    FACILITY_DOC_TYPES.forEach(({ type, label }) => {
        const doc = facilityDocsByType.get(type);

        const row = document.createElement('div');
        row.className = 'facility-doc-row';

        const info = document.createElement('div');
        info.className = 'facility-doc-info';
        const title = document.createElement('div');
        title.className = 'facility-doc-title';
        title.textContent = label;
        const meta = document.createElement('div');
        meta.className = 'facility-doc-meta' + (doc ? ' has-file' : '');
        // textContent: اسم الملف قادم من المستخدم ولا يُفسَّر كـ HTML أبداً
        meta.textContent = doc
            ? `${doc.file_name || 'ملف مرفوع'}${doc.uploaded_at ? ' — ' + formatFacilityDocDate(doc.uploaded_at) : ''}`
            : 'لم يُرفع بعد';
        info.appendChild(title);
        info.appendChild(meta);

        const actions = document.createElement('div');
        actions.className = 'facility-doc-actions';

        if (doc && /^https?:\/\//i.test(doc.file_url || '')) {
            const viewLink = document.createElement('a');
            viewLink.className = 'facility-doc-btn view';
            viewLink.href = doc.file_url;
            viewLink.target = '_blank';
            viewLink.rel = 'noopener noreferrer';
            viewLink.textContent = 'عرض';
            actions.appendChild(viewLink);
        }

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.pdf,.png,.jpg,.jpeg,.webp';
        fileInput.style.display = 'none';
        fileInput.addEventListener('change', () => {
            const file = fileInput.files && fileInput.files[0];
            fileInput.value = '';
            if (file) uploadFacilityDocument(type, label, file);
        });
        const uploadBtn = document.createElement('button');
        uploadBtn.type = 'button';
        uploadBtn.className = 'facility-doc-btn upload';
        uploadBtn.textContent = doc ? 'استبدال' : 'رفع';
        uploadBtn.addEventListener('click', () => fileInput.click());
        actions.appendChild(uploadBtn);
        actions.appendChild(fileInput);

        if (doc) {
            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'facility-doc-btn delete';
            delBtn.textContent = 'حذف';
            delBtn.addEventListener('click', () => deleteFacilityDocument(type, label));
            actions.appendChild(delBtn);
        }

        row.appendChild(info);
        row.appendChild(actions);
        list.appendChild(row);
    });
}

// يحذف ملفاً من الـ Bucket بلا إيقاف العملية لو فشل (قد لا توجد سياسة حذف للتخزين)
async function removeFacilityStorageObject(filePath) {
    if (!filePath) return;
    try {
        const { error } = await dbClient.storage.from(FACILITY_DOCS_BUCKET).remove([filePath]);
        if (error) console.warn('تعذّر حذف الملف من مساحة التخزين:', error.message);
    } catch (e) {
        console.warn('تعذّر حذف الملف من مساحة التخزين:', e.message);
    }
}

async function uploadFacilityDocument(type, label, file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!FACILITY_DOC_ALLOWED_EXT.includes(ext)) {
        showFacilityDocsMsg('صيغة الملف غير مدعومة. المسموح: PDF أو صورة (png / jpg / webp).', 'err');
        return;
    }
    if (file.size > FACILITY_DOC_MAX_BYTES) {
        showFacilityDocsMsg('حجم الملف أكبر من 10 ميجابايت.', 'err');
        return;
    }

    showFacilityDocsMsg(`جاري رفع «${label}»...`, 'info');
    const previous = facilityDocsByType.get(type);
    try {
        const { data: { session } } = await dbClient.auth.getSession();
        const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
        const filePath = `facility/${type}/${crypto.randomUUID()}-${safeName}`;

        const { error: uploadError } = await dbClient.storage
            .from(FACILITY_DOCS_BUCKET)
            .upload(filePath, file, { cacheControl: '3600', upsert: false });
        if (uploadError) throw new Error(uploadError.message || 'تعذّر الوصول لمساحة التخزين');

        const { data: publicUrlData } = dbClient.storage.from(FACILITY_DOCS_BUCKET).getPublicUrl(filePath);
        const fileUrl = publicUrlData && publicUrlData.publicUrl;
        if (!fileUrl) throw new Error('تعذّر الحصول على رابط الملف');

        const { error: saveError } = await dbClient.from('facility_documents').upsert({
            doc_type: type,
            file_url: fileUrl,
            file_path: filePath,
            file_name: file.name,
            uploaded_by: session ? session.user.id : null,
            uploaded_at: new Date().toISOString()
        }, { onConflict: 'doc_type' });
        if (saveError) {
            await removeFacilityStorageObject(filePath); // لا نترك ملفاً يتيماً
            throw new Error(saveError.message);
        }

        // بعد نجاح الحفظ فقط: نحذف الملف القديم (إن وُجد) من التخزين
        if (previous && previous.file_path && previous.file_path !== filePath) {
            await removeFacilityStorageObject(previous.file_path);
        }

        await loadFacilityDocuments();
        showFacilityDocsMsg(`تم ${previous ? 'استبدال' : 'رفع'} «${label}» بنجاح.`, 'ok');
    } catch (error) {
        console.error('تعذّر رفع مستند المنشأة:', error.message);
        showFacilityDocsMsg('تعذّر رفع الملف: ' + error.message, 'err');
    }
}

async function deleteFacilityDocument(type, label) {
    const doc = facilityDocsByType.get(type);
    if (!doc) return;
    if (!window.confirm(`حذف «${label}» نهائياً؟ لا يمكن التراجع عن هذا الإجراء.`)) return;

    try {
        const { error } = await dbClient.from('facility_documents').delete().eq('doc_type', type);
        if (error) throw new Error(error.message);
        await removeFacilityStorageObject(doc.file_path);
        await loadFacilityDocuments();
        showFacilityDocsMsg(`تم حذف «${label}».`, 'ok');
    } catch (error) {
        console.error('تعذّر حذف مستند المنشأة:', error.message);
        showFacilityDocsMsg('تعذّر الحذف: ' + error.message, 'err');
    }
}
