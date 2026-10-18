// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================
const SUPABASE_URL = "https://mcdhxdfkuokhmhtfvjev.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_yt9V8lsNU1zN3Ix2CvovbQ_QCA2VDdM";
const dbClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let localRequestsCache = [];
let filteredRequestsCache = [];
let currentStatusFilter = 'pending';
let currentSearchText = '';
let currentRequestsPage = 1;
const requestsPerPage = 10;

let currentAdminUserId = null;
let pendingRejectRequestId = null;

// =========================================================================
// 2. تحميل الصفحة
// =========================================================================
document.addEventListener('DOMContentLoaded', async () => {
    const allowed = await Permissions.guardPage('employee_signup_requests');
    if (!allowed) return;

    const { data: { session } } = await dbClient.auth.getSession();
    currentAdminUserId = session ? session.user.id : null;

    await loadSelfRegistrationToggle();
    document.getElementById('selfRegistrationToggle').addEventListener('change', handleToggleChange);

    document.getElementById('statusFilterTabs').addEventListener('click', (e) => {
        const btn = e.target.closest('.status-filter-tab');
        if (!btn) return;
        document.querySelectorAll('.status-filter-tab').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        currentStatusFilter = btn.getAttribute('data-status');
        applyRequestsFilters();
    });

    document.getElementById('requestsSearchInput').addEventListener('input', (e) => {
        currentSearchText = (e.target.value || '').toLowerCase().trim();
        applyRequestsFilters();
    });

    document.getElementById('btnCloseRejectModal').addEventListener('click', closeRejectModal);
    document.getElementById('btnCancelRejectModal').addEventListener('click', closeRejectModal);
    document.getElementById('btnConfirmRejectModal').addEventListener('click', handleConfirmReject);

    await fetchAndRenderRequests();
});

// =========================================================================
// 3. إعداد إظهار/إخفاء خيار "إنشاء حساب" بشاشة دخول الموظفين
// =========================================================================
async function loadSelfRegistrationToggle() {
    const toggle = document.getElementById('selfRegistrationToggle');
    const label = document.getElementById('toggleStatusLabel');
    try {
        const { data, error } = await dbClient
            .from('app_settings')
            .select('value')
            .eq('key', 'employee_self_registration_enabled')
            .maybeSingle();

        if (error) throw new Error(error.message);

        const isEnabled = data ? (data.value === true || data.value === 'true') : true;
        toggle.checked = isEnabled;
        label.textContent = isEnabled ? 'مُفعّل' : 'مُوقَف';
        toggle.disabled = false;
    } catch (error) {
        console.error('تعذّر تحميل إعداد إنشاء الحساب الذاتي:', error.message);
        label.textContent = 'تعذّر التحميل';
        showToggleAlert('تعذّر تحميل حالة الإعداد: ' + error.message + ' — تأكد من تنفيذ سكربت إعداد قاعدة البيانات الخاص بهذه الميزة.', 'error');
    }
}

async function handleToggleChange(e) {
    const toggle = e.target;
    const label = document.getElementById('toggleStatusLabel');
    const newValue = toggle.checked;
    toggle.disabled = true;

    try {
        const { data: updatedRows, error } = await dbClient
            .from('app_settings')
            .update({ value: newValue, updated_at: new Date().toISOString(), updated_by: currentAdminUserId })
            .eq('key', 'employee_self_registration_enabled')
            .select();

        if (error) throw new Error(error.message);

        if (!updatedRows || updatedRows.length === 0) {
            throw new Error('لم يتم حفظ الإعداد فعلياً. تأكد من تنفيذ سكربت إعداد قاعدة البيانات الخاص بهذه الميزة (يضيف صف الإعداد الافتراضي).');
        }

        label.textContent = newValue ? 'مُفعّل' : 'مُوقَف';
        showToggleAlert(newValue ? 'تم تفعيل خيار "إنشاء حساب" — سيظهر الآن بشاشة دخول الموظفين.' : 'تم إيقاف خيار "إنشاء حساب" — لن يظهر بعد الآن بشاشة دخول الموظفين.', 'success');
    } catch (error) {
        console.error('فشل تحديث إعداد إنشاء الحساب الذاتي:', error.message);
        toggle.checked = !newValue; // تراجع بصري عن التبديل الفاشل
        showToggleAlert('فشل حفظ الإعداد: ' + error.message, 'error');
    } finally {
        toggle.disabled = false;
    }
}

function showToggleAlert(message, type) {
    const alertBox = document.getElementById('toggleAlert');
    alertBox.textContent = message;
    alertBox.className = 'form-alert ' + (type === 'success' ? 'alert-success' : 'alert-error');
    alertBox.style.display = 'flex';
}

// =========================================================================
// 4. جلب طلبات التسجيل
// =========================================================================
async function fetchAndRenderRequests() {
    const tableBody = document.getElementById('requestsTableBody');
    try {
        const { data, error } = await dbClient
            .from('employee_signup_requests')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw new Error(error.message);

        localRequestsCache = data || [];
        applyRequestsFilters();
    } catch (error) {
        console.error('تعذّر تحميل طلبات التسجيل:', error.message);
        tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:#ef4444; padding:20px;">تعذّر تحميل طلبات التسجيل: ${error.message} — تأكد من تنفيذ سكربت إعداد قاعدة البيانات الخاص بهذه الميزة.</td></tr>`;
    }
}

function applyRequestsFilters() {
    filteredRequestsCache = localRequestsCache.filter(r => {
        const matchesStatus = currentStatusFilter === 'all' || r.status === currentStatusFilter;
        const matchesSearch = !currentSearchText
            || (r.name || '').toLowerCase().includes(currentSearchText)
            || (r.national_id || '').toLowerCase().includes(currentSearchText)
            || (r.email || '').toLowerCase().includes(currentSearchText);
        return matchesStatus && matchesSearch;
    });
    currentRequestsPage = 1;
    renderRequestsTable();
}

// =========================================================================
// 5. بناء الجدول
// =========================================================================
function formatRequestDate(dateStr) {
    if (!dateStr) return '----';
    try {
        return new Date(dateStr).toLocaleDateString('ar-SA');
    } catch (e) { return dateStr; }
}

function buildAttachmentChips(request) {
    const items = [
        { url: request.id_photo_url, label: 'الهوية' },
        { url: request.national_address_url, label: 'العنوان الوطني' },
        { url: request.iban_certificate_url, label: 'شهادة الآيبان' },
        { url: request.cv_url, label: 'السيرة الذاتية' },
        { url: request.education_qualification_url, label: 'المؤهل العلمي' },
        { url: request.cr_status_url, label: 'حالة السجلات التجارية' },
        { url: request.mudad_wage_certificate_url, label: 'شهادة المدد والأجور' },
        { url: request.qiwa_contracts_url, label: 'عقود قوى' },
        { url: request.contract_url, label: 'العقد (مرفق سابق)' }
    ].filter(i => i.url);

    if (items.length === 0) return '<span class="attachment-links-empty">لا مرفقات</span>';

    return `<div class="attachment-links">${items.map(i =>
        `<a class="attachment-link-chip" href="${i.url}" target="_blank" rel="noopener noreferrer">${window.ICONS ? ICONS.paperclip : '📎'} ${i.label}</a>`
    ).join('')}</div>`;
}

function buildStatusBadge(status) {
    if (status === 'approved') return `<span class="status-badge-approved">مقبول</span>`;
    if (status === 'rejected') return `<span class="status-badge-rejected">مرفوض</span>`;
    return `<span class="status-badge-pending">قيد المراجعة</span>`;
}

function buildRequestActionsHtml(request) {
    if (request.status === 'pending') {
        return `
            <div class="request-actions">
                <button type="button" class="btn-approve-request" data-perm="edit:employee_signup_requests" onclick="handleApproveRequest('${request.id}')">✔ موافقة</button>
                <button type="button" class="btn-reject-request" data-perm="edit:employee_signup_requests" onclick="openRejectModal('${request.id}')">✕ رفض</button>
            </div>
        `;
    }
    if (request.status === 'rejected' && request.rejection_reason) {
        return `<div class="rejection-reason-note">سبب الرفض: ${request.rejection_reason}</div>`;
    }
    if (request.status === 'approved') {
        return `<a href="link_employee.html" style="font-size:12px; font-weight:700; color:#e05236; text-decoration:none;">ربط الموظف الآن ←</a>`;
    }
    return '—';
}

function renderRequestsTable() {
    const tableBody = document.getElementById('requestsTableBody');
    if (!tableBody) return;

    if (filteredRequestsCache.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:40px; color:#94a3b8;">لا توجد طلبات مطابقة.</td></tr>`;
        setupRequestsPaginationControls(0);
        return;
    }

    const startIndex = (currentRequestsPage - 1) * requestsPerPage;
    const paginatedData = filteredRequestsCache.slice(startIndex, startIndex + requestsPerPage);

    tableBody.innerHTML = paginatedData.map(r => `
        <tr>
            <td><strong style="color:#1e293b;">${r.name || '----'}</strong></td>
            <td style="font-family:monospace; color:#475569;">${r.national_id || '----'}</td>
            <td style="font-family:monospace; color:#475569; direction:ltr; text-align:right;">${r.mobile_number || '----'}</td>
            <td style="direction:ltr; text-align:right; color:#475569;">${r.email || '----'}</td>
            <td>${buildAttachmentChips(r)}</td>
            <td style="text-align:center;">${buildStatusBadge(r.status)}</td>
            <td style="text-align:center; color:#94a3b8; font-size:12.5px;">${formatRequestDate(r.created_at)}</td>
            <td style="text-align:center;">${buildRequestActionsHtml(r)}</td>
        </tr>
    `).join('');

    setupRequestsPaginationControls(filteredRequestsCache.length);
    Permissions.applyButtonGating(tableBody);
}

function setupRequestsPaginationControls(totalItems) {
    const container = document.getElementById('requestsPagination');
    if (!container) return;
    container.innerHTML = '';

    const totalPages = Math.ceil(totalItems / requestsPerPage);
    if (totalPages <= 1) return;

    const prevBtn = document.createElement('button');
    prevBtn.innerHTML = '&rarr; السابقة';
    prevBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;';
    prevBtn.disabled = currentRequestsPage === 1;
    if (prevBtn.disabled) prevBtn.style.opacity = '0.5';
    prevBtn.onclick = () => { if (currentRequestsPage > 1) { currentRequestsPage--; renderRequestsTable(); } };
    container.appendChild(prevBtn);

    const countLabel = document.createElement('span');
    countLabel.style.cssText = 'font-size: 0.9rem; color: #475569; font-weight: 600; margin: 0 10px;';
    countLabel.textContent = `صفحة ${currentRequestsPage} من ${totalPages}`;
    container.appendChild(countLabel);

    const nextBtn = document.createElement('button');
    nextBtn.innerHTML = 'التالية &larr;';
    nextBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;';
    nextBtn.disabled = currentRequestsPage === totalPages;
    if (nextBtn.disabled) nextBtn.style.opacity = '0.5';
    nextBtn.onclick = () => { if (currentRequestsPage < totalPages) { currentRequestsPage++; renderRequestsTable(); } };
    container.appendChild(nextBtn);
}

// =========================================================================
// 6. الموافقة على طلب
// =========================================================================
async function handleApproveRequest(requestId) {
    const request = localRequestsCache.find(r => String(r.id) === String(requestId));
    if (!request) return;

    if (!confirm(`هل أنت متأكد من الموافقة على طلب "${request.name}"؟ سيتمكن فور الموافقة من تسجيل الدخول من شاشة دخول الموظفين. لا يزال يتوجب عليك ربطه فعلياً بالشركة من شاشة "ربط الموظفين" بشكل منفصل.`)) return;

    try {
        const { error: userUpdateError } = await dbClient
            .from('users')
            .update({ status: 'active' })
            .eq('id', request.user_id);
        if (userUpdateError) throw new Error(userUpdateError.message);

        const { error: requestUpdateError } = await dbClient
            .from('employee_signup_requests')
            .update({ status: 'approved', reviewed_by: currentAdminUserId, reviewed_at: new Date().toISOString() })
            .eq('id', requestId);
        if (requestUpdateError) throw new Error(requestUpdateError.message);

        alert(`تمت الموافقة على طلب "${request.name}" بنجاح.`);
        await fetchAndRenderRequests();
    } catch (error) {
        console.error('فشلت الموافقة على الطلب:', error.message);
        alert('فشلت العملية: ' + error.message);
    }
}

// =========================================================================
// 7. رفض طلب (عبر نافذة تطلب سبب الرفض)
// =========================================================================
function openRejectModal(requestId) {
    const request = localRequestsCache.find(r => String(r.id) === String(requestId));
    if (!request) return;

    pendingRejectRequestId = requestId;
    document.getElementById('rejectModalEmployeeName').textContent = request.name || '—';
    document.getElementById('rejectReasonInput').value = '';
    document.getElementById('error-reject_reason').textContent = '';
    document.getElementById('rejectModalAlert').style.display = 'none';
    document.getElementById('rejectRequestModal').style.display = 'flex';
}

function closeRejectModal() {
    document.getElementById('rejectRequestModal').style.display = 'none';
    pendingRejectRequestId = null;
}

async function handleConfirmReject() {
    const reason = document.getElementById('rejectReasonInput').value.trim();
    if (!reason) {
        document.getElementById('error-reject_reason').textContent = 'الرجاء كتابة سبب الرفض.';
        return;
    }
    document.getElementById('error-reject_reason').textContent = '';

    const request = localRequestsCache.find(r => String(r.id) === String(pendingRejectRequestId));
    if (!request) { closeRejectModal(); return; }

    const confirmBtn = document.getElementById('btnConfirmRejectModal');
    const originalText = confirmBtn.textContent;
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'جاري الرفض...';

    try {
        const { error: userUpdateError } = await dbClient
            .from('users')
            .update({ status: 'rejected' })
            .eq('id', request.user_id);
        if (userUpdateError) throw new Error(userUpdateError.message);

        const { error: requestUpdateError } = await dbClient
            .from('employee_signup_requests')
            .update({
                status: 'rejected',
                rejection_reason: reason,
                reviewed_by: currentAdminUserId,
                reviewed_at: new Date().toISOString()
            })
            .eq('id', pendingRejectRequestId);
        if (requestUpdateError) throw new Error(requestUpdateError.message);

        closeRejectModal();
        await fetchAndRenderRequests();
    } catch (error) {
        console.error('فشل رفض الطلب:', error.message);
        const alertBox = document.getElementById('rejectModalAlert');
        alertBox.textContent = 'فشلت العملية: ' + error.message;
        alertBox.className = 'form-alert alert-error';
        alertBox.style.display = 'flex';
    } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = originalText;
    }
}