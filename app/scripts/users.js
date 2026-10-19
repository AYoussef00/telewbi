// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================

let localUsersCache = [];
let filteredUsersCache = [];
let editingUserId = null;

// إعدادات تقسيم الصفحات
let currentUserPage = 1;
const usersPerPage = 7;

// خرائط عرض النصوص العربية للأدوار
const ROLE_LABELS_AR = {
    super_admin: 'مدير عام النظام',
    admin: 'مسؤول',
    company: 'مسؤول شركة',
    employee: 'موظف'
};
const ROLE_LABELS_EN = {
    super_admin: 'Super Admin',
    admin: 'Admin',
    company: 'Company Admin',
    employee: 'Employee'
};

document.addEventListener('DOMContentLoaded', async () => {
    const allowed = await Permissions.guardPage('users');
    if (!allowed) return;

    fetchAndRenderUsers();

    const addUserBtn = document.querySelector('.btn-add-user');
    if (addUserBtn) {
        addUserBtn.addEventListener('click', () => {
            window.location.href = Routes.url('add_user');
        });
    }
});

// 📊 دالة جلب المستخدمين حياً من سوبابيس
async function fetchAndRenderUsers() {
    const tableBody = document.getElementById('usersTableBody');
    if (!tableBody) return;

    const { data: users, error } = await dbClient
        .from('users')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error("خطأ في الاتصال بقاعدة البيانات:", error.message);
        tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#ef4444; padding:20px;">فشل تحميل بيانات المستخدمين.</td></tr>`;
        return;
    }

    localUsersCache = users || [];
    filteredUsersCache = localUsersCache;
    currentUserPage = 1;

    renderUsersTable(filteredUsersCache);
}

// 📑 بناء صفوف الجدول
function renderUsersTable(data) {
    const tableBody = document.getElementById('usersTableBody');
    if (!tableBody) return;
    tableBody.innerHTML = '';

    if (data.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:30px; color:#94a3b8;">لا يوجد مستخدمون مطابقون لخيارات البحث.</td></tr>`;
        setupUserPaginationControls(0);
        return;
    }

    const isEnglish = document.documentElement.getAttribute('lang') === 'en';
    const roleLabels = isEnglish ? ROLE_LABELS_EN : ROLE_LABELS_AR;

    const startIndex = (currentUserPage - 1) * usersPerPage;
    const endIndex = startIndex + usersPerPage;
    const paginatedData = data.slice(startIndex, endIndex);

    paginatedData.forEach(user => {
        const row = document.createElement('tr');

        // توليد الأحرف الأولى للاسم
        const nameParts = (user.name || '').trim().split(' ').filter(p => p.length > 0);
        let initials = 'مس';
        if (nameParts.length >= 2) {
            initials = nameParts[0][0] + nameParts[1][0];
        } else if (nameParts.length === 1) {
            initials = nameParts[0].substring(0, 2);
        }

        const charCodeSum = [...initials].reduce((acc, char) => acc + char.charCodeAt(0), 0);
        let prefixColorClass = 'prefix-blue';
        if (charCodeSum % 2 === 0) prefixColorClass = 'prefix-yellow';
        if (charCodeSum % 3 === 0) prefixColorClass = 'prefix-orange';

        const roleText = roleLabels[user.role] || user.role || '----';
        const statusActive = (user.status || 'active') === 'active';
        const statusText = statusActive ? (isEnglish ? 'Active' : 'نشط') : (isEnglish ? 'Inactive' : 'غير نشط');
        const statusClass = statusActive ? 'status-badge-active' : 'status-badge-inactive';

        row.innerHTML = `
            <td>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <span class="company-prefix ${prefixColorClass}">${initials}</span>
                    <strong style="color: #1e293b;">${user.name || '----'}</strong>
                </div>
            </td>
            <td style="color: #475569; font-family: monospace;">${user.email || '----'}</td>
            <td style="color: #475569; font-family: monospace;" dir="ltr">${user.phone || '----'}</td>
            <td><span class="role-badge">${roleText}</span></td>
            <td style="text-align: center;">
                <span class="${statusClass}">${statusText}</span>
            </td>
            <td style="text-align: center;">
                <button class="action-icon-btn" data-perm="edit:users" title="تعديل بيانات المستخدم" onclick="editUser('${user.id}')">${ICONS.edit}</button>
                <button class="action-icon-btn" data-perm="delete:users" style="color:#ef4444;" title="حذف المستخدم" onclick="deleteUser('${user.id}')">${ICONS.trash}</button>
            </td>
        `;
        tableBody.appendChild(row);
    });

    // 🔐 كشف الأزرار المقيّدة بالصلاحيات (تعديل/حذف) فور إدراجها بالجدول
    Permissions.applyButtonGating(tableBody);

    setupUserPaginationControls(data.length);
}

// 📟 بناء عناصر التحكم بالصفحات
function setupUserPaginationControls(totalItems) {
    const controlsContainer = document.getElementById('usersPagination');
    if (!controlsContainer) return;
    controlsContainer.innerHTML = '';

    const totalPages = Math.ceil(totalItems / usersPerPage);
    if (totalPages <= 1) return;

    const isEnglish = document.documentElement.getAttribute('lang') === 'en';

    const prevBtn = document.createElement('button');
    prevBtn.innerHTML = isEnglish ? '&larr; Prev' : '&rarr; السابقة';
    prevBtn.disabled = currentUserPage === 1;
    prevBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;';
    if (prevBtn.disabled) prevBtn.style.opacity = '0.5';
    prevBtn.onclick = () => {
        if (currentUserPage > 1) {
            currentUserPage--;
            renderUsersTable(filteredUsersCache);
        }
    };
    controlsContainer.appendChild(prevBtn);

    const countLabel = document.createElement('span');
    countLabel.style.cssText = 'font-size: 0.9rem; color: #475569; font-weight: 600; font-family: system-ui, sans-serif; margin: 0 10px;';
    countLabel.textContent = isEnglish ? `Page ${currentUserPage} of ${totalPages}` : `صفحة ${currentUserPage} من ${totalPages}`;
    controlsContainer.appendChild(countLabel);

    const nextBtn = document.createElement('button');
    nextBtn.innerHTML = isEnglish ? 'Next &rarr;' : 'التالية &larr;';
    nextBtn.disabled = currentUserPage === totalPages;
    nextBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;';
    if (nextBtn.disabled) nextBtn.style.opacity = '0.5';
    nextBtn.onclick = () => {
        if (currentUserPage < totalPages) {
            currentUserPage++;
            renderUsersTable(filteredUsersCache);
        }
    };
    controlsContainer.appendChild(nextBtn);
}

// 🔍 دالة البحث والفلترة المشتركة (اسم/بريد + دور + حالة)
function handleFilterChange() {
    const text = (document.getElementById('userSearchInput').value || '').toLowerCase().trim();
    const roleValue = document.getElementById('roleFilter').value;
    const statusValue = document.getElementById('statusFilter').value;

    filteredUsersCache = localUsersCache.filter(u => {
        const matchesText = !text ||
            (u.name && u.name.toLowerCase().includes(text)) ||
            (u.email && u.email.toLowerCase().includes(text)) ||
            (u.phone && u.phone.includes(text));

        const matchesRole = roleValue === 'all' || u.role === roleValue;
        const matchesStatus = statusValue === 'all' || (u.status || 'active') === statusValue;

        return matchesText && matchesRole && matchesStatus;
    });

    currentUserPage = 1;
    renderUsersTable(filteredUsersCache);
}

// 📝 فتح مودال التعديل وتعبئة الحقول
function editUser(id) {
    const user = localUsersCache.find(u => String(u.id) === String(id));
    if (!user) return;

    editingUserId = id;

    document.getElementById('modalUserName').value = user.name || '';
    document.getElementById('modalUserEmail').value = user.email || '';
    document.getElementById('modalUserPhone').value = user.phone || '';
    document.getElementById('modalUserRole').value = user.role || 'employee';
    document.getElementById('modalUserStatus').value = user.status || 'active';

    document.getElementById('editUserModal').classList.add('open');

    // 🔐 التأكد من تطبيق تقييد الصلاحيات على أزرار المودال عند فتحه
    Permissions.applyButtonGating(document.getElementById('editUserModal'));
}

// إغلاق مودال التعديل
function closeUserModal() {
    document.getElementById('editUserModal').classList.remove('open');
    document.getElementById('editUserForm').reset();
    editingUserId = null;
}

// 💾 حفظ التعديلات على المستخدم
async function handleUserSubmission(event) {
    event.preventDefault();
    if (!editingUserId) return;

    const isEnglish = document.documentElement.getAttribute('lang') === 'en';

    const payload = {
        name: document.getElementById('modalUserName').value.trim(),
        email: document.getElementById('modalUserEmail').value.trim().toLowerCase(),
        phone: document.getElementById('modalUserPhone').value.trim(),
        role: document.getElementById('modalUserRole').value,
        status: document.getElementById('modalUserStatus').value
    };

    try {
        // فحص عدم تكرار البريد الإلكتروني لدى مستخدم آخر
        const { data: existingUser, error: checkError } = await dbClient
            .from('users')
            .select('id')
            .eq('email', payload.email)
            .neq('id', editingUserId)
            .maybeSingle();

        if (checkError) throw new Error(checkError.message);

        if (existingUser) {
            alert(isEnglish ? 'This email is already used by another user!' : 'هذا البريد الإلكتروني مستخدم من قبل مستخدم آخر!');
            return;
        }

        const { error } = await dbClient
            .from('users')
            .update(payload)
            .eq('id', editingUserId);

        if (error) throw new Error(error.message);

        alert(isEnglish ? 'User updated successfully!' : 'تم تحديث بيانات المستخدم بنجاح!');
        closeUserModal();
        await fetchAndRenderUsers();

    } catch (error) {
        console.error("Update Error:", error.message);
        alert((isEnglish ? 'Update failed: ' : 'فشل التحديث: ') + error.message);
    }
}

// 🗑️ حذف مستخدم نهائياً بعد التأكيد
async function deleteUser(id) {
    const isEnglish = document.documentElement.getAttribute('lang') === 'en';
    const confirmMessage = isEnglish
        ? "Are you sure you want to permanently delete this user?"
        : "هل أنت متأكد من حذف هذا المستخدم نهائياً؟";

    if (!confirm(confirmMessage)) return;

    try {
        const { error } = await dbClient
            .from('users')
            .delete()
            .eq('id', id);

        if (error) throw error;

        alert(isEnglish ? "User deleted successfully!" : "تم حذف المستخدم بنجاح!");
        await fetchAndRenderUsers();
    } catch (error) {
        console.error("Error deleting user:", error.message);
        alert((isEnglish ? "Delete failed: " : "فشل الحذف: ") + error.message);
    }
}