// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================

// =========================================================================
// 🛡️ نطاق رؤية المستخدم الحالي: مسؤول الشركة (role='company') يرى تذاكره
// الخاصة فقط (المرتبطة بشركته/شركاته المملوكة عبر companies.user_id)،
// بينما super_admin/admin يريان كل التذاكر من كل الشركات ويمكنهما تغيير
// حالتها وكتابة رد دعم فني — نفس منطق نطاق الرؤية المستخدم بشاشة "إدارة
// المهام" (بلا سياسات RLS خاصة بهذا؛ التصفية من الواجهة).
//
// ⚠️ إصلاح أمني: هذا الملف لم يكن يحتوي إطلاقاً على أي تقييد لدور "موظف"
// (role='employee') — كان يقع ضمن الفرع "غير مقيَّد" (نفس معاملة مدير عام
// النظام)، أي أن أي موظف يفتح شاشة الدعم الفني كان يرى تذاكر *كل* الشركات
// وكل الموظفين الآخرين، وليس فقط تذاكره الشخصية. الحل: دور "موظف" يرى فقط
// التذاكر التي فتحها هو بنفسه (عبر عمود support_tickets.created_by مقارَنةً
// بمعرّف المستخدم الحالي)، بينما لا يزال بإمكانه إغلاق تذكرته بنفسه وقراءة
// رد الدعم الفني تماماً كمسؤول الشركة.
// =========================================================================
let currentUserScope = { role: null, companyIds: null, userId: null, scopeToOwnTicketsOnly: false }; // companyIds=null يعني بلا تقييد
const ADMIN_ROLES = ['admin', 'super_admin'];

async function loadCurrentUserScope() {
    try {
        const { data: { session } } = await dbClient.auth.getSession();
        if (!session) return;

        const { data: profileRow } = await dbClient.from('users').select('role').eq('id', session.user.id).maybeSingle();
        const role = profileRow?.role || null;

        if (role === 'company') {
            const { data: ownedCompanies } = await dbClient.from('companies').select('id').eq('user_id', session.user.id);
            currentUserScope = { role, companyIds: (ownedCompanies || []).map(c => c.id), userId: session.user.id, scopeToOwnTicketsOnly: false };
        } else if (role === 'employee') {
            currentUserScope = { role, companyIds: null, userId: session.user.id, scopeToOwnTicketsOnly: true };
        } else {
            currentUserScope = { role, companyIds: null, userId: session.user.id, scopeToOwnTicketsOnly: false };
        }
    } catch (error) {
        console.error('تعذّر تحديد نطاق صلاحيات المستخدم الحالي:', error.message);
    }
}

function isAdminScope() {
    return ADMIN_ROLES.includes(currentUserScope.role);
}

// =========================================================================
// 2. مخازن بيانات مساعدة (شركات) + بيانات التذاكر
// =========================================================================
let companiesById = new Map();
let allCompanyOptions = []; // [{value, label}] بعد تطبيق نطاق الرؤية

let fullTicketsDataset = [];
let filteredTicketsDataset = [];
let currentTicketsPage = 1;
const TICKETS_ROWS_PER_PAGE = 10;

document.addEventListener('DOMContentLoaded', async () => {
    const allowed = await Permissions.guardPage('support');
    if (!allowed) return;

    await loadCurrentUserScope();
    await loadCompanies();

    // فلتر "الشركة" يظهر فقط لمسؤولي النظام (مسؤول الشركة أصلاً يرى شركته فقط،
    // والموظف يرى تذاكره الشخصية فقط بغض النظر عن الشركة)
    if (isAdminScope()) {
        document.getElementById('comboTicketCompanyFilter').style.display = '';
    }

    setupCompanyFilterCombobox();
    setupStatusFilterCombobox();

    document.getElementById('ticketSearchInput').addEventListener('input', applyTicketFilters);
    document.getElementById('btnRefreshTickets').addEventListener('click', loadTickets);
    document.getElementById('btnAddTicket').addEventListener('click', () => { window.location.href = Routes.url('add_ticket'); });

    document.getElementById('btnCloseTicketModal').addEventListener('click', closeTicketModal);
    document.getElementById('btnCancelTicketModal').addEventListener('click', closeTicketModal);
    document.getElementById('btnSaveTicketUpdates').addEventListener('click', handleSaveTicketUpdates);
    document.getElementById('btnOwnerCloseTicket').addEventListener('click', handleOwnerCloseTicket);

    await loadTickets();
});

// =========================================================================
// 3. تحميل الشركات (ضمن نطاق رؤية المستخدم) لتغذية فلتر الجدول وعرض الأسماء
// =========================================================================
async function loadCompanies() {
    try {
        let query = dbClient.from('companies').select('id, name').order('name', { ascending: true });
        if (currentUserScope.companyIds !== null) {
            if (currentUserScope.companyIds.length === 0) {
                companiesById = new Map();
                allCompanyOptions = [];
                return;
            }
            query = query.in('id', currentUserScope.companyIds);
        }

        const { data, error } = await query;
        if (error) throw error;

        companiesById = new Map((data || []).map(c => [String(c.id), c]));
        allCompanyOptions = (data || []).map(c => ({ value: String(c.id), label: c.name || '----' }));
    } catch (error) {
        console.error('تعذّر تحميل قائمة الشركات:', error.message);
    }
}

// =========================================================================
// 3ب. فلترا "الشركة" و"الحالة" أعلى الجدول — قوائم قابلة للبحث (Searchable
//     Combobox) بنفس نمط شاشة "إدارة المهام"
// =========================================================================
const TICKET_STATUS_FILTER_OPTIONS = [
    { value: 'all', label: 'الحالة: الكل' },
    { value: 'مفتوحة', label: 'مفتوحة' },
    { value: 'قيد المعالجة', label: 'قيد المعالجة' },
    { value: 'مغلقة', label: 'مغلقة' }
];

function setupCompanyFilterCombobox() {
    setupSearchableCombobox({
        inputId: 'ticketCompanyFilterSearch',
        hiddenId: 'ticketCompanyFilterId',
        dropdownId: 'ticketCompanyFilterDropdown',
        getOptions: () => [{ value: 'all', label: 'جميع الشركات' }, ...allCompanyOptions],
        emptyText: 'لا توجد شركات مطابقة',
        onSelectExtra: () => { currentTicketsPage = 1; applyTicketFilters(); }
    });
    document.getElementById('ticketCompanyFilterSearch').value = 'جميع الشركات';
}

function setupStatusFilterCombobox() {
    setupSearchableCombobox({
        inputId: 'ticketStatusFilterSearch',
        hiddenId: 'ticketStatusFilterId',
        dropdownId: 'ticketStatusFilterDropdown',
        getOptions: () => TICKET_STATUS_FILTER_OPTIONS,
        emptyText: 'لا توجد نتائج مطابقة',
        onSelectExtra: () => { currentTicketsPage = 1; applyTicketFilters(); }
    });
    document.getElementById('ticketStatusFilterSearch').value = 'الحالة: الكل';
}

// =========================================================================
// 4. جلب التذاكر (ضمن نطاق الرؤية) وربطها بأسماء الشركات للعرض
// =========================================================================
async function loadTickets() {
    const tableBody = document.getElementById('ticketsTableBody');
    tableBody.innerHTML = `<tr><td colspan="5" class="table-loading-state">جاري تحميل التذاكر...</td></tr>`;

    try {
        if (currentUserScope.companyIds !== null && currentUserScope.companyIds.length === 0) {
            fullTicketsDataset = [];
            applyTicketFilters();
            return;
        }

        let query = dbClient.from('support_tickets').select('*').order('created_at', { ascending: false });
        if (currentUserScope.companyIds !== null) {
            query = query.in('company_id', currentUserScope.companyIds);
        }
        // 🛡️ الموظف يرى فقط التذاكر التي فتحها بنفسه (انظر التعليق أعلى الملف)
        if (currentUserScope.scopeToOwnTicketsOnly) {
            query = query.eq('created_by', currentUserScope.userId);
        }

        const { data: ticketRows, error } = await query;
        if (error) throw error;

        fullTicketsDataset = (ticketRows || []).map(ticket => {
            const company = ticket.company_id != null ? companiesById.get(String(ticket.company_id)) : null;
            return { ...ticket, company_name: company ? company.name : null };
        });

        applyTicketFilters();

    } catch (error) {
        console.error('فشل جلب بيانات التذاكر:', error.message);
        tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#ef4444; padding:20px;">تعذّر تحميل التذاكر: ${error.message}</td></tr>`;
    }
}

// =========================================================================
// 5. الإحصائيات + الفلاتر
// =========================================================================
function renderStats(data) {
    const open = data.filter(t => t.status === 'مفتوحة').length;
    const inProgress = data.filter(t => t.status === 'قيد المعالجة').length;
    const closed = data.filter(t => t.status === 'مغلقة').length;

    document.getElementById('statOpen').textContent = open;
    document.getElementById('statInProgress').textContent = inProgress;
    document.getElementById('statClosed').textContent = closed;
    document.getElementById('statTotal').textContent = data.length;
}

function applyTicketFilters() {
    const searchQuery = (document.getElementById('ticketSearchInput').value || '').toLowerCase().trim();
    const companyValue = document.getElementById('ticketCompanyFilterId').value || 'all';
    const statusValue = document.getElementById('ticketStatusFilterId').value || 'all';

    filteredTicketsDataset = fullTicketsDataset.filter(ticket => {
        const matchesSearch = !searchQuery
            || (ticket.subject || '').toLowerCase().includes(searchQuery)
            || (ticket.company_name || '').toLowerCase().includes(searchQuery)
            || (ticket.created_by_name || '').toLowerCase().includes(searchQuery);
        const matchesCompany = companyValue === 'all' || String(ticket.company_id) === companyValue;
        const matchesStatus = statusValue === 'all' || ticket.status === statusValue;

        return matchesSearch && matchesCompany && matchesStatus;
    });

    renderStats(fullTicketsDataset);
    currentTicketsPage = 1;
    renderTicketsTable();
}

// =========================================================================
// 6. رسم جدول التذاكر (مع تقسيم صفحات)
// =========================================================================
function renderTicketsTable() {
    const tableBody = document.getElementById('ticketsTableBody');
    const data = filteredTicketsDataset;

    if (!data || data.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:30px; color:#94a3b8;">لا توجد تذاكر مطابقة لخيارات البحث الحالية.</td></tr>`;
        setupTicketsPaginationControls(0);
        return;
    }

    const startIndex = (currentTicketsPage - 1) * TICKETS_ROWS_PER_PAGE;
    const paginatedData = data.slice(startIndex, startIndex + TICKETS_ROWS_PER_PAGE);

    tableBody.innerHTML = paginatedData.map(ticket => buildTicketRowHtml(ticket)).join('');
    applyIconPlaceholders(tableBody);
    Permissions.applyButtonGating(tableBody);
}

const TICKET_STATUS_BADGE = {
    'مفتوحة': 'badge-ticket-open',
    'قيد المعالجة': 'badge-ticket-inprogress',
    'مغلقة': 'badge-ticket-closed'
};

function buildTicketRowHtml(ticket) {
    const statusBadgeClass = TICKET_STATUS_BADGE[ticket.status] || 'badge-ticket-open';
    const companyLabel = ticket.company_name || 'بدون شركة (عام)';
    const requesterName = ticket.created_by_name || ticket.created_by_email || 'غير معروف';
    const dateLabel = ticket.created_at ? ticket.created_at.slice(0, 10) : '—';

    const canDelete = isAdminScope() || (currentUserScope.userId && ticket.created_by === currentUserScope.userId);

    return `
        <tr>
            <td><span class="ticket-subject-cell">${escapeHtml(ticket.subject)}</span></td>
            <td>
                <div class="requester-cell">
                    <span class="requester-avatar">${(companyLabel || '?').trim().charAt(0)}</span>
                    <div class="requester-info">
                        <span class="requester-company">🏢 ${escapeHtml(companyLabel)}</span>
                        <span class="requester-name">${escapeHtml(requesterName)}</span>
                    </div>
                </div>
            </td>
            <td style="color:#475569;">📅 ${dateLabel}</td>
            <td style="text-align:center;"><span class="badge-ticket-status ${statusBadgeClass}">${ticket.status}</span></td>
            <td style="text-align:center;">
                <button class="action-icon-btn" title="عرض التذكرة" onclick="openTicketModal(${ticket.id})" data-icon="eye"></button>
                ${canDelete ? `<button class="action-icon-btn" style="color:#ef4444;" title="حذف" onclick="deleteTicket(${ticket.id})" data-icon="trash" data-perm="delete:support"></button>` : ''}
            </td>
        </tr>
    `;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

function setupTicketsPaginationControls(totalItems) {
    const container = document.getElementById('ticketsPagination');
    container.innerHTML = '';
    const totalPages = Math.ceil(totalItems / TICKETS_ROWS_PER_PAGE);
    if (totalPages <= 1) return;

    const prevBtn = document.createElement('button');
    prevBtn.innerHTML = '&rarr; السابقة';
    prevBtn.disabled = currentTicketsPage === 1;
    prevBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;' + (prevBtn.disabled ? 'opacity:0.5;' : '');
    prevBtn.onclick = () => { if (currentTicketsPage > 1) { currentTicketsPage--; renderTicketsTable(); } };
    container.appendChild(prevBtn);

    const label = document.createElement('span');
    label.style.cssText = 'font-size: 0.9rem; color: #475569; font-weight: 600; margin: 0 10px;';
    label.textContent = `صفحة ${currentTicketsPage} من ${totalPages}`;
    container.appendChild(label);

    const nextBtn = document.createElement('button');
    nextBtn.innerHTML = 'التالية &larr;';
    nextBtn.disabled = currentTicketsPage === totalPages;
    nextBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;' + (nextBtn.disabled ? 'opacity:0.5;' : '');
    nextBtn.onclick = () => { if (currentTicketsPage < totalPages) { currentTicketsPage++; renderTicketsTable(); } };
    container.appendChild(nextBtn);
}

// =========================================================================
// 7. حذف تذكرة
// =========================================================================
async function deleteTicket(ticketId) {
    if (!confirm('هل أنت متأكد من حذف هذه التذكرة؟ لا يمكن التراجع عن هذا الإجراء.')) return;
    try {
        const { error } = await dbClient.from('support_tickets').delete().eq('id', ticketId);
        if (error) throw error;
        await loadTickets();
    } catch (error) {
        console.error('تعذّر حذف التذكرة:', error.message);
        alert('فشلت العملية: ' + error.message);
    }
}

// =========================================================================
// 8. مكوّن قائمة قابلة للبحث (Searchable Combobox) — بنفس نمط بقية الشاشات
// =========================================================================
function setupSearchableCombobox({ inputId, hiddenId, dropdownId, getOptions, emptyText, onSelectExtra }) {
    const input = document.getElementById(inputId);
    const hidden = document.getElementById(hiddenId);
    const dropdown = document.getElementById(dropdownId);

    function renderOptions(filterText) {
        const options = getOptions();
        const normalized = (filterText || '').trim().toLowerCase();
        const filtered = normalized ? options.filter(opt => opt.label.toLowerCase().includes(normalized)) : options;

        dropdown.innerHTML = '';
        if (filtered.length === 0) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'combo-empty';
            emptyEl.textContent = emptyText || 'لا توجد نتائج مطابقة';
            dropdown.appendChild(emptyEl);
            return;
        }

        filtered.forEach(opt => {
            const item = document.createElement('div');
            item.className = 'combo-item';
            if (String(hidden.value) === String(opt.value)) item.classList.add('selected');
            item.textContent = opt.label;
            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                hidden.value = opt.value;
                input.value = opt.label;
                closeDropdown();
                if (onSelectExtra) onSelectExtra(opt);
            });
            dropdown.appendChild(item);
        });
    }

    function openDropdown() { renderOptions(''); dropdown.classList.add('open'); }
    function closeDropdown() { dropdown.classList.remove('open'); }

    input.addEventListener('focus', () => { input.select(); openDropdown(); });
    input.addEventListener('input', () => { renderOptions(input.value); dropdown.classList.add('open'); });
    input.addEventListener('blur', () => setTimeout(closeDropdown, 150));
    document.addEventListener('click', (e) => { if (!input.contains(e.target) && !dropdown.contains(e.target)) closeDropdown(); });

    return { refresh: () => renderOptions(input.value) };
}

// =========================================================================
// 9. نافذة تفاصيل/إدارة التذكرة
// =========================================================================
function openTicketModal(ticketId) {
    const ticket = fullTicketsDataset.find(t => t.id === ticketId);
    if (!ticket) return;

    document.getElementById('ticketId').value = ticket.id;
    document.getElementById('ticketMetaCompany').textContent = ticket.company_name || 'بدون شركة (عام)';
    document.getElementById('ticketMetaRequester').textContent = ticket.created_by_name || ticket.created_by_email || 'غير معروف';
    document.getElementById('ticketMetaDate').textContent = ticket.created_at ? ticket.created_at.slice(0, 10) : '—';
    document.getElementById('ticketMetaStatus').textContent = ticket.status;
    document.getElementById('ticketMetaSubject').textContent = ticket.subject;
    document.getElementById('ticketMetaDescription').textContent = ticket.description;

    hideTicketFormAlert();

    const isOwner = currentUserScope.userId && ticket.created_by === currentUserScope.userId;

    if (isAdminScope()) {
        // مسؤول النظام: يمكنه تعديل الحالة وكتابة رد دعم فني
        document.getElementById('ticketAdminControls').style.display = '';
        document.getElementById('ticketReplyReadonlyBlock').style.display = 'none';
        document.getElementById('ticketStatusSelect').value = ticket.status || 'مفتوحة';
        document.getElementById('ticketAdminReply').value = ticket.admin_reply || '';
        document.getElementById('btnSaveTicketUpdates').style.display = '';
        document.getElementById('btnOwnerCloseTicket').style.display = 'none';
    } else {
        // مسؤول الشركة أو موظف: عرض فقط لرد الدعم الفني (إن وُجد) + إمكانية إغلاق تذكرته بنفسه
        document.getElementById('ticketAdminControls').style.display = 'none';
        document.getElementById('btnSaveTicketUpdates').style.display = 'none';

        if (ticket.admin_reply) {
            document.getElementById('ticketReplyReadonlyBlock').style.display = '';
            document.getElementById('ticketReplyReadonlyText').textContent = ticket.admin_reply;
        } else {
            document.getElementById('ticketReplyReadonlyBlock').style.display = 'none';
        }

        document.getElementById('btnOwnerCloseTicket').style.display = (isOwner && ticket.status !== 'مغلقة') ? '' : 'none';
    }

    document.getElementById('ticketModal').style.display = 'flex';
    applyIconPlaceholders(document.getElementById('ticketModal'));
}

function closeTicketModal() {
    document.getElementById('ticketModal').style.display = 'none';
}

function showTicketFormAlert(message, type) {
    const alertBox = document.getElementById('ticketFormAlert');
    alertBox.textContent = message;
    alertBox.className = 'form-alert ' + (type === 'success' ? 'alert-success' : 'alert-error');
    alertBox.style.display = 'flex';
}
function hideTicketFormAlert() {
    document.getElementById('ticketFormAlert').style.display = 'none';
}

// حفظ تحديثات مسؤول النظام (الحالة + رد الدعم الفني)
async function handleSaveTicketUpdates() {
    const ticketId = document.getElementById('ticketId').value;
    const status = document.getElementById('ticketStatusSelect').value;
    const adminReply = document.getElementById('ticketAdminReply').value.trim();

    const btn = document.getElementById('btnSaveTicketUpdates');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'جاري الحفظ...';

    try {
        const { error } = await dbClient.from('support_tickets')
            .update({ status, admin_reply: adminReply || null, updated_at: new Date().toISOString() })
            .eq('id', ticketId);
        if (error) throw error;

        closeTicketModal();
        await loadTickets();
    } catch (error) {
        console.error('تعذّر حفظ تحديثات التذكرة:', error.message);
        showTicketFormAlert('فشلت العملية: ' + error.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

// إغلاق التذكرة من قِبل صاحبها مباشرة (زر سريع بلا نموذج)
async function handleOwnerCloseTicket() {
    const ticketId = document.getElementById('ticketId').value;
    const btn = document.getElementById('btnOwnerCloseTicket');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'جاري الإغلاق...';

    try {
        const { error } = await dbClient.from('support_tickets')
            .update({ status: 'مغلقة', updated_at: new Date().toISOString() })
            .eq('id', ticketId);
        if (error) throw error;

        closeTicketModal();
        await loadTickets();
    } catch (error) {
        console.error('تعذّر إغلاق التذكرة:', error.message);
        showTicketFormAlert('فشلت العملية: ' + error.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
}
