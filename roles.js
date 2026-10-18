// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================
const SUPABASE_URL = "https://mcdhxdfkuokhmhtfvjev.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_yt9V8lsNU1zN3Ix2CvovbQ_QCA2VDdM";
const dbClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// خرائط عرض النصوص العربية للأدوار (من المحرّك المشترك permissions.js)
const ROLE_LABELS_AR = Permissions.ROLE_LABELS_AR;

// 🏛️ الأدوار الأساسية الثابتة بالنظام (لا يمكن حذفها من هذه الشاشة، ودائماً
// تظهر كتبويبات حتى لو لم يُحفَظ لها صف بجدول role_permissions بعد).
const BASE_ROLES = [
    { key: 'super_admin', label: 'مدير عام النظام', icon: 'crown', builtin: true },
    { key: 'admin', label: 'مسؤول', icon: 'user-tie', builtin: true },
    { key: 'company', label: 'مسؤول شركة', icon: 'building', builtin: true },
    { key: 'employee', label: 'موظف', icon: 'person', builtin: true }
];

let currentSelectedRole = 'super_admin';
const rolePermissionsCache = {}; // تخزين مؤقت لتقليل عدد الاستعلامات أثناء التنقل بين الأدوار

// 📋 قائمة كل الأدوار المعروضة حالياً كتبويبات: الأساسية + أي أدوار مخصصة
// تم إنشاؤها لاحقاً عبر "إضافة دور جديد" (تُكتشف من الصفوف الموجودة فعلياً
// بجدول role_permissions التي لا تطابق أياً من مفاتيح BASE_ROLES).
let allRolesList = [...BASE_ROLES];

document.addEventListener('DOMContentLoaded', async () => {
    // 🔒 هذه الشاشة تتحكم بصلاحيات كل الأدوار — وصولها مقفل دائماً على مدير
    // عام النظام فقط، بمعزل عن أي إعداد صلاحيات قابل للتخصيص (انظر التعليق
    // أعلى Permissions.guardSuperAdminOnly بملف permissions.js).
    const allowed = await Permissions.guardSuperAdminOnly();
    if (!allowed) return;

    buildPermissionsTable();

    document.getElementById('btnSaveRolePermissions').addEventListener('click', saveCurrentRolePermissions);
    document.getElementById('btnSelectAll').addEventListener('click', () => {
        getAllPermissionCheckboxes().forEach(cb => { if (!cb.disabled) cb.checked = true; });
    });
    document.getElementById('btnClearAll').addEventListener('click', () => {
        getAllPermissionCheckboxes().forEach(cb => { if (!cb.disabled) cb.checked = false; });
    });

    document.getElementById('btnAddNewRole').addEventListener('click', handleAddNewRole);
    document.getElementById('newRoleNameInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); handleAddNewRole(); }
    });

    // 🏛️ يبني تبويبات الأدوار (الأساسية + المخصصة) وقائمة "تعيين دور لمستخدم"
    await loadAllRoles();
    loadPermissionsForRole(currentSelectedRole);

    // 🙍 تهيئة قسم "تعيين دور لمستخدم"
    loadUsersForRoleAssignCombobox();
    document.getElementById('btnAssignUserRole').addEventListener('click', handleAssignUserRole);
});

// =========================================================================
// 🏛️ إدارة قائمة الأدوار: تحميل/بناء التبويبات + إضافة دور جديد + حذف دور
// مخصص (بعد التأكد أنه لا يوجد مستخدمون مُعيَّن لهم حالياً)
// =========================================================================

// 📥 يجلب كل الأدوار المخصصة المحفوظة فعلياً (من role_permissions) ويدمجها مع
// الأدوار الأساسية الثابتة BASE_ROLES، ثم يبني التبويبات وقائمة تعيين الدور
async function loadAllRoles() {
    try {
        const { data, error } = await dbClient.from('role_permissions').select('role');
        if (error) throw new Error(error.message);

        const baseKeys = new Set(BASE_ROLES.map(r => r.key));
        const customKeys = Array.from(new Set((data || [])
            .map(row => row.role)
            .filter(role => role && !baseKeys.has(role))));

        allRolesList = [
            ...BASE_ROLES,
            ...customKeys.map(key => ({ key, label: key, icon: 'person', builtin: false }))
        ];
    } catch (error) {
        console.error('تعذّر تحميل قائمة الأدوار المخصصة:', error.message);
        allRolesList = [...BASE_ROLES];
    }

    renderRoleTabs();
    populateAssignRoleSelect();
}

// 🧱 يبني أزرار تبويبات الأدوار ديناميكياً من allRolesList، مع أيقونة حذف صغيرة
// (✕) بجانب الأدوار المخصصة فقط (الأدوار الأساسية BASE_ROLES غير قابلة للحذف)
function renderRoleTabs() {
    const container = document.getElementById('roleTabs');
    if (!container) return;

    container.innerHTML = allRolesList.map(r => `
        <button type="button" class="role-tab ${r.key === currentSelectedRole ? 'active' : ''}" data-role="${r.key}">
            <span data-icon="${r.icon || 'person'}" class="icon-inline"></span> ${r.label}
            ${r.builtin ? '' : `<span class="role-tab-remove" data-remove-role="${r.key}" title="حذف هذا الدور">✕</span>`}
        </button>
    `).join('');

    if (typeof applyIconPlaceholders === 'function') applyIconPlaceholders(container);

    container.querySelectorAll('.role-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            if (e.target.closest('[data-remove-role]')) return; // التعامل معها منفصلاً أدناه
            container.querySelectorAll('.role-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentSelectedRole = tab.getAttribute('data-role');
            loadPermissionsForRole(currentSelectedRole);
        });
    });

    container.querySelectorAll('[data-remove-role]').forEach(removeBtn => {
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleDeleteRole(removeBtn.getAttribute('data-remove-role'));
        });
    });
}

// 🔄 يعيد بناء خيارات قائمة "الدور الجديد" بقسم "تعيين دور لمستخدم" لتشمل أي
// أدوار مخصصة تم إنشاؤها، مع الحفاظ على القيمة المختارة حالياً إن كانت لا تزال متاحة
function populateAssignRoleSelect() {
    const select = document.getElementById('userRoleNewSelect');
    if (!select) return;
    const previousValue = select.value;
    select.innerHTML = allRolesList.map(r => `<option value="${r.key}">${r.label}</option>`).join('');
    if (allRolesList.some(r => r.key === previousValue)) select.value = previousValue;
}

// ➕ إنشاء دور جديد: يُحفَظ فوراً بجدول role_permissions بلا أي صلاحيات ممنوحة
// (menus: []) — بداية آمنة افتراضياً (بدل "الكل مسموح" التي تُطبَّق فقط لو لم
// يوجد صف محفوظ إطلاقاً)، ثم يُضاف كتبويب جديد وتُفتح صلاحياته للتحديد فوراً
async function handleAddNewRole() {
    hideRolesAlert();
    const input = document.getElementById('newRoleNameInput');
    const raw = (input.value || '').trim();

    if (!raw) {
        showRolesAlert('الرجاء إدخال اسم للدور الجديد.', 'error');
        return;
    }
    if (allRolesList.some(r => r.key === raw)) {
        showRolesAlert('يوجد دور بهذا الاسم بالفعل.', 'error');
        return;
    }

    const addBtn = document.getElementById('btnAddNewRole');
    addBtn.disabled = true;

    try {
        const { error } = await dbClient
            .from('role_permissions')
            .upsert([{ role: raw, menus: [] }], { onConflict: 'role' });

        if (error) throw new Error(error.message);

        allRolesList.push({ key: raw, label: raw, icon: 'person', builtin: false });
        rolePermissionsCache[raw] = new Set(); // دور جديد ⇐ بلا أي صلاحيات ممنوحة افتراضياً

        input.value = '';
        currentSelectedRole = raw;

        renderRoleTabs();
        populateAssignRoleSelect();
        loadPermissionsForRole(raw);

        showRolesAlert(`تم إنشاء الدور "${raw}" بنجاح. حدّد له الصلاحيات المناسبة أدناه ثم اضغط "حفظ صلاحيات هذا الدور".`, 'success');
    } catch (error) {
        console.error('فشل إنشاء الدور الجديد:', error.message);
        showRolesAlert('فشل إنشاء الدور: ' + error.message, 'error');
    } finally {
        addBtn.disabled = false;
    }
}

// 🗑️ حذف دور مخصص نهائياً — محمي بفحص مسبق: يُرفض الحذف لو كان هناك مستخدمون
// مُعيَّن لهم هذا الدور حالياً بجدول users، تجنباً لتحويلهم بالخطأ لحالة "كل
// الصلاحيات مسموحة افتراضياً" (وهي القاعدة المطبَّقة تلقائياً عند غياب صف
// محفوظ بجدول role_permissions لدور ما).
async function handleDeleteRole(roleKey) {
    const roleInfo = allRolesList.find(r => r.key === roleKey);
    if (!roleInfo || roleInfo.builtin) return;

    try {
        const { count, error: countError } = await dbClient
            .from('users')
            .select('id', { count: 'exact', head: true })
            .eq('role', roleKey);

        if (countError) throw new Error(countError.message);

        if (count && count > 0) {
            alert(`لا يمكن حذف هذا الدور: يوجد ${count} مستخدم/مستخدمين مُعيَّن لهم هذا الدور حالياً. أعد تعيين دورهم أولاً من قسم "تعيين دور لمستخدم" أعلى الصفحة ثم أعد المحاولة.`);
            return;
        }
    } catch (error) {
        alert('تعذّر التحقق من مستخدمي هذا الدور: ' + error.message);
        return;
    }

    if (!confirm(`هل أنت متأكد من حذف الدور "${roleInfo.label}" نهائياً؟ سيتم حذف كل إعدادات صلاحياته المحفوظة.`)) return;

    try {
        const { error } = await dbClient.from('role_permissions').delete().eq('role', roleKey);
        if (error) throw new Error(error.message);

        allRolesList = allRolesList.filter(r => r.key !== roleKey);
        delete rolePermissionsCache[roleKey];

        if (currentSelectedRole === roleKey) currentSelectedRole = 'super_admin';

        renderRoleTabs();
        populateAssignRoleSelect();
        loadPermissionsForRole(currentSelectedRole);

        showRolesAlert(`تم حذف الدور "${roleInfo.label}" بنجاح.`, 'success');
    } catch (error) {
        console.error('فشل حذف الدور:', error.message);
        alert('فشل حذف الدور: ' + error.message);
    }
}

// =========================================================================
// 🛡️ بناء جدول صلاحيات CRUD ديناميكياً من Permissions.SECTIONS (مصدر واحد
// مشترك مع محرّك الصلاحيات نفسه — أي قسم جديد يُضاف مستقبلاً هناك يظهر هنا
// تلقائياً بلا حاجة لتعديل هذا الملف)
// =========================================================================
function buildPermissionsTable() {
    const tbody = document.getElementById('permTableBody');
    if (!tbody) return;

    // 📂 أقسام "المالية" و"التقارير" أصبحت عناوين تجميعية بلا صلاحية خاصة بها:
    // تُعرَض كصف عنوان غير قابل للتحديد، تليه صفوف عناصرها الفرعية (كل عنصر
    // فرعي بصلاحياته المستقلة view/add/edit/delete الخاصة به وحده)
    tbody.innerHTML = Permissions.SECTIONS.map(section => {
        if (Array.isArray(section.children) && section.children.length > 0) {
            const groupHeaderRow = `
                <tr class="perm-group-header-row">
                    <td colspan="${Permissions.ACTIONS.length + 1}">
                        <span class="perm-group-header-cell">
                            <span data-icon="${section.icon}"></span>
                            ${section.label}
                        </span>
                    </td>
                </tr>
            `;
            return groupHeaderRow + section.children.map(child => buildPermissionRowHtml(child, true)).join('');
        }
        return buildPermissionRowHtml(section, false);
    }).join('');

    if (typeof applyIconPlaceholders === 'function') applyIconPlaceholders(tbody);
}

// 🧱 صف واحد بجدول الصلاحيات (قسم عادي أو عنصر فرعي تابع لقسم مجمَّع)
//
// ⚠️ بعض الأقسام تُعرِّف hiddenActions (مصفوفة إجراءات لا تنطبق عليها إطلاقاً
// — مثال: قسم "الفواتير" لم يعد له عمود "إضافة" لأن إصدار الفاتورة أصبح
// صلاحية مستقلة قائمة بذاتها "إصدار فاتورة"، وهذه الصلاحية المستقلة بالمقابل
// ليس لها أي معنى لأعمدة عرض/تعديل/حذف). لكل إجراء ضمن hiddenActions تُعرَض
// خلية فارغة معطّلة بدل checkbox فعلي، فلا تدخل أصلاً ضمن أي querySelectorAll
// لعناصر checkbox (تحديد الكل/إلغاء التحديد/الحفظ/التحميل)، بلا حاجة لأي
// استثناء إضافي بتلك الدوال.
function buildPermissionRowHtml(section, isChild) {
    const hidden = new Set(section.hiddenActions || []);
    return `
        <tr data-section-row="${section.key}" class="${isChild ? 'perm-child-row' : ''}">
            <td>
                <span class="perm-section-cell ${isChild ? 'perm-section-cell-child' : ''}">
                    <span data-icon="${section.icon}"></span>
                    ${section.label}
                </span>
            </td>
            ${Permissions.ACTIONS.map(action => {
                if (hidden.has(action)) {
                    return `<td class="perm-cell-na" aria-hidden="true">—</td>`;
                }
                return `
                <td>
                    <input type="checkbox" value="${action}:${section.key}" title="${Permissions.ACTION_LABELS_AR[action]} — ${section.label}">
                </td>
            `;
            }).join('')}
        </tr>
    `;
}

// 🔗 كل عناصر checkbox الخاصة بصلاحيات الجدول
function getAllPermissionCheckboxes() {
    return document.querySelectorAll('#permTableBody input[type="checkbox"]');
}

// 📥 جلب الصلاحيات المحفوظة لدور معيّن وعرضها بالجدول
async function loadPermissionsForRole(role) {
    hideRolesAlert();

    const superAdminNotice = document.getElementById('superAdminNotice');
    const tableWrapper = document.getElementById('permTableWrapper');
    const saveBtn = document.getElementById('btnSaveRolePermissions');
    const selectAllBtn = document.getElementById('btnSelectAll');
    const clearAllBtn = document.getElementById('btnClearAll');

    // مدير عام النظام: صلاحياته ثابتة (كل شيء) وغير قابلة للتعديل من هذه الشاشة
    if (role === 'super_admin') {
        superAdminNotice.style.display = 'flex';
        setChecklistState(null); // null = الكل مُحدَّد (كل الصلاحيات ممنوحة دائماً)
        setChecklistDisabled(true);
        saveBtn.disabled = true;
        selectAllBtn.disabled = true;
        clearAllBtn.disabled = true;
        return;
    }

    superAdminNotice.style.display = 'none';
    setChecklistDisabled(false);
    saveBtn.disabled = false;
    selectAllBtn.disabled = false;
    clearAllBtn.disabled = false;

    if (rolePermissionsCache[role]) {
        setChecklistState(rolePermissionsCache[role]);
        return;
    }

    tableWrapper.classList.add('loading');

    try {
        const { data, error } = await dbClient
            .from('role_permissions')
            .select('menus')
            .eq('role', role)
            .maybeSingle();

        if (error) throw new Error(error.message);

        // لو ما فيه إعداد محفوظ بعد لهذا الدور، تُعامَل كـ"الكل مسموح افتراضياً"
        // (نفس القاعدة المطبَّقة فعلياً بمحرّك الصلاحيات عند غياب صف محفوظ)
        const grants = (data && Array.isArray(data.menus))
            ? Permissions.normalizeRawMenus(data.menus)
            : null;

        rolePermissionsCache[role] = grants;
        setChecklistState(grants);

    } catch (error) {
        console.error('تعذّر تحميل صلاحيات الدور:', error.message);
        showRolesAlert('تعذّر تحميل صلاحيات هذا الدور: ' + error.message, 'error');
        setChecklistState(null);
    } finally {
        tableWrapper.classList.remove('loading');
    }
}

// grants: إما Set من مفاتيح "إجراء:قسم" الممنوحة صراحة، أو null (يعني "الكل ممنوح افتراضياً")
function setChecklistState(grants) {
    getAllPermissionCheckboxes().forEach(cb => {
        cb.checked = grants === null ? true : grants.has(cb.value);
    });
}

function setChecklistDisabled(isDisabled) {
    getAllPermissionCheckboxes().forEach(cb => {
        cb.disabled = isDisabled;
    });
}

// 💾 حفظ صلاحيات الدور الحالي (Upsert) في جدول role_permissions — تُحفَظ
// المفاتيح الدقيقة المُحدَّدة فقط بصيغة "إجراء:قسم" (مثال: "add:employees")
async function saveCurrentRolePermissions() {
    if (currentSelectedRole === 'super_admin') return;

    hideRolesAlert();

    const selectedPermissions = Array.from(document.querySelectorAll('#permTableBody input[type="checkbox"]:checked'))
        .map(cb => cb.value);

    const saveBtn = document.getElementById('btnSaveRolePermissions');
    const originalText = saveBtn.textContent;
    saveBtn.disabled = true;
    saveBtn.textContent = 'جاري الحفظ...';

    try {
        // ⚠️ إصلاح جوهري: نطلب .select() على الـ upsert حتى نعرف بالضبط هل تم
        // حفظ/تحديث أي صف فعلياً؛ فبعض إعدادات RLS بسوبابيس (خصوصاً غياب سياسة
        // تحديث UPDATE Policy على جدول role_permissions، بينما توجد سياسة
        // إضافة INSERT فقط) تمنع تعديل الصف الموجود مسبقاً بصمت — يرجع الطلب
        // "نجاحاً" ظاهرياً بلا أي خطأ رغم أن شيئاً لم يُحفَظ فعلياً بقاعدة
        // البيانات، فتظهر رسالة "تم الحفظ بنجاح" للمستخدم بينما الصلاحيات
        // القديمة لا تزال كما هي — وهذا بالضبط ما يفسّر عدم ظهور أزرار
        // الإجراءات (تعديل/حذف/إلخ) لبعض الأقسام رغم تفعيل الصلاحية ظاهرياً
        // وحفظها من هذه الشاشة.
        const { data: savedRows, error } = await dbClient
            .from('role_permissions')
            .upsert([{ role: currentSelectedRole, menus: selectedPermissions }], { onConflict: 'role' })
            .select();

        if (error) throw new Error(error.message);

        if (!savedRows || savedRows.length === 0) {
            throw new Error("لم يتم حفظ صلاحيات هذا الدور فعلياً بقاعدة البيانات. غالباً السبب عدم وجود سياسة تحديث (RLS UPDATE Policy) — بالإضافة لسياسة الإضافة (INSERT) — على جدول 'role_permissions' في سوبابيس.");
        }

        rolePermissionsCache[currentSelectedRole] = new Set(selectedPermissions);
        showRolesAlert('تم حفظ صلاحيات هذا الدور بنجاح. ستُطبَّق تلقائياً لكل مستخدمي هذا الدور عند تحديث الصفحة.', 'success');

    } catch (error) {
        console.error('فشل حفظ صلاحيات الدور:', error.message);
        showRolesAlert('فشل الحفظ: ' + error.message, 'error');
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = originalText;
    }
}

function showRolesAlert(message, type) {
    const alertBox = document.getElementById('rolesAlert');
    alertBox.textContent = message;
    alertBox.className = 'form-alert ' + (type === 'success' ? 'alert-success' : 'alert-error');
    alertBox.style.display = 'flex';
}

function hideRolesAlert() {
    const alertBox = document.getElementById('rolesAlert');
    alertBox.style.display = 'none';
}

// =========================================================================
// 🙍 قسم "تعيين دور لمستخدم" — بحث عن مستخدم من جدول users وتغيير عمود role
// الخاص به مباشرة، بديل أسرع من فتح شاشة "المستخدمين" وتعديل بياناته كاملة
// =========================================================================

// مكوّن قائمة قابلة للبحث (Searchable Combobox) — نفس منطق المستخدم بشاشات أخرى
function setupSearchableCombobox({ inputId, hiddenId, dropdownId, options, emptyText, onSelectExtra }) {
    const input = document.getElementById(inputId);
    const hidden = document.getElementById(hiddenId);
    const dropdown = document.getElementById(dropdownId);

    function renderOptions(filterText) {
        const normalized = (filterText || '').trim().toLowerCase();
        const filtered = normalized
            ? options.filter(opt => opt.label.toLowerCase().includes(normalized))
            : options;

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

    function openDropdown() {
        renderOptions(input.value === getSelectedLabel() ? '' : input.value);
        dropdown.classList.add('open');
    }
    function closeDropdown() { dropdown.classList.remove('open'); }
    function getSelectedLabel() {
        const match = options.find(opt => String(opt.value) === String(hidden.value));
        return match ? match.label : '';
    }

    input.addEventListener('focus', () => { input.select(); openDropdown(); });
    input.addEventListener('input', () => { renderOptions(input.value); dropdown.classList.add('open'); });
    input.addEventListener('blur', () => {
        setTimeout(() => { input.value = getSelectedLabel(); closeDropdown(); }, 120);
    });
    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !dropdown.contains(e.target)) closeDropdown();
    });

    return {
        enable(placeholderText) { input.disabled = false; input.placeholder = placeholderText || 'ابحث أو اختر...'; },
        setOptions(newOptions) { options = newOptions; }
    };
}

let userRoleCombobox = null;
let usersByIdForRoleAssign = {};

async function loadUsersForRoleAssignCombobox() {
    userRoleCombobox = setupSearchableCombobox({
        inputId: 'userRoleSearch',
        hiddenId: 'userRoleUserId',
        dropdownId: 'userRoleDropdown',
        options: [],
        emptyText: 'لا يوجد مستخدمون مطابقون',
        onSelectExtra: (opt) => {
            const user = usersByIdForRoleAssign[String(opt.value)];
            displaySelectedUserRole(user);
        }
    });

    try {
        const { data, error } = await dbClient
            .from('users')
            .select('id, name, email, role')
            .order('name', { ascending: true });

        if (error) throw new Error(error.message);

        usersByIdForRoleAssign = {};
        const options = (data || []).map(u => {
            usersByIdForRoleAssign[String(u.id)] = u;
            const label = u.email ? `${u.name || 'بلا اسم'} (${u.email})` : (u.name || 'بلا اسم');
            return { value: String(u.id), label };
        });

        userRoleCombobox.setOptions(options);
        userRoleCombobox.enable(options.length ? 'ابحث بالاسم أو البريد الإلكتروني' : 'لا يوجد مستخدمون مسجّلون بعد');
    } catch (error) {
        console.error('تعذّر تحميل قائمة المستخدمين:', error.message);
        const input = document.getElementById('userRoleSearch');
        if (input) input.placeholder = 'تعذّر تحميل القائمة';
    }
}

// 🏷️ عرض الدور الحالي للمستخدم المختار، وتفعيل حقل الدور الجديد وزر الحفظ
function displaySelectedUserRole(user) {
    const currentDisplay = document.getElementById('userRoleCurrentDisplay');
    const newRoleSelect = document.getElementById('userRoleNewSelect');
    const assignBtn = document.getElementById('btnAssignUserRole');

    if (!user) {
        currentDisplay.textContent = '—';
        newRoleSelect.disabled = true;
        assignBtn.disabled = true;
        return;
    }

    currentDisplay.textContent = ROLE_LABELS_AR[user.role] || user.role || '—';
    newRoleSelect.value = user.role || 'employee';
    newRoleSelect.disabled = false;
    assignBtn.disabled = false;
}

// 💾 حفظ الدور الجديد للمستخدم المختار مباشرة بعمود role بجدول users
async function handleAssignUserRole() {
    hideUserRoleAlert();

    const userId = document.getElementById('userRoleUserId').value;
    const newRole = document.getElementById('userRoleNewSelect').value;
    const user = usersByIdForRoleAssign[String(userId)];

    if (!userId || !user) {
        showUserRoleAlert('الرجاء اختيار مستخدم أولاً من القائمة.', 'error');
        return;
    }

    if (user.role === newRole) {
        showUserRoleAlert('هذا المستخدم لديه بالفعل هذا الدور.', 'error');
        return;
    }

    const confirmMsg = `هل أنت متأكد من تغيير دور "${user.name || user.email}" إلى "${ROLE_LABELS_AR[newRole] || newRole}"؟`;
    if (!confirm(confirmMsg)) return;

    const assignBtn = document.getElementById('btnAssignUserRole');
    const originalText = assignBtn.textContent;
    assignBtn.disabled = true;
    assignBtn.textContent = 'جاري الحفظ...';

    try {
        const { data: updatedRows, error } = await dbClient
            .from('users')
            .update({ role: newRole })
            .eq('id', userId)
            .select();

        if (error) throw new Error(error.message);
        if (!updatedRows || updatedRows.length === 0) {
            throw new Error('لم يتم تحديث الدور فعلياً. تحقق من وجود سياسة تعديل (RLS UPDATE Policy) على جدول users في سوبابيس.');
        }

        // تحديث النسخة المحلية المخبأة حتى يظهر الدور الجديد فوراً بلا إعادة تحميل
        usersByIdForRoleAssign[String(userId)] = { ...user, role: newRole };
        displaySelectedUserRole(usersByIdForRoleAssign[String(userId)]);

        showUserRoleAlert(`تم تحديث دور "${user.name || user.email}" بنجاح إلى "${ROLE_LABELS_AR[newRole] || newRole}".`, 'success');

    } catch (error) {
        console.error('فشل تعيين دور المستخدم:', error.message);
        showUserRoleAlert('فشل الحفظ: ' + error.message, 'error');
    } finally {
        assignBtn.disabled = false;
        assignBtn.textContent = originalText;
    }
}

function showUserRoleAlert(message, type) {
    const alertBox = document.getElementById('userRoleAlert');
    alertBox.textContent = message;
    alertBox.className = 'form-alert ' + (type === 'success' ? 'alert-success' : 'alert-error');
    alertBox.style.display = 'flex';
}
function hideUserRoleAlert() {
    document.getElementById('userRoleAlert').style.display = 'none';
}