// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================
const SUPABASE_URL = "https://mcdhxdfkuokhmhtfvjev.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_yt9V8lsNU1zN3Ix2CvovbQ_QCA2VDdM";
const dbClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const DEFAULT_INVOICE_VAT_RATE = 15;

// =========================================================================
// 🔒 مسؤول الشركة ليس مسؤولاً عن إصدار الفواتير: يرى قائمة الفواتير فقط، ولا
// يمكنه فتح/استخدام صفحة "إصدار فاتورة" إطلاقاً حتى لو وصل لرابطها مباشرة
// (بمعزل عن إخفاء زر "+ إصدار فاتورة" بصفحة invoices.html عبر data-perm) —
// نفس نمط blockCompanyRoleFromAttendanceBulkPage المعتمد بصفحة attendance_bulk.js
// =========================================================================
async function blockCompanyRoleFromAddInvoicePage() {
    try {
        const { data: { session } } = await dbClient.auth.getSession();
        if (!session) return false;
        const { data: profileRow } = await dbClient.from('users').select('role').eq('id', session.user.id).maybeSingle();
        if (profileRow?.role === 'company') {
            renderPermissionsUnauthorizedView();
            return true;
        }
        return false;
    } catch (error) {
        console.error('تعذّر التحقق من دور المستخدم الحالي (إصدار فاتورة):', error.message);
        return false;
    }
}

// =========================================================================
// 1.5 مكوّن قائمة قابلة للبحث (Searchable Combobox) — نفس منطق شاشة "إضافة شركة"
// =========================================================================
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
                hidden.dispatchEvent(new Event('change'));
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
        setOptions(newOptions) { options = newOptions; },
        clear() { hidden.value = ''; input.value = ''; }
    };
}

let invoiceCompanyCombobox = null;
let companiesById = {};

// 🕒 الشركة والعدد المختارَين حالياً — نُبقيهما محفوظَين هنا لإعادة تعبئة بند
// الاشتراك تلقائياً عند تغيير "فترة الاشتراك المفوترة" لاحقاً بلا حاجة لإعادة
// اختيار الشركة من القائمة (انظر مستمعي invoicePeriodFrom/To أسفل الملف)
let currentSelectedCompany = null;
let currentSelectedEmployeeCount = 0;

// 📅 تاريخ اليوم بصيغة YYYY-MM-DD — لتقييد استعلام عدد الموظفين المرتبطين
// بشركة معيّنة (employee_links) بالروابط النشطة فقط. بعد تحويل "إنهاء الربط"
// ليصبح تعليماً بتاريخ انتهاء (link_end_date) بدل حذف صف الربط فعلياً، تبقى
// صفوف الروابط المُنهاة موجودة بالجدول، فبلا هذا التقييد كان عدد الموظفين
// المُعبَّأ تلقائياً بالكمية سيشمل موظفين انتهى ربطهم فعلياً بهذه الشركة.
function getTodayDateStringForLinks() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

async function loadCompaniesForCombobox() {
    invoiceCompanyCombobox = setupSearchableCombobox({
        inputId: 'invoiceCompanySearch',
        hiddenId: 'invoiceCompanyId',
        dropdownId: 'invoiceCompanyDropdown',
        options: [],
        emptyText: 'لا توجد شركات مطابقة',
        onSelectExtra: async (opt) => {
            setFieldError('company_id', null);
            const company = companiesById[String(opt.value)];
            currentSelectedCompany = company;
            renderClientPreview(company);

            // 🔁 تعبئة تلقائية (قابلة للتعديل) لبند الفاتورة الأول بناءً على بيانات
            // الشركة المختارة: الصنف ثابت "رسوم خدمة عمل عن بعد"، السعر = قيمة
            // اشتراك الشركة (كاملة أو محسوبة تناسبياً حسب فترة الاشتراك المفوترة
            // المختارة أسفل الصفحة)، والكمية = عدد الموظفين المرتبطين بها حالياً
            // بجدول employee_links. لا تُستبدَل أي قيمة عدّلها المستخدم يدوياً بنفسه.
            const employeeCount = await getEmployeeLinkCountForCompany(opt.value);
            currentSelectedEmployeeCount = employeeCount;
            autofillFirstInvoiceItemFromCompany(company, employeeCount);
        }
    });

    try {
        const { data, error } = await dbClient
            .from('companies')
            .select('id, name, cr_number, tax_number, phone, city, address, subscription_value')
            .order('name', { ascending: true });

        if (error) throw new Error(error.message);

        companiesById = {};
        const options = (data || []).map(c => {
            companiesById[String(c.id)] = c;
            return { value: String(c.id), label: c.name };
        });

        invoiceCompanyCombobox.setOptions(options);
        invoiceCompanyCombobox.enable(options.length ? 'ابحث أو اختر الشركة' : 'لا توجد شركات مسجّلة بعد');
    } catch (error) {
        console.error('تعذّر تحميل قائمة الشركات:', error.message);
        const input = document.getElementById('invoiceCompanySearch');
        if (input) input.placeholder = 'تعذّر تحميل القائمة';
    }
}

// 🏢 عرض معاينة بيانات العميل (المشتقة من سجل الشركة) أسفل حقل الاختيار مباشرة
function renderClientPreview(company) {
    const wrapper = document.getElementById('group-company_preview');
    const box = document.getElementById('invoiceClientPreview');
    if (!wrapper || !box) return;

    if (!company) {
        wrapper.style.display = 'none';
        box.innerHTML = '';
        return;
    }

    const fields = [
        ['رقم السجل التجاري', company.cr_number || '—'],
        ['الرقم الضريبي', company.tax_number || '—'],
        ['رقم الجوال', company.phone || '—'],
        ['المدينة', company.city || '—'],
        ['العنوان الوطني', company.address || '—']
    ];

    box.innerHTML = fields.map(([label, value]) => `
        <div class="preview-field">
            <label>${label}</label>
            <span>${value}</span>
        </div>
    `).join('');

    wrapper.style.display = '';
}

// 👥 عدد الموظفين المرتبطين حالياً بالشركة (عدد صفوف employee_links المطابقة
// لهذه الشركة والمُقيَّدة بالروابط النشطة فقط — كل صف يمثّل ربطاً نشطاً فعلياً
// بحسب منطق شاشة "ربط الموظفين"؛ الصفوف المنتهية تبقى بالجدول بعد تحويل
// "إنهاء الربط" لتعليم بتاريخ بدل حذف، لذا لا بد من استبعادها هنا)
async function getEmployeeLinkCountForCompany(companyId) {
    try {
        const { count, error } = await dbClient
            .from('employee_links')
            .select('id', { count: 'exact', head: true })
            .eq('company_id', companyId)
            .or(`link_end_date.is.null,link_end_date.gte.${getTodayDateStringForLinks()}`);
        if (error) throw error;
        return count || 0;
    } catch (error) {
        console.error('تعذّر جلب عدد الموظفين المرتبطين بالشركة:', error.message);
        return 0;
    }
}

// =========================================================================
// 🗓️ حساب قيمة الاشتراك المفوترة بحسب "فترة الاشتراك المفوترة" (من/إلى):
// إن كانت الفترة تغطي شهراً تقويمياً كاملاً بالضبط (من أول يوم لآخر يوم فعلي
// بذلك الشهر) تُحتسب كامل قيمة اشتراك الشركة كما هي، وإن كانت أقل من ذلك
// (أو تمتد لأكثر من شهر) تُحتسب تناسبياً على أساس شهر تجاري ثابت مدته 30
// يوماً دائماً (وليس عدد أيام الشهر الفعلي 28/29/30/31) — حسب طلب المستخدم
// صراحة، بنفس اتفاقية "الشهر التجاري" الشائعة بحسابات الرواتب/الاشتراكات.
// =========================================================================

// 📅 تحويل نص تاريخ YYYY-MM-DD إلى كائن Date بمنتصف الليل المحلي (بلا فروقات
// منطقة زمنية قد تُزيح اليوم عن طريق new Date(str) القياسية)
function parseInvoiceDateOnly(dateStr) {
    return new Date(dateStr + 'T00:00:00');
}

// 🔢 عدد أيام شهر تقويمي فعلي مُعيّن (month بالترقيم صفري كما في Date، مثال:
// يناير = 0) — يُستخدم فقط لتحديد آخر يوم فعلي بالشهر (لضبط تاريخ "إلى"
// الافتراضي، ولاكتشاف اختيار المستخدم لشهر تقويمي كامل)، وليس كأساس للحساب
// التناسبي (انظر INVOICE_PRORATION_DAYS_PER_MONTH أدناه لذلك)
function daysInInvoiceMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
}

// 🖨️ تنسيق تاريخ نصي بصيغة DD/MM/YYYY لعرضه بوصف بند الاشتراك بالفاتورة
function formatInvoiceDateDDMMYYYY(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
}

// ثابت: شهر تجاري من 30 يوماً دائماً كأساس للمعدل اليومي عند التحصيل
// التناسبي — بغضّ النظر عن عدد أيام الشهر الفعلي (28/29/30/31)
const INVOICE_PRORATION_DAYS_PER_MONTH = 30;

function computeProratedSubscriptionValue(subscriptionValue, fromStr, toStr) {
    const baseValue = parseFloat(subscriptionValue) || 0;
    if (!fromStr || !toStr) return baseValue;

    const fromDate = parseInvoiceDateOnly(fromStr);
    const toDate = parseInvoiceDateOnly(toStr);
    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime()) || toDate < fromDate) return baseValue;

    // شهر تقويمي كامل بالضبط (من أول يوم لآخر يوم فعلي بنفس الشهر) ⇐ القيمة كاملة
    const isSingleFullMonth = fromDate.getDate() === 1
        && toDate.getFullYear() === fromDate.getFullYear()
        && toDate.getMonth() === fromDate.getMonth()
        && toDate.getDate() === daysInInvoiceMonth(fromDate.getFullYear(), fromDate.getMonth());
    if (isSingleFullMonth) return Math.round(baseValue * 100) / 100;

    // غير ذلك ⇐ تناسبياً على أساس شهر ثابت من 30 يوماً
    const totalDays = Math.round((toDate - fromDate) / 86400000) + 1;
    const dailyRate = baseValue / INVOICE_PRORATION_DAYS_PER_MONTH;
    return Math.round(dailyRate * totalDays * 100) / 100;
}

// 📌 تحديث الملاحظة النصية أسفل حقلي فترة الاشتراك (عدد الأيام، وهل هي شهر
// كامل أم فترة جزئية) — للعرض فقط، لا تؤثر على أي حساب بنفسها
function updateInvoicePeriodNote() {
    const noteEl = document.getElementById('invoicePeriodNote');
    if (!noteEl) return;

    const fromStr = document.getElementById('invoicePeriodFrom').value;
    const toStr = document.getElementById('invoicePeriodTo').value;

    if (!fromStr || !toStr) {
        noteEl.textContent = '';
        noteEl.classList.remove('period-note-warning');
        return;
    }

    const fromDate = parseInvoiceDateOnly(fromStr);
    const toDate = parseInvoiceDateOnly(toStr);

    if (toDate < fromDate) {
        noteEl.textContent = '⚠️ تاريخ نهاية الفترة يجب أن يكون بعد تاريخ البداية.';
        noteEl.classList.add('period-note-warning');
        return;
    }
    noteEl.classList.remove('period-note-warning');

    const totalDays = Math.round((toDate - fromDate) / 86400000) + 1;
    const isSingleFullMonth = fromDate.getDate() === 1
        && toDate.getFullYear() === fromDate.getFullYear()
        && toDate.getMonth() === fromDate.getMonth()
        && toDate.getDate() === daysInInvoiceMonth(fromDate.getFullYear(), fromDate.getMonth());

    noteEl.textContent = isSingleFullMonth
        ? `📌 شهر كامل (${totalDays} يوماً) — سيُحتسب كامل قيمة الاشتراك`
        : `📌 ${totalDays} يوماً — سيُحتسب تناسبياً على أساس شهر من ${INVOICE_PRORATION_DAYS_PER_MONTH} يوماً`;
}

// 🔁 تعبئة بند الفاتورة الأول تلقائياً: الصنف/الوصف = "رسوم خدمة عمل عن بعد"
// (مع إضافة فترة الاشتراك المفوترة بين قوسين للتوضيح على الفاتورة)، السعر =
// قيمة اشتراك الشركة (كاملة إن كانت الفترة شهراً كاملاً، أو محسوبة تناسبياً
// على أساس شهر من 30 يوماً إن كانت أقل من شهر)، والكمية = عدد الموظفين
// المرتبطين بها. أي حقل من الثلاثة عدّله المستخدم يدوياً بنفسه (data-touched)
// لا يُستبدَل هنا لاحقاً، حتى لو غيّر الشركة أو فترة الاشتراك بعد ذلك — بنفس
// نمط "تعبئة تلقائية قابلة للتعديل" المعتمد بباقي شاشات المنصة.
function autofillFirstInvoiceItemFromCompany(company, employeeCount) {
    let firstRow = document.querySelector('#invoiceItemsBody tr');
    if (!firstRow) {
        addInvoiceItemRow();
        firstRow = document.querySelector('#invoiceItemsBody tr');
    }
    if (!firstRow || !company) return;

    const descInput = firstRow.querySelector('.item-description');
    const priceInput = firstRow.querySelector('.item-unit-price');
    const qtyInput = firstRow.querySelector('.item-quantity');

    const periodFromStr = document.getElementById('invoicePeriodFrom').value;
    const periodToStr = document.getElementById('invoicePeriodTo').value;

    if (descInput && !descInput.dataset.touched) {
        let description = 'رسوم خدمة عمل عن بعد';
        if (periodFromStr && periodToStr) {
            description += ` (${formatInvoiceDateDDMMYYYY(periodFromStr)} - ${formatInvoiceDateDDMMYYYY(periodToStr)})`;
        }
        descInput.value = description;
    }
    if (priceInput && !priceInput.dataset.touched && company.subscription_value != null) {
        priceInput.value = computeProratedSubscriptionValue(company.subscription_value, periodFromStr, periodToStr);
    }
    if (qtyInput && !qtyInput.dataset.touched) {
        qtyInput.value = employeeCount;
    }

    recomputeInvoiceTotals();
}

// =========================================================================
// 2. إدارة بنود الفاتورة الديناميكية
// =========================================================================
let invoiceItemRowCounter = 0;

function addInvoiceItemRow(prefill) {
    const tbody = document.getElementById('invoiceItemsBody');
    if (!tbody) return;

    invoiceItemRowCounter++;
    const rowId = 'item-row-' + invoiceItemRowCounter;
    const row = document.createElement('tr');
    row.id = rowId;

    const p = prefill || {};
    row.innerHTML = `
        <td><input type="text" class="item-description" placeholder="مثال: رسوم خدمة عمل عن بعد" value="${p.description || ''}"></td>
        <td><input type="text" class="item-unit" placeholder="خدمة" value="${p.unit || 'خدمة'}"></td>
        <td><input type="number" class="item-unit-price" min="0" step="0.01" placeholder="0.00" value="${p.unit_price != null ? p.unit_price : ''}"></td>
        <td><input type="number" class="item-quantity" min="0" step="1" placeholder="1" value="${p.quantity != null ? p.quantity : 1}"></td>
        <td><input type="number" class="item-discount" min="0" step="0.01" placeholder="0.00" value="${p.discount_amount != null ? p.discount_amount : 0}"></td>
        <td><input type="number" class="item-vat-rate" min="0" step="0.01" value="${p.vat_rate != null ? p.vat_rate : DEFAULT_INVOICE_VAT_RATE}"></td>
        <td class="invoice-line-total-cell">0.00</td>
        <td><button type="button" class="btn-remove-item" title="حذف البند" data-icon="trash"></button></td>
    `;

    tbody.appendChild(row);
    if (typeof applyIconPlaceholders === 'function') applyIconPlaceholders(row);

    // ✏️ أي كتابة يدوية فعلية من المستخدم بحقول الصنف/السعر/الكمية تُعلَّم
    // بـ data-touched حتى لا تُستبدل لاحقاً بالتعبئة التلقائية عند تغيير
    // الشركة المختارة (انظر autofillFirstInvoiceItemFromCompany أعلاه)
    row.querySelectorAll('input').forEach(input => {
        input.addEventListener('input', () => {
            input.dataset.touched = 'true';
            recomputeInvoiceTotals();
        });
    });
    row.querySelector('.btn-remove-item').addEventListener('click', () => {
        row.remove();
        recomputeInvoiceTotals();
    });

    recomputeInvoiceTotals();
}

// 💰 تنسيق القيم المالية بمنزلتين عشريتين بأرقام إنجليزية دائماً
function formatInvoiceCurrency(value) {
    const num = parseFloat(value);
    if (isNaN(num)) return '0.00';
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
}

// 🧮 قراءة كل بنود الفاتورة الحالية من صفوف الجدول
function collectInvoiceItemsFromForm() {
    const rows = document.querySelectorAll('#invoiceItemsBody tr');
    const items = [];
    rows.forEach(row => {
        const description = row.querySelector('.item-description').value.trim();
        const unit = row.querySelector('.item-unit').value.trim() || 'خدمة';
        const unitPrice = parseFloat(row.querySelector('.item-unit-price').value) || 0;
        const quantity = parseFloat(row.querySelector('.item-quantity').value) || 0;
        const discountAmount = parseFloat(row.querySelector('.item-discount').value) || 0;
        const vatRate = row.querySelector('.item-vat-rate').value !== ''
            ? parseFloat(row.querySelector('.item-vat-rate').value)
            : DEFAULT_INVOICE_VAT_RATE;

        // نتجاهل الصفوف الفارغة تماماً (بلا وصف وبلا سعر) بدل اعتبارها بنداً صحيحاً
        if (!description && unitPrice === 0 && quantity === 0) return;

        items.push({ description, unit, unit_price: unitPrice, quantity, discount_amount: discountAmount, vat_rate: vatRate });
    });
    return items;
}

// 🧮 حساب إجماليات بند واحد (نفس منطق العرض والحفظ معاً لضمان تطابق الأرقام)
function computeInvoiceLineTotals(item) {
    const unitPrice = parseFloat(item.unit_price) || 0;
    const quantity = parseFloat(item.quantity) || 0;
    const discountAmount = parseFloat(item.discount_amount) || 0;
    const vatRate = (item.vat_rate !== null && item.vat_rate !== undefined && item.vat_rate !== '')
        ? parseFloat(item.vat_rate)
        : DEFAULT_INVOICE_VAT_RATE;

    const grossAmount = unitPrice * quantity;
    const amountExclVat = Math.max(grossAmount - discountAmount, 0);
    const vatAmount = amountExclVat * (vatRate / 100);
    const amountInclVat = amountExclVat + vatAmount;

    return { amountExclVat, vatAmount, amountInclVat, discountAmount };
}

function computeInvoiceTotals(items) {
    let subtotal = 0, discountTotal = 0, vatTotal = 0, grandTotal = 0;
    (items || []).forEach(item => {
        const t = computeInvoiceLineTotals(item);
        subtotal += t.amountExclVat;
        discountTotal += t.discountAmount;
        vatTotal += t.vatAmount;
        grandTotal += t.amountInclVat;
    });
    return {
        subtotal: Math.round(subtotal * 100) / 100,
        discountTotal: Math.round(discountTotal * 100) / 100,
        vatTotal: Math.round(vatTotal * 100) / 100,
        grandTotal: Math.round(grandTotal * 100) / 100
    };
}

// 🔄 إعادة حساب إجمالي كل صف + صندوق الإجماليات الكلي فور أي تعديل بالبنود
function recomputeInvoiceTotals() {
    const rows = document.querySelectorAll('#invoiceItemsBody tr');
    const items = [];

    rows.forEach(row => {
        const item = {
            unit_price: row.querySelector('.item-unit-price').value,
            quantity: row.querySelector('.item-quantity').value,
            discount_amount: row.querySelector('.item-discount').value,
            vat_rate: row.querySelector('.item-vat-rate').value
        };
        const lineTotals = computeInvoiceLineTotals(item);
        row.querySelector('.invoice-line-total-cell').textContent = formatInvoiceCurrency(lineTotals.amountInclVat);
        items.push(item);
    });

    const totals = computeInvoiceTotals(items);
    document.getElementById('totalsSubtotal').textContent = formatInvoiceCurrency(totals.subtotal);
    document.getElementById('totalsDiscount').textContent = formatInvoiceCurrency(totals.discountTotal);
    document.getElementById('totalsVat').textContent = formatInvoiceCurrency(totals.vatTotal);
    document.getElementById('totalsGrand').textContent = formatInvoiceCurrency(totals.grandTotal);
}

// =========================================================================
// 3. التحقق من الحقول وعرض الأخطاء
// =========================================================================
function setFieldError(fieldName, message) {
    const group = document.getElementById('group-' + fieldName);
    const errorEl = document.getElementById('error-' + fieldName);
    if (errorEl) errorEl.textContent = message || '';
    if (group) {
        if (message) group.classList.add('has-error');
        else group.classList.remove('has-error');
    }
}

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

// =========================================================================
// 4. ربط الأحداث والحفظ
// =========================================================================
document.addEventListener('DOMContentLoaded', async function() {
    // 🔒 صلاحية فتح/استخدام هذه الصفحة أصبحت "إصدار فاتورة" المستقلة
    // (add:invoice_issuing) بدل الاعتماد على "عرض الفواتير" العامة — انظر
    // تعليق hiddenActions أعلى تعريف invoice_issuing بملف permissions.js.
    const allowed = await Permissions.guardPage('invoice_issuing', 'add');
    if (!allowed) return;
    if (await blockCompanyRoleFromAddInvoicePage()) return;

    loadCompaniesForCombobox();

    // تاريخ الفاتورة الافتراضي: اليوم
    const dateInput = document.getElementById('invoiceDate');
    if (dateInput && !dateInput.value) {
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        dateInput.value = `${yyyy}-${mm}-${dd}`;
    }

    // 🗓️ فترة الاشتراك المفوترة الافتراضية: الشهر التقويمي الحالي كاملاً (من
    // أول يوم لآخر يوم فعلي به) — بحيث يبقى السلوك كما كان (كامل قيمة
    // الاشتراك) ما لم يُعدّل المستخدم الفترة يدوياً لتغطي أقل من شهر
    const periodFromInput = document.getElementById('invoicePeriodFrom');
    const periodToInput = document.getElementById('invoicePeriodTo');
    if (periodFromInput && periodToInput && !periodFromInput.value && !periodToInput.value) {
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const lastDay = daysInInvoiceMonth(yyyy, now.getMonth());
        periodFromInput.value = `${yyyy}-${mm}-01`;
        periodToInput.value = `${yyyy}-${mm}-${String(lastDay).padStart(2, '0')}`;
    }
    updateInvoicePeriodNote();

    // عند تعديل فترة الاشتراك يدوياً: تحديث الملاحظة النصية، وإعادة تعبئة بند
    // الاشتراك (الوصف/السعر) تناسبياً — إن لم تكن حقوله قد عُدِّلت يدوياً من قبل
    [periodFromInput, periodToInput].forEach(input => {
        if (!input) return;
        input.addEventListener('change', () => {
            updateInvoicePeriodNote();
            if (currentSelectedCompany) {
                autofillFirstInvoiceItemFromCompany(currentSelectedCompany, currentSelectedEmployeeCount);
            }
        });
    });

    document.getElementById('btnAddInvoiceItem').addEventListener('click', () => addInvoiceItemRow());
    addInvoiceItemRow(); // بند أول فارغ يبدأ به المستخدم دائماً (تُعبَّأ حقوله تلقائياً فور اختيار الشركة)

    document.getElementById('btnCancel').addEventListener('click', () => {
        if (confirm('هل أنت متأكد من إلغاء العملية؟ لن يتم حفظ البيانات.')) {
            window.location.href = 'invoices.html';
        }
    });

    const form = document.getElementById('addInvoiceForm');
    form.addEventListener('submit', async function(event) {
        event.preventDefault();
        hideFormAlert();

        const companyId = document.getElementById('invoiceCompanyId').value.trim();
        if (!companyId) {
            setFieldError('company_id', 'الرجاء اختيار الشركة المطلوب إصدار الفاتورة لها.');
            showFormAlert('الرجاء تصحيح الحقول المظللة أدناه.', 'error');
            return;
        }
        setFieldError('company_id', null);

        const items = collectInvoiceItemsFromForm();
        if (items.length === 0) {
            setFieldError('items', 'الرجاء إضافة بند واحد على الأقل بوصف وسعر صحيحين.');
            showFormAlert('الرجاء إضافة بند واحد على الأقل بوصف وسعر صحيحين.', 'error');
            return;
        }
        setFieldError('items', null);

        const totals = computeInvoiceTotals(items);
        const invoiceDate = document.getElementById('invoiceDate').value || null;
        const paymentMethod = document.getElementById('invoicePaymentMethod').value || 'أجل';
        const notes = document.getElementById('invoiceNotes').value.trim() || null;

        const submitBtn = form.querySelector('.btn-submit');
        const originalBtnText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = 'جاري حفظ الفاتورة...';

        try {
            const payload = {
                company_id: companyId,
                invoice_date: invoiceDate,
                payment_method: paymentMethod,
                items: items,
                subtotal: totals.subtotal,
                discount_amount: totals.discountTotal,
                vat_amount: totals.vatTotal,
                total_amount: totals.grandTotal,
                status: 'unpaid',
                notes: notes
            };

            const { data: insertedRows, error } = await dbClient
                .from('invoices')
                .insert([payload])
                .select();

            if (error) throw new Error(error.message);
            if (!insertedRows || insertedRows.length === 0) {
                throw new Error('لم يتم إنشاء الفاتورة فعلياً. تحقق من وجود سياسة إضافة (RLS INSERT Policy) على جدول invoices في سوبابيس.');
            }

            const newInvoiceId = insertedRows[0].id;
            showFormAlert('تم إصدار الفاتورة بنجاح! جاري فتح صفحة الفاتورة...', 'success');
            setTimeout(() => {
                window.location.href = 'view_invoice.html?id=' + encodeURIComponent(newInvoiceId);
            }, 1200);

        } catch (error) {
            console.error('Invoice Creation Error (raw):', error);
            const rawMsg = error && (error.message || error.error_description || error.hint || error.details);
            const displayMsg = (rawMsg && rawMsg !== '{}')
                ? rawMsg
                : 'حدث خطأ غير متوقع من قاعدة البيانات بدون تفاصيل. افتح أدوات المطوّر (F12) → Console وشاركني ما يظهر هناك.';
            showFormAlert('فشلت العملية: ' + displayMsg, 'error');
            submitBtn.disabled = false;
            submitBtn.textContent = originalBtnText;
        }
    });
});