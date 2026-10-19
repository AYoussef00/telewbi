// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================

// =========================================================================
// شاشة "أنواع التحصيل": إدارة طرق التحصيل (كاش/بنك/أي طريقة يضيفها المستخدم)
// التي تظهر كخيار عند تعليم تحصيل موظف كمدفوع بشاشة "تحصيل الموظفين" —
// فقط الطرق "النشطة" تظهر كخيار جديد؛ "الموقَفة" تبقى محفوظة لتاريخها لكنها
// لا تظهر كخيار جديد بعد الآن. انظر جدول collection_types (سكربت الإعداد
// collection_types_setup.sql) وعمود employee_collections.collection_type_id.
// =========================================================================

let localCollectionTypesCache = [];
let filteredCollectionTypesCache = [];
let currentCollectionTypesPage = 1;
const collectionTypesPerPage = 15;

document.addEventListener('DOMContentLoaded', async () => {
    const allowed = await Permissions.guardPage('collection_types');
    if (!allowed) return;

    await fetchAndRenderCollectionTypes();

    document.getElementById('btnAddCollectionType').addEventListener('click', () => openCollectionTypeModal(null));
    document.getElementById('btnCloseCollectionTypeModal').addEventListener('click', closeCollectionTypeModal);
    document.getElementById('btnCancelCollectionTypeModal').addEventListener('click', closeCollectionTypeModal);
    document.getElementById('collectionTypeForm').addEventListener('submit', handleCollectionTypeFormSubmit);

    document.getElementById('collectionTypeSearchInput').addEventListener('input', (e) => {
        applyCollectionTypesFilter((e.target.value || '').toLowerCase().trim());
    });
});

// =========================================================================
// 2. جلب القائمة
// =========================================================================
async function fetchAndRenderCollectionTypes() {
    const tableBody = document.getElementById('collectionTypesTableBody');
    try {
        const { data, error } = await dbClient
            .from('collection_types')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw new Error(error.message);

        localCollectionTypesCache = data || [];
        applyCollectionTypesFilter('');
    } catch (error) {
        console.error('تعذّر تحميل أنواع التحصيل:', error.message);
        tableBody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#ef4444; padding:20px;">تعذّر تحميل أنواع التحصيل: ${error.message} — تأكد من تنفيذ سكربت إعداد قاعدة البيانات الخاص بهذه الميزة (collection_types_setup.sql).</td></tr>`;
    }
}

function applyCollectionTypesFilter(searchText) {
    filteredCollectionTypesCache = !searchText
        ? localCollectionTypesCache
        : localCollectionTypesCache.filter(t => (t.name || '').toLowerCase().includes(searchText));
    currentCollectionTypesPage = 1;
    renderCollectionTypesTable();
}

// 📅 تنسيق تاريخ بصيغة DD/MM/YYYY
function formatCollectionTypeDate(dateStr) {
    if (!dateStr) return '—';
    const datePart = String(dateStr).split('T')[0];
    const parts = datePart.split('-');
    if (parts.length !== 3) return String(dateStr);
    const [y, m, d] = parts;
    return `${d}/${m}/${y}`;
}

// =========================================================================
// 3. بناء الجدول
// =========================================================================
function renderCollectionTypesTable() {
    const tableBody = document.getElementById('collectionTypesTableBody');
    if (!tableBody) return;

    RowActions.closeMenu();
    if (filteredCollectionTypesCache.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:30px; color:#94a3b8;">لا توجد أنواع تحصيل مطابقة.</td></tr>`;
        setupCollectionTypesPaginationControls(0);
        return;
    }

    const startIndex = (currentCollectionTypesPage - 1) * collectionTypesPerPage;
    const paginatedData = filteredCollectionTypesCache.slice(startIndex, startIndex + collectionTypesPerPage);

    tableBody.innerHTML = paginatedData.map(t => {
        const isActive = t.status === 'active';
        const statusBadge = isActive
            ? `<span class="status-badge-active">نشط</span>`
            : `<span class="status-badge-inactive">غير نشط</span>`;
        return `
            <tr data-type-id="${t.id}">
                <td><strong style="color:#1e293b;">${t.name}</strong></td>
                <td style="text-align:center;">${statusBadge}</td>
                <td style="text-align:center; color:#94a3b8; font-size:12.5px;">${formatCollectionTypeDate(t.created_at)}</td>
                <td style="text-align:center;"><div class="ra-actions-cell">
                    <button type="button" class="ra-more-btn ct-edit-btn" data-perm="edit:collection_types" title="تعديل الاسم" aria-label="تعديل الاسم">${ICONS.edit}</button>
                    <button type="button" class="ra-more-btn ct-more-btn" data-perm="edit:collection_types,delete:collection_types" title="المزيد من الخيارات" aria-haspopup="menu" aria-label="المزيد من الخيارات">${RowActions.MORE_ICON_SVG}</button>
                </div></td>
            </tr>
        `;
    }).join('');

    if (window.applyIconPlaceholders) applyIconPlaceholders(tableBody);

    // 🆕 أسلوب الأيقونات الجديد: زر تعديل ظاهر + زر ثلاث نقاط (⋮) تفتح قائمة
    // بباقي الخيارات (إيقاف/تفعيل، حذف) — انظر row-actions.js
    tableBody.querySelectorAll('tr[data-type-id]').forEach(tr => {
        const typeId = tr.getAttribute('data-type-id');
        const row = localCollectionTypesCache.find(t => String(t.id) === String(typeId));
        if (!row) return;
        const isActive = row.status === 'active';

        const editBtn = tr.querySelector('.ct-edit-btn');
        if (editBtn) editBtn.addEventListener('click', (e) => { e.stopPropagation(); RowActions.closeMenu(); editCollectionTypeRow(row.id); });

        const moreBtn = tr.querySelector('.ct-more-btn');
        if (moreBtn) moreBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            RowActions.openMenu(moreBtn, [
                isActive
                    ? { perm: 'edit:collection_types', icon: ICONS.refresh || '', label: 'إيقاف', run: () => toggleCollectionTypeStatus(row.id, 'inactive') }
                    : { perm: 'edit:collection_types', icon: ICONS['check-circle'] || '', label: 'تفعيل', run: () => toggleCollectionTypeStatus(row.id, 'active') },
                { divider: true, perm: 'delete:collection_types' },
                { perm: 'delete:collection_types', icon: ICONS.trash || '', label: 'حذف', danger: true, run: () => deleteCollectionType(row.id) }
            ]);
        });
    });

    setupCollectionTypesPaginationControls(filteredCollectionTypesCache.length);
    Permissions.applyButtonGating(tableBody);
}

function setupCollectionTypesPaginationControls(totalItems) {
    const container = document.getElementById('collectionTypesPagination');
    if (!container) return;
    container.innerHTML = '';

    const totalPages = Math.ceil(totalItems / collectionTypesPerPage);
    if (totalPages <= 1) return;

    const prevBtn = document.createElement('button');
    prevBtn.innerHTML = '&rarr; السابقة';
    prevBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;';
    prevBtn.disabled = currentCollectionTypesPage === 1;
    if (prevBtn.disabled) prevBtn.style.opacity = '0.5';
    prevBtn.onclick = () => { if (currentCollectionTypesPage > 1) { currentCollectionTypesPage--; renderCollectionTypesTable(); } };
    container.appendChild(prevBtn);

    const countLabel = document.createElement('span');
    countLabel.style.cssText = 'font-size: 0.9rem; color: #475569; font-weight: 600; margin: 0 10px;';
    countLabel.textContent = `صفحة ${currentCollectionTypesPage} من ${totalPages}`;
    container.appendChild(countLabel);

    const nextBtn = document.createElement('button');
    nextBtn.innerHTML = 'التالية &larr;';
    nextBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;';
    nextBtn.disabled = currentCollectionTypesPage === totalPages;
    if (nextBtn.disabled) nextBtn.style.opacity = '0.5';
    nextBtn.onclick = () => { if (currentCollectionTypesPage < totalPages) { currentCollectionTypesPage++; renderCollectionTypesTable(); } };
    container.appendChild(nextBtn);
}

// =========================================================================
// 4. إضافة / تعديل
// =========================================================================
function openCollectionTypeModal(typeId) {
    const titleEl = document.getElementById('collectionTypeModalTitle');
    const idInput = document.getElementById('collectionTypeId');
    const nameInput = document.getElementById('collectionTypeName');

    document.getElementById('error-collection_type_name').textContent = '';
    hideCollectionTypeModalAlert();

    if (typeId) {
        const row = localCollectionTypesCache.find(t => String(t.id) === String(typeId));
        if (!row) return;
        titleEl.textContent = 'تعديل طريقة تحصيل';
        idInput.value = row.id;
        nameInput.value = row.name;
    } else {
        titleEl.textContent = 'إضافة طريقة تحصيل';
        idInput.value = '';
        nameInput.value = '';
    }

    document.getElementById('collectionTypeModal').classList.add('open');
    nameInput.focus();
}

function editCollectionTypeRow(typeId) { openCollectionTypeModal(typeId); }

function closeCollectionTypeModal() {
    document.getElementById('collectionTypeModal').classList.remove('open');
}

function showCollectionTypeModalAlert(message, type) {
    const alertBox = document.getElementById('collectionTypeModalAlert');
    alertBox.textContent = message;
    alertBox.className = 'form-alert ' + (type === 'success' ? 'alert-success' : 'alert-error');
    alertBox.style.display = 'block';
}
function hideCollectionTypeModalAlert() {
    const alertBox = document.getElementById('collectionTypeModalAlert');
    if (alertBox) alertBox.style.display = 'none';
}

async function handleCollectionTypeFormSubmit(event) {
    event.preventDefault();
    hideCollectionTypeModalAlert();

    const typeId = document.getElementById('collectionTypeId').value;
    const name = document.getElementById('collectionTypeName').value.trim();

    if (!name) {
        document.getElementById('error-collection_type_name').textContent = 'الرجاء إدخال اسم طريقة التحصيل.';
        return;
    }
    document.getElementById('error-collection_type_name').textContent = '';

    // منع تكرار نفس الاسم (بغض النظر عن حالة الأحرف)، باستثناء السجل الحالي عند التعديل
    const isDuplicate = localCollectionTypesCache.some(t =>
        t.name.trim().toLowerCase() === name.toLowerCase() && String(t.id) !== String(typeId)
    );
    if (isDuplicate) {
        document.getElementById('error-collection_type_name').textContent = 'توجد طريقة تحصيل بنفس هذا الاسم مسبقاً.';
        return;
    }

    const submitBtn = event.target.querySelector('.btn-modal-save');
    const originalText = submitBtn ? submitBtn.textContent : '';
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'جاري الحفظ...'; }

    try {
        if (typeId) {
            const { data, error } = await dbClient.from('collection_types').update({ name }).eq('id', typeId).select();
            if (error) throw new Error(error.message);
            if (!data || data.length === 0) throw new Error('لم يتم حفظ التعديل فعلياً — تحقق من سياسات RLS على جدول collection_types.');
        } else {
            const { data, error } = await dbClient.from('collection_types').insert([{ name, status: 'active' }]).select();
            if (error) throw new Error(error.message);
            if (!data || data.length === 0) throw new Error('لم تتم الإضافة فعلياً — تحقق من سياسات RLS على جدول collection_types.');
        }

        closeCollectionTypeModal();
        await fetchAndRenderCollectionTypes();
    } catch (error) {
        console.error('Collection Type Save Error:', error);
        showCollectionTypeModalAlert('فشلت العملية: ' + error.message, 'error');
    } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = originalText; }
    }
}

// =========================================================================
// 5. تفعيل / إيقاف
// =========================================================================
async function toggleCollectionTypeStatus(typeId, newStatus) {
    const row = localCollectionTypesCache.find(t => String(t.id) === String(typeId));
    if (!row) return;

    const confirmMsg = newStatus === 'inactive'
        ? `هل تريد إيقاف طريقة التحصيل "${row.name}"؟ لن تظهر بعد ذلك كخيار جديد بشاشة تحصيل الموظفين (السجلات السابقة التي استخدمتها تبقى كما هي).`
        : `هل تريد إعادة تفعيل طريقة التحصيل "${row.name}"؟`;
    if (!confirm(confirmMsg)) return;

    try {
        const { data, error } = await dbClient.from('collection_types').update({ status: newStatus }).eq('id', typeId).select();
        if (error) throw new Error(error.message);
        if (!data || data.length === 0) {
            alert('لم يتم حفظ تغيير الحالة فعلياً — تحقق من سياسات RLS على جدول collection_types.');
            return;
        }
        await fetchAndRenderCollectionTypes();
    } catch (error) {
        console.error('Toggle Collection Type Status Error:', error);
        alert('فشلت العملية: ' + error.message);
    }
}

// =========================================================================
// 6. حذف
// =========================================================================
async function deleteCollectionType(typeId) {
    const row = localCollectionTypesCache.find(t => String(t.id) === String(typeId));
    if (!row) return;

    if (!confirm(`هل أنت متأكد من حذف طريقة التحصيل "${row.name}" نهائياً؟ سجلات التحصيل السابقة التي استخدمتها ستبقى محفوظة، لكنها ستفقد ربطها بهذه الطريقة تحديداً.`)) return;

    try {
        const { data, error } = await dbClient.from('collection_types').delete().eq('id', typeId).select();
        if (error) throw error;
        if (!data || data.length === 0) {
            alert('فشل الحذف: قد لا تملك صلاحية حذف هذا السجل (تحقق من سياسة RLS الخاصة بجدول collection_types).');
            return;
        }
        await fetchAndRenderCollectionTypes();
    } catch (error) {
        console.error('Delete Collection Type Error:', error);
        alert('فشل الحذف: ' + error.message);
    }
}
