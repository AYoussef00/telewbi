// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================

const ADMIN_ROLES = ['admin', 'super_admin'];

// =========================================================================
// 🛡️ نطاق رؤية المستخدم الحالي: مسؤول الشركة (role='company') يفتح تذكرة
// لشركته/شركاته المملوكة فقط (حقل الشركة إلزامي وتُختار تلقائياً إن كانت
// واحدة)، بينما مسؤول النظام (admin/super_admin) يمكنه اختيار أي شركة أو
// ترك الحقل فارغاً لتذكرة عامة — نفس منطق نطاق الرؤية المستخدم بشاشة
// "إدارة المهام" و"إضافة مهمة جديدة".
//
// 🆕 دور "موظف" (role='employee'): تُحدَّد شركته الحالية تلقائياً من ربطه
// النشط بجدول employee_links (بنفس أسلوب employees.js)، وتُختار هذه الشركة
// تلقائياً في الحقل مع تعطيل الحقل بالكامل (disabled) — فلا يستطيع الموظف
// فتح تذكرة باسم شركة أخرى غير شركته الفعلية. لو تعذّر تحديد شركة نشطة له
// (مثلاً انتهى ربطه)، يبقى الحقل بلا اختيار والحقل مُقفَلاً أيضاً، ويظهر له
// تنبيه واضح يطلب التواصل مع مسؤول النظام بدل تركه يختار شركة عشوائياً.
// =========================================================================
let currentUserScope = { role: null, companyIds: null, userId: null, name: null, email: null, employeeId: null };

// 📅 تاريخ اليوم بصيغة YYYY-MM-DD — لتحديد الروابط النشطة (بلا تاريخ انتهاء،
// أو تاريخ انتهاء لم يأتِ بعد)، بنفس أسلوب employees.js تماماً.
function getTodayDateStringForLinks() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

async function loadCurrentUserScope() {
    try {
        const { data: { session } } = await dbClient.auth.getSession();
        if (!session) return;

        const { data: profileRow } = await dbClient.from('users').select('role, name, email').eq('id', session.user.id).maybeSingle();
        const role = profileRow?.role || null;

        currentUserScope.userId = session.user.id;
        currentUserScope.name = profileRow?.name || null;
        currentUserScope.email = profileRow?.email || session.user.email || null;

        if (role === 'company') {
            const { data: ownedCompanies } = await dbClient.from('companies').select('id').eq('user_id', session.user.id);
            currentUserScope.role = role;
            currentUserScope.companyIds = (ownedCompanies || []).map(c => c.id);
        } else if (role === 'employee') {
            currentUserScope.role = role;
            const { data: employeeRow } = await dbClient.from('employees').select('id').eq('user_id', session.user.id).maybeSingle();
            currentUserScope.employeeId = employeeRow ? employeeRow.id : -1;

            if (employeeRow) {
                // 🔗 الربط النشط الحالي فقط (بلا تاريخ انتهاء، أو تاريخ انتهاء مستقبلي)
                const { data: activeLink } = await dbClient
                    .from('employee_links')
                    .select('company_id')
                    .eq('employee_id', employeeRow.id)
                    .or(`link_end_date.is.null,link_end_date.gte.${getTodayDateStringForLinks()}`)
                    .maybeSingle();
                currentUserScope.companyIds = activeLink && activeLink.company_id != null ? [activeLink.company_id] : [];
            } else {
                currentUserScope.companyIds = [];
            }
        } else {
            currentUserScope.role = role;
            currentUserScope.companyIds = null;
        }
    } catch (error) {
        console.error('تعذّر تحديد نطاق صلاحيات المستخدم الحالي:', error.message);
    }
}

function isAdminScope() {
    return ADMIN_ROLES.includes(currentUserScope.role);
}

// =========================================================================
// 2. مكوّن قائمة قابلة للبحث (Searchable Combobox) — الشركة
// =========================================================================
function setupSearchableCombobox({ inputId, hiddenId, dropdownId, options, emptyText, onSelectExtra }) {
    const input = document.getElementById(inputId);
    const hidden = document.getElementById(hiddenId);
    const dropdown = document.getElementById(dropdownId);

    function renderOptions(filterText) {
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

    return {
        enable(placeholderText) { input.disabled = false; input.placeholder = placeholderText || 'ابحث أو اختر...'; },
        // 🔒 تعطيل الحقل بالكامل (يُستخدم لدور "موظف" — يمنعه من تغيير شركته
        // المُختارة تلقائياً)؛ يُغلق أي قائمة منسدلة مفتوحة احتياطاً أيضاً.
        disable(placeholderText) { input.disabled = true; if (placeholderText) input.placeholder = placeholderText; closeDropdown(); },
        setOptions(newOptions) { options = newOptions; }
    };
}

let companyCombobox = null;

async function loadCompaniesForCombobox() {
    companyCombobox = setupSearchableCombobox({
        inputId: 'ticketCompanySearch',
        hiddenId: 'ticketCompanyId',
        dropdownId: 'ticketCompanyDropdown',
        options: [],
        emptyText: 'لا توجد شركات مطابقة'
    });

    // مسؤول الشركة/الموظف: حقل إلزامي (شركته فقط). مسؤول النظام: حقل اختياري (كل الشركات + تذكرة عامة)
    if (isAdminScope()) {
        document.getElementById('companyOptionalTag').style.display = '';
    }

    const isEmployee = currentUserScope.role === 'employee';

    try {
        let query = dbClient.from('companies').select('id, name').order('name', { ascending: true });
        if (currentUserScope.companyIds !== null) {
            if (currentUserScope.companyIds.length === 0) {
                // 🆕 الموظف تحديداً: لا شركة نشطة مرتبطة بحسابه حالياً — نُقفل الحقل
                // كذلك (بدل تركه مفتوحاً بلا خيارات) ونعرض تنبيهاً واضحاً بدل رسالة
                // "لا توجد شركات مملوكة" العامة التي تخصّ دور مسؤول الشركة أصلاً.
                if (isEmployee) {
                    companyCombobox.disable('تعذّر تحديد شركتك الحالية تلقائياً');
                    showFormAlert('تعذّر تحديد شركتك الحالية تلقائياً (لا يوجد ربط نشط لحسابك بأي شركة حالياً). يرجى التواصل مع مسؤول النظام.', 'error');
                } else {
                    companyCombobox.enable('لا توجد شركات مملوكة لحسابك بعد');
                }
                return;
            }
            query = query.in('id', currentUserScope.companyIds);
        }

        const { data, error } = await query;
        if (error) throw new Error(error.message);

        const options = (data || []).map(c => ({ value: String(c.id), label: c.name || '----' }));
        companyCombobox.setOptions(options);

        // لو مسؤول الشركة أو الموظف يملك شركة واحدة فقط (الحالة الطبيعية دائماً
        // للموظف بما أن ربطه الحالي لا يكون إلا بشركة واحدة)، اخترها تلقائياً
        if (currentUserScope.companyIds && options.length === 1) {
            const only = options[0];
            document.getElementById('ticketCompanyId').value = only.value;
            document.getElementById('ticketCompanySearch').value = only.label;
        }

        if (isEmployee) {
            // 🔒 الموظف: الحقل يبقى مُقفَلاً دائماً حتى لو اختير خياره تلقائياً أعلاه
            // — لا يُسمح له بفتح تذكرة باسم شركة غير شركته الفعلية.
            companyCombobox.disable();
        } else {
            companyCombobox.enable(options.length ? 'ابحث عن شركة...' : (isAdminScope() ? 'لا توجد شركات مضافة بعد (تذكرة عامة)' : 'لا توجد شركات مضافة بعد'));
        }
    } catch (error) {
        console.error('تعذّر تحميل قائمة الشركات:', error.message);
        document.getElementById('ticketCompanySearch').placeholder = 'تعذّر تحميل القائمة';
    }
}

// =========================================================================
// 3. أدوات مساعدة لعرض شريط التنبيه ورسائل الحقول
// =========================================================================
function showFormAlert(message, type) {
    const alertBox = document.getElementById('formAlert');
    alertBox.textContent = message;
    alertBox.className = 'form-alert ' + (type === 'success' ? 'alert-success' : 'alert-error');
    alertBox.style.display = 'flex';
    alertBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function hideFormAlert() {
    document.getElementById('formAlert').style.display = 'none';
}
function setFieldError(fieldName, message) {
    const group = document.getElementById('group-' + fieldName);
    const errorEl = document.getElementById('error-' + fieldName);
    if (!group || !errorEl) return;
    if (message) { group.classList.add('has-error'); errorEl.textContent = message; }
    else { group.classList.remove('has-error'); errorEl.textContent = ''; }
}

// =========================================================================
// 4. ربط الأحداث + الحفظ
// =========================================================================
document.addEventListener('DOMContentLoaded', async () => {
    const allowed = await Permissions.guardPage('support');
    if (!allowed) return;

    await loadCurrentUserScope();
    await loadCompaniesForCombobox();

    document.getElementById('btnCancel').addEventListener('click', () => {
        if (confirm('هل أنت متأكد من إلغاء العملية؟ لن يتم حفظ البيانات.')) {
            window.location.href = Routes.url('support');
        }
    });

    const form = document.getElementById('addTicketForm');
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        hideFormAlert();

        const companyId = document.getElementById('ticketCompanyId').value;
        const subject = document.getElementById('ticketSubject').value.trim();
        const description = document.getElementById('ticketDescription').value.trim();

        ['company_id', 'subject', 'description'].forEach(f => setFieldError(f, null));
        let hasError = false;

        // الشركة إلزامية لمسؤول الشركة وللموظف؛ اختيارية لمسؤولي النظام (تذكرة عامة)
        if (!companyId && !isAdminScope()) {
            const isEmployee = currentUserScope.role === 'employee';
            setFieldError('company_id', isEmployee
                ? 'تعذّر تحديد شركتك الحالية تلقائياً. يرجى التواصل مع مسؤول النظام قبل فتح تذكرة.'
                : 'الرجاء اختيار الشركة.');
            hasError = true;
        }
        if (!subject) { setFieldError('subject', 'الرجاء إدخال موضوع التذكرة.'); hasError = true; }
        if (!description) { setFieldError('description', 'الرجاء وصف المشكلة أو الاستفسار.'); hasError = true; }

        if (hasError) {
            showFormAlert('الرجاء تصحيح الحقول المظللة أدناه.', 'error');
            return;
        }

        const submitBtn = form.querySelector('.btn-submit');
        const originalText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = 'جاري الإرسال...';

        try {
            const payload = {
                company_id: companyId ? Number(companyId) : null,
                created_by: currentUserScope.userId,
                created_by_name: currentUserScope.name,
                created_by_email: currentUserScope.email,
                subject,
                description,
                status: 'مفتوحة'
            };

            const { error } = await dbClient.from('support_tickets').insert(payload);
            if (error) throw new Error(error.message);

            showFormAlert('تم إرسال تذكرتك بنجاح! جاري التحويل...', 'success');
            setTimeout(() => { window.location.href = Routes.url('support'); }, 1200);

        } catch (error) {
            console.error('Ticket Creation Error:', error);
            showFormAlert('فشلت العملية: ' + error.message, 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
        }
    });
});
