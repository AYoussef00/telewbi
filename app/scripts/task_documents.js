// =========================================================================
// 📎 مستندات المهمة (صفحة "بيانات المهمة" — view_task.html)
//
// يرفع الموظف مستنداً أو أكثر على المهمة المُسندة إليه، ويرى قائمة مستندات
// المهمة ويفتحها ويحذف ما رفعه هو. مسؤول الشركة يرى مستندات مهام شركته فقط
// (بلا رفع ولا حذف)، ومدير النظام والمسؤولون يرفعون ويرون ويحذفون على كل المهام.
//
// الصلاحيات الفعلية تُفرض بقاعدة البيانات (انظر database/sql/task_documents_setup.sql)؛
// ما هنا يخفي الأزرار غير المسموحة فقط. الملفات بحاوية خاصة (task-documents) وتُفتح
// بروابط مؤقتة موقَّعة. يتطلب تنفيذ سكربت SQL المذكور أولاً.
// =========================================================================
(function () {
    const BUCKET = 'task-documents';
    const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 ميغابايت
    const ALLOWED_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'doc', 'docx', 'xls', 'xlsx'];
    const SIGNED_URL_SECONDS = 300;

    const ctx = { task: null, userId: null, userName: null, role: null, canUpload: false, isStaff: false };

    function $(id) { return document.getElementById(id); }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text == null ? '' : String(text);
        return div.innerHTML;
    }

    function showAlert(message, type) {
        const box = $('taskDocsAlert');
        if (!box) return;
        if (!message) { box.style.display = 'none'; return; }
        box.textContent = message;
        box.className = 'form-alert ' + (type === 'success' ? 'alert-success' : 'alert-error');
        box.style.display = 'flex';
    }

    function formatSize(bytes) {
        const n = Number(bytes);
        if (!Number.isFinite(n) || n <= 0) return '—';
        if (n < 1024) return n + ' B';
        if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
        return (n / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function formatDateTime(value) {
        if (!value) return '—';
        try {
            return new Date(value).toLocaleString('ar-u-nu-latn', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
        } catch (e) { return String(value); }
    }

    function getExtension(fileName) {
        const parts = String(fileName || '').split('.');
        return parts.length > 1 ? parts.pop().toLowerCase() : '';
    }

    // اسم آمن لمسار التخزين (الأسماء العربية/الرموز لا تصلح كمفتاح ملف) — الاسم الأصلي يُحفظ بالجدول للعرض
    function safeStorageName(fileName) {
        const ext = getExtension(fileName);
        const base = String(fileName || 'file').replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'file';
        return ext ? `${base}.${ext}` : base;
    }

    function randomId() {
        if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    }

    // ---------------------------------------------------------------------
    // تحميل وعرض قائمة المستندات
    // ---------------------------------------------------------------------
    async function loadDocuments() {
        const list = $('taskDocsList');
        if (!list) return;

        const { data, error } = await dbClient
            .from('task_documents')
            .select('id, file_name, file_path, file_size, uploaded_by, uploaded_by_name, created_at')
            .eq('task_id', ctx.task.id)
            .order('created_at', { ascending: false })
            .order('id', { ascending: false });

        if (error) {
            console.error('تعذّر تحميل مستندات المهمة:', error.message);
            list.innerHTML = `<div class="task-docs-empty">تعذّر تحميل المستندات. تأكد من تنفيذ سكربت task_documents_setup.sql في Supabase.</div>`;
            return;
        }

        if (!data || data.length === 0) {
            list.innerHTML = `<div class="task-docs-empty">لا توجد مستندات مرفوعة على هذه المهمة.</div>`;
            return;
        }

        list.innerHTML = data.map(doc => {
            const canDelete = (ctx.canUpload) && (String(doc.uploaded_by) === String(ctx.userId) || ctx.isStaff);
            return `
                <div class="task-doc-row" data-doc-id="${escapeHtml(doc.id)}">
                    <div class="task-doc-info">
                        <div class="task-doc-name">${escapeHtml(doc.file_name)}</div>
                        <div class="task-doc-meta">${escapeHtml(formatSize(doc.file_size))} • ${escapeHtml(doc.uploaded_by_name || '—')} • ${escapeHtml(formatDateTime(doc.created_at))}</div>
                    </div>
                    <div class="task-doc-actions">
                        <button type="button" class="btn-task-doc btn-task-doc-view" data-action="view" data-path="${escapeHtml(doc.file_path)}">عرض</button>
                        ${canDelete ? `<button type="button" class="btn-task-doc btn-task-doc-delete" data-action="delete" data-id="${escapeHtml(doc.id)}" data-path="${escapeHtml(doc.file_path)}" data-name="${escapeHtml(doc.file_name)}">حذف</button>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    // ---------------------------------------------------------------------
    // رفع الملفات
    // ---------------------------------------------------------------------
    async function uploadSelectedFiles() {
        const input = $('taskDocsFileInput');
        const button = $('taskDocsUploadBtn');
        const files = input ? Array.from(input.files || []) : [];
        showAlert('');

        if (files.length === 0) { showAlert('اختر ملفاً واحداً على الأقل أولاً.', 'error'); return; }

        for (const file of files) {
            if (!ALLOWED_EXTENSIONS.includes(getExtension(file.name))) {
                showAlert(`نوع الملف غير مسموح: ${file.name}. الأنواع المسموحة: PDF، صور (JPG/PNG/WEBP)، Word، Excel.`, 'error');
                return;
            }
            if (file.size > MAX_FILE_BYTES) {
                showAlert(`حجم الملف أكبر من 10 ميغابايت: ${file.name}`, 'error');
                return;
            }
        }

        const originalText = button.textContent;
        button.disabled = true;
        let uploaded = 0;
        const failures = [];

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            button.textContent = `جاري الرفع (${i + 1}/${files.length})...`;
            const storagePath = `${ctx.task.id}/${randomId()}-${safeStorageName(file.name)}`;

            try {
                const { error: uploadError } = await dbClient.storage.from(BUCKET)
                    .upload(storagePath, file, { contentType: file.type || undefined, upsert: false });
                if (uploadError) throw uploadError;

                const { error: insertError } = await dbClient.from('task_documents').insert({
                    task_id: ctx.task.id,
                    file_name: file.name,
                    file_path: storagePath,
                    file_size: file.size,
                    mime_type: file.type || null,
                    uploaded_by: ctx.userId,
                    uploaded_by_name: ctx.userName || null
                });
                if (insertError) {
                    // لا نترك ملفاً يتيماً بلا سجل
                    await dbClient.storage.from(BUCKET).remove([storagePath]);
                    throw insertError;
                }
                uploaded++;
            } catch (err) {
                console.error('فشل رفع المستند:', err);
                failures.push(`${file.name} (${(err && err.message) || 'خطأ غير معروف'})`);
            }
        }

        button.disabled = false;
        button.textContent = originalText;
        if (input) input.value = '';
        updateSelectedLabel();

        if (failures.length === 0) {
            showAlert(uploaded === 1 ? 'تم رفع المستند بنجاح.' : `تم رفع ${uploaded} مستندات بنجاح.`, 'success');
        } else {
            showAlert(`تعذّر رفع: ${failures.join('، ')}` + (uploaded ? ` — تم رفع ${uploaded} فقط.` : ''), 'error');
        }
        await loadDocuments();
    }

    function updateSelectedLabel() {
        const input = $('taskDocsFileInput');
        const label = $('taskDocsSelectedLabel');
        if (!input || !label) return;
        const count = input.files ? input.files.length : 0;
        label.textContent = count === 0 ? 'لم يتم اختيار ملف' : (count === 1 ? input.files[0].name : `${count} ملفات محددة`);
    }

    // ---------------------------------------------------------------------
    // عرض / حذف
    // ---------------------------------------------------------------------
    async function viewDocument(path) {
        // نافذة تُفتح فوراً بحدث النقر (لتفادي حاجب النوافذ المنبثقة) ثم نوجّهها للرابط الموقَّع
        const win = window.open('about:blank', '_blank');
        const { data, error } = await dbClient.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
        if (error || !data || !data.signedUrl) {
            if (win) win.close();
            showAlert('تعذّر فتح المستند: ' + ((error && error.message) || 'رابط غير متاح'), 'error');
            return;
        }
        if (win) { win.location.href = data.signedUrl; } else { window.location.href = data.signedUrl; }
    }

    async function deleteDocument(id, path, name) {
        if (!confirm(`حذف المستند «${name}» نهائياً؟`)) return;
        showAlert('');

        const { data: deletedRows, error } = await dbClient.from('task_documents').delete().eq('id', id).select();
        if (error) { showAlert('فشل الحذف: ' + error.message, 'error'); return; }
        if (!deletedRows || deletedRows.length === 0) {
            showAlert('لم يتم حذف المستند (ليست لديك صلاحية حذفه).', 'error');
            return;
        }

        const { error: removeError } = await dbClient.storage.from(BUCKET).remove([path]);
        if (removeError) console.error('تعذّر حذف ملف المستند من التخزين:', removeError.message);

        showAlert('تم حذف المستند.', 'success');
        await loadDocuments();
    }

    // ---------------------------------------------------------------------
    // التهيئة: تحديد المستخدم والمهمة والصلاحية ثم إظهار القسم
    // ---------------------------------------------------------------------
    async function init() {
        const section = $('taskDocsSection');
        if (!section) return;

        try {
            const taskId = new URLSearchParams(window.location.search).get('id');
            if (!taskId) return;

            const { data: { session } } = await dbClient.auth.getSession();
            if (!session) return;

            const { data: profile } = await dbClient.from('users').select('role, name').eq('id', session.user.id).maybeSingle();
            const role = (profile && profile.role) || null;

            const { data: task } = await dbClient.from('tasks').select('id, assigned_to, company_id').eq('id', taskId).maybeSingle();
            if (!task) return;

            let hasAccess = true;
            let userName = (profile && profile.name) || null;

            if (role === 'employee') {
                const { data: employeeRow } = await dbClient.from('employees').select('id, name').eq('user_id', session.user.id).maybeSingle();
                hasAccess = !!employeeRow && task.assigned_to != null && String(employeeRow.id) === String(task.assigned_to);
                if (employeeRow && employeeRow.name) userName = employeeRow.name;
            } else if (role === 'company') {
                if (task.company_id == null) { hasAccess = false; }
                else {
                    const { data: owned } = await dbClient.from('companies').select('id').eq('user_id', session.user.id);
                    hasAccess = (owned || []).map(c => String(c.id)).includes(String(task.company_id));
                }
            }
            if (!hasAccess) return;

            ctx.task = task;
            ctx.userId = session.user.id;
            ctx.userName = userName;
            ctx.role = role;
            ctx.isStaff = role !== 'employee' && role !== 'company';
            ctx.canUpload = role !== 'company';

            const uploadBox = $('taskDocsUploadBox');
            if (uploadBox) uploadBox.style.display = ctx.canUpload ? '' : 'none';

            const fileInput = $('taskDocsFileInput');
            if (fileInput) fileInput.addEventListener('change', updateSelectedLabel);
            const uploadBtn = $('taskDocsUploadBtn');
            if (uploadBtn) uploadBtn.addEventListener('click', uploadSelectedFiles);

            $('taskDocsList').addEventListener('click', (e) => {
                const btn = e.target.closest('button[data-action]');
                if (!btn) return;
                if (btn.dataset.action === 'view') viewDocument(btn.dataset.path);
                else if (btn.dataset.action === 'delete') deleteDocument(btn.dataset.id, btn.dataset.path, btn.dataset.name);
            });

            section.style.display = 'block';
            await loadDocuments();
        } catch (error) {
            console.error('تعذّر تهيئة مستندات المهمة:', error);
        }
    }

    document.addEventListener('DOMContentLoaded', init);
})();
