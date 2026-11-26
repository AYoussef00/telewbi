// =========================================================================
// 🔐 StorageDocs — فتح مستندات حاويات التخزين الخاصة (employee-documents /
// company-documents) عبر رابط موقّع مؤقت بدل الرابط العام.
//
// الحاويتان أصبحتا خاصتين، فالروابط القديمة المخزَّنة بقاعدة البيانات
// (…/storage/v1/object/public/<bucket>/<path>) لم تعد تعمل مباشرة. هذا الملف
// يستخرج (الحاوية + المسار) من أي رابط مخزَّن ويطلب رابطاً موقّعاً صالحاً دقائق
// قليلة عند النقر فقط — فلا حاجة لتعديل البيانات المخزَّنة.
//
// الاستخدام: أنشئ الرابط هكذا (بدل href المباشر):
//   <a href="#" data-doc-url="${StorageDocs.attr(url)}">عرض</a>
// وأي نقرة عليه تُفتح تلقائياً (مستمع نقر عام مُسجَّل هنا).
// =========================================================================
(function () {
    const SIGNED_SECONDS = 300; // صلاحية الرابط الموقّع: 5 دقائق

    // يستخرج {bucket, path} من رابط تخزين Supabase (عام/موقّع)، أو null إن لم يكن رابط تخزين
    function parse(ref) {
        if (!ref) return null;
        const m = String(ref).match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/?#]+)\/([^?#]+)/);
        if (!m) return null;
        try { return { bucket: m[1], path: decodeURIComponent(m[2]) }; }
        catch (e) { return { bucket: m[1], path: m[2] }; }
    }

    // يعيد رابطاً صالحاً للفتح: موقّعاً إن كان رابط تخزين، وإلا الرابط كما هو
    async function signedUrl(ref) {
        const p = parse(ref);
        if (!p) return String(ref);
        const { data, error } = await dbClient.storage.from(p.bucket).createSignedUrl(p.path, SIGNED_SECONDS);
        if (error) throw error;
        return data.signedUrl;
    }

    // يفتح المستند بتبويب جديد (يُفتح التبويب فوراً داخل حدث النقر لتفادي حجب النوافذ المنبثقة)
    async function open(ref) {
        const win = window.open('', '_blank');
        try {
            const url = await signedUrl(ref);
            if (win) { win.opener = null; win.location.href = url; }
            else { window.location.href = url; }
        } catch (error) {
            if (win) win.close();
            console.error('تعذّر فتح المستند:', error);
            alert('تعذّر فتح المستند: ' + ((error && error.message) || 'خطأ غير معروف'));
        }
    }

    // تهريب قيمة لوضعها داخل سمة HTML
    function attr(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
            .replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    document.addEventListener('click', function (event) {
        const link = event.target && event.target.closest ? event.target.closest('a[data-doc-url]') : null;
        if (!link) return;
        event.preventDefault();
        open(link.getAttribute('data-doc-url'));
    });

    window.StorageDocs = { parse, signedUrl, open, attr };
})();
