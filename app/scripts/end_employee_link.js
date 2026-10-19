// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================

let localLinksCache = [];
let filteredLinksCache = [];

// Pagination Settings (نفس عدد صفوف شاشة "ربط الموظفين")
let currentEndLinkPage = 1;
const endLinksPerPage = 7;

// سجل الإنهاءات السابقة (أرشيف)
// localHistoryCache = كل السجلات (تُستخدم أيضاً لاستبعاد المُنهاة يدوياً من "العقود
// المنتهية" ولعمليات الاستعادة)، وfilteredHistoryCache = نتيجة حقل البحث المعروضة بالجدول
let localHistoryCache = [];
let filteredHistoryCache = [];
let currentHistoryPage = 1;
const historyPerPage = 7;

// 🆕 \"العقود المنتهية\": روابط تجاوز تاريخها المتوقع (link_end_date) دون أن
// تُنهى يدوياً (لا يوجد لها سجل مطابق بأرشيف employee_link_history) — انظر
// fetchAndRenderExpiredContractsTable أدناه للتفاصيل الكاملة
let localExpiredContractsCache = [];
let currentExpiredContractsPage = 1;
const expiredContractsPerPage = 7;

// 🆕 قيم حالة إجراءات إنهاء الربط (عمود procedure_status بجدول employee_link_history)
const PROCEDURE_STATUS_COMPLETE = 'complete';
const PROCEDURE_STATUS_INCOMPLETE = 'incomplete';

document.addEventListener('DOMContentLoaded', async () => {
    const allowed = await Permissions.guardPage('end_employee_link');
    if (!allowed) return;

    // شريط البحث: اسم الموظف / اسم الشركة (نفس مكوّن شاشة "ربط الموظفين")
    setupFilterSearchCombo({
        inputId: 'endLinkEmployeeNameSearch',
        dropdownId: 'endLinkEmployeeNameDropdown',
        emptyText: 'لا يوجد موظفون مطابقون',
        // 🆕 اقتراحات البحث تشمل أسماء الموظفين وأرقام هوياتهم معاً
        getOptions: () => distinctSorted(localLinksCache.flatMap(l => [
            l.employees && l.employees.name,
            l.employees && l.employees.national_id
        ]))
    });

    setupFilterSearchCombo({
        inputId: 'endLinkCompanySearch',
        dropdownId: 'endLinkCompanyDropdown',
        emptyText: 'لا توجد شركات مطابقة',
        getOptions: () => distinctSorted(localLinksCache.map(l => l.companies && l.companies.name))
    });

    document.getElementById('btnCloseEndLinkModal').addEventListener('click', closeEndLinkModal);
    document.getElementById('btnCancelEndLinkModal').addEventListener('click', closeEndLinkModal);
    document.getElementById('btnConfirmEndLink').addEventListener('click', handleConfirmEndLink);

    // 🆕 حقل البحث بسجل الموظفين الذين تم إنهاء ربطهم
    const historySearchInput = document.getElementById('endLinkHistorySearch');
    if (historySearchInput) historySearchInput.addEventListener('input', applyHistoryFilters);

    // 🆕 اختيار حالة الإجراءات بنافذة الإنهاء: إظهار/إخفاء حقل السبب
    document.querySelectorAll('input[name="endProcedureStatus"]').forEach(radio => {
        radio.addEventListener('change', syncEndProcedureReasonVisibility);
    });

    // 🆕 نافذة تغيير حالة الإجراءات لسجل بالأرشيف
    document.getElementById('btnCloseProcedureModal').addEventListener('click', closeProcedureModal);
    document.getElementById('btnCancelProcedureModal').addEventListener('click', closeProcedureModal);
    document.getElementById('btnSaveProcedureStatus').addEventListener('click', handleSaveProcedureStatus);
    document.querySelectorAll('input[name="procedureModalStatus"]').forEach(radio => {
        radio.addEventListener('change', syncProcedureModalReasonVisibility);
    });

    fetchAndRenderEndLinkTable();
    // 🆕 يجب انتظار اكتمال جلب أرشيف الإنهاءات (localHistoryCache) قبل حساب
    // جدول "العقود المنتهية"، لأنه يستبعد منها أي رابط سبق إنهاؤه يدوياً
    // ولديه بالفعل سجل مطابق بهذا الأرشيف (انظر fetchAndRenderExpiredContractsTable)
    await fetchAndRenderHistoryTable();
    fetchAndRenderExpiredContractsTable();
});

// 📚 استخراج قيم فريدة (غير فارغة) ومرتّبة أبجدياً من مصفوفة، تُستخدم لتغذية اقتراحات البحث
function distinctSorted(values) {
    return Array.from(new Set((values || []).filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b), 'ar'));
}

// 🛡️ تهريب النصوص الحرة التي يُدخلها المستخدم (مثل سبب عدم اكتمال الإجراءات)
// قبل وضعها داخل HTML، لتفادي كسر الجدول أو حقن عناصر
function escapeProcedureHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// 🆕 شارة "نوع الربط" (اضافة / استضافة) المستخدمة بالجداول الثلاثة بهذه الشاشة
function renderLinkTypeBadge(linkType) {
    const text = (linkType || '').trim();
    if (!text) return '<span style="color:#94a3b8;">----</span>';
    const cls = text === 'استضافة' ? 'link-type-hosting' : 'link-type-addition';
    return `<span class="link-type-badge ${cls}">${escapeProcedureHtml(text)}</span>`;
}

// =========================================================================
// 2. مكوّن "قائمة قابلة للبحث" لخانات التصفية (نفس منطق شاشة "ربط الموظفين")
// =========================================================================
function setupFilterSearchCombo({ inputId, dropdownId, getOptions, emptyText }) {
    const input = document.getElementById(inputId);
    const dropdown = document.getElementById(dropdownId);
    if (!input || !dropdown) return;

    function renderSuggestions(query) {
        const options = getOptions();
        const normalized = (query || '').trim().toLowerCase();
        const matches = normalized
            ? options.filter(v => String(v).toLowerCase().includes(normalized))
            : options;

        dropdown.innerHTML = '';

        const clearItem = document.createElement('div');
        clearItem.className = 'combo-item combo-item-clear';
        clearItem.textContent = '✕ إلغاء هذا الفلتر';
        clearItem.addEventListener('mousedown', (e) => {
            e.preventDefault();
            input.value = '';
            closeDropdown();
            applyEndLinkFilters();
        });
        dropdown.appendChild(clearItem);

        if (matches.length === 0) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'combo-empty';
            emptyEl.textContent = emptyText || 'لا توجد نتائج مطابقة';
            dropdown.appendChild(emptyEl);
            return;
        }

        matches.slice(0, 30).forEach(value => {
            const item = document.createElement('div');
            item.className = 'combo-item';
            if (input.value.trim() === String(value)) item.classList.add('selected');
            item.textContent = value;
            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                input.value = value;
                closeDropdown();
                applyEndLinkFilters();
            });
            dropdown.appendChild(item);
        });
    }

    function openDropdown() {
        renderSuggestions(input.value);
        dropdown.classList.add('open');
    }
    function closeDropdown() { dropdown.classList.remove('open'); }

    input.addEventListener('focus', openDropdown);
    input.addEventListener('input', () => {
        renderSuggestions(input.value);
        dropdown.classList.add('open');
        applyEndLinkFilters();
    });
    input.addEventListener('blur', () => setTimeout(closeDropdown, 150));
    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !dropdown.contains(e.target)) closeDropdown();
    });
}

// =========================================================================
// 3. جلب سجلات الربط الحالية (نفس مصدر بيانات شاشة "ربط الموظفين") — الروابط
// النشطة فقط (بلا تاريخ انتهاء، أو تاريخ انتهاء لم يأتِ بعد)، لأن الروابط
// المُنهاة سابقاً تبقى الآن محفوظة بالجدول (بعد التحوّل من الحذف الفعلي إلى
// مجرد تسجيل تاريخ انتهاء) بدل أن تُحذف — انظر ملاحظة handleConfirmEndLink
// =========================================================================
async function fetchAndRenderEndLinkTable() {
    const tableBody = document.getElementById('endLinkTableBody');
    if (!tableBody) return;

    const todayStr = getTodayDateString();
    const { data, error } = await dbClient
        .from('employee_links')
        .select('*, employees(name, national_id), companies(name)')
        .or(`link_end_date.is.null,link_end_date.gte.${todayStr}`)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('خطأ في الاتصال بقاعدة البيانات:', error.message);
        tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#ef4444; padding:20px;">فشل تحميل قائمة الموظفين المرتبطين.</td></tr>`;
        return;
    }

    localLinksCache = data || [];
    applyEndLinkFilters();
}

// 📅 تنسيق تاريخ بصيغة DD/MM/YYYY بأرقام إنجليزية دائماً
function formatEndLinkDate(dateStr) {
    if (!dateStr) return '—';
    const datePart = String(dateStr).split('T')[0];
    const parts = datePart.split('-');
    if (parts.length !== 3) return String(dateStr);
    const [y, m, d] = parts;
    return `${d}/${m}/${y}`;
}

// 📅 تاريخ اليوم بصيغة YYYY-MM-DD حسب توقيت جهاز المستخدم
function getTodayDateString() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

// 📅 تاريخ انتهاء الربط = تاريخ الربط + سنة كاملة دائماً (نفس منطق شاشة "ربط
// الموظفين")، يُستخدم عند إعادة إنشاء ربط الموظف بشركته السابقة من زر "استعادة".
// نستخدم كائن Date بدل التلاعب النصي المباشر بالسنة حتى تُعالَج حالة 29 فبراير
// بشكل صحيح تلقائياً (تتحول لـ 1 مارس بالسنة التالية إن لم تكن سنة كبيسة).
function computeLinkEndDate(linkDateStr) {
    if (!linkDateStr) return '';
    const d = new Date(linkDateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return '';
    d.setFullYear(d.getFullYear() + 1);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

// =========================================================================
// 🗓️ نفس منطق الاستحقاق التناسبي المعتمد بشاشة "تحصيل الموظفين"
// (collections.js) — مُكرَّر هنا لإنشاء سجلات تحصيل صحيحة تلقائياً عند إنهاء
// ربط موظف "اضافة" (انظر ensureCollectionRecordsForEndedLink أدناه)
// =========================================================================
function parseCollectionDateOnly(dateStr) {
    return new Date(dateStr + 'T00:00:00');
}

function daysInCollectionCalendarMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
}

const COLLECTION_PRORATION_DAYS_PER_MONTH = 30;

function computeLinkOverlapWithMonth(linkDateStr, linkEndDateStr, year, month) {
    const monthStart = new Date(year, month, 1);
    const monthCalendarEnd = new Date(year, month, daysInCollectionCalendarMonth(year, month));

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const accrualEnd = monthCalendarEnd < today ? monthCalendarEnd : today;

    const linkStart = linkDateStr ? parseCollectionDateOnly(linkDateStr) : null;
    const linkEnd = linkEndDateStr ? parseCollectionDateOnly(linkEndDateStr) : null;

    const effectiveStart = (linkStart && linkStart > monthStart) ? linkStart : monthStart;
    const effectiveEnd = (linkEnd && linkEnd < accrualEnd) ? linkEnd : accrualEnd;

    if (effectiveEnd < effectiveStart) {
        return { overlapDays: 0, isFullMonth: false };
    }

    const overlapDays = Math.round((effectiveEnd - effectiveStart) / 86400000) + 1;
    const isFullMonth = effectiveStart.getTime() === monthStart.getTime() && effectiveEnd.getTime() === monthCalendarEnd.getTime();
    return { overlapDays, isFullMonth };
}

function computeLinkDueForMonth(netSalaryValue, linkDateStr, linkEndDateStr, year, month) {
    const baseValue = parseFloat(netSalaryValue) || 0;
    const { overlapDays, isFullMonth } = computeLinkOverlapWithMonth(linkDateStr, linkEndDateStr, year, month);

    if (overlapDays <= 0) return { dueAmount: 0, overlapDays: 0, isFullMonth: false };
    if (isFullMonth) return { dueAmount: Math.round(baseValue * 100) / 100, overlapDays, isFullMonth: true };

    const dailyRate = baseValue / COLLECTION_PRORATION_DAYS_PER_MONTH;
    return { dueAmount: Math.round(dailyRate * overlapDays * 100) / 100, overlapDays, isFullMonth: false };
}

// =========================================================================
// 🧾 عند إنهاء ربط موظف من نوع "اضافة": إنشاء سجلات تحصيل (employee_collections)
// تلقائياً عن كل الأشهر التي شملها ربطه (من تاريخ الربط حتى تاريخ الإنهاء)
// التي لا يوجد لها سجل محفوظ مسبقاً بالفعل — بحيث يبقى سجل تحصيله كاملاً
// وقابلاً للمراجعة لاحقاً (صفحة "تفاصيل الموظف ودفعات السداد") حتى بعد إنهاء
// ربطه واختفائه من قوائم الموظفين النشطين. لا تُعدَّل أي سجلات محفوظة مسبقاً
// إطلاقاً (حتى لا تُفقَد أي بيانات تحصيل فعلي مُسجّلة سابقاً يدوياً)، فقط
// تُضاف الأشهر الناقصة كسجلات "غير مدفوعة" بالمبلغ المستحق الصحيح (تناسبياً
// إن لزم، بنفس اتفاقية شهر تجاري من 30 يوماً المعتمدة بشاشة "تحصيل الموظفين").
// موظفو "استضافة" لا يخضعون لتحصيل الرسوم عبر هذا الجدول، فلا يُنشأ لهم شيء.
// =========================================================================
async function ensureCollectionRecordsForEndedLink(link, endDateStr) {
    if (!link || link.link_type !== 'اضافة' || !link.link_date || !endDateStr) return;

    try {
        const netSalaryValue = link.net_salary_value != null ? parseFloat(link.net_salary_value) : 0;

        const startDate = parseCollectionDateOnly(link.link_date);
        const endDateObj = parseCollectionDateOnly(endDateStr);
        if (isNaN(startDate.getTime()) || isNaN(endDateObj.getTime()) || endDateObj < startDate) return;

        // 1) جلب الأشهر المسجّلة فعلياً مسبقاً لهذا الربط، لتجنّب الكتابة فوق أي بيانات محفوظة
        const { data: existingRows, error: existingError } = await dbClient
            .from('employee_collections')
            .select('collection_month')
            .eq('employee_link_id', link.id);
        if (existingError) throw new Error(existingError.message);

        const existingMonths = new Set((existingRows || []).map(r => String(r.collection_month).split('T')[0]));

        // 2) المرور شهرياً من شهر بداية الربط حتى شهر تاريخ الإنهاء
        const rowsToInsert = [];
        const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
        const lastMonth = new Date(endDateObj.getFullYear(), endDateObj.getMonth(), 1);

        while (cursor.getTime() <= lastMonth.getTime()) {
            const year = cursor.getFullYear();
            const monthIndex = cursor.getMonth();
            const monthDateStr = `${year}-${String(monthIndex + 1).padStart(2, '0')}-01`;

            if (!existingMonths.has(monthDateStr)) {
                const dueInfo = computeLinkDueForMonth(netSalaryValue, link.link_date, endDateStr, year, monthIndex);
                if (dueInfo.overlapDays > 0) {
                    rowsToInsert.push({
                        employee_link_id: link.id,
                        collection_month: monthDateStr,
                        amount: dueInfo.dueAmount,
                        received_amount: 0,
                        status: 'unpaid',
                        paid_at: null,
                        notes: null
                    });
                }
            }

            cursor.setMonth(cursor.getMonth() + 1);
        }

        if (rowsToInsert.length === 0) return;

        const { error: insertError } = await dbClient
            .from('employee_collections')
            .upsert(rowsToInsert, { onConflict: 'employee_link_id,collection_month' });
        if (insertError) {
            console.error('تعذّر إنشاء سجلات التحصيل التلقائية لهذا الموظف بعد إنهاء ربطه:', insertError.message);
        }
    } catch (error) {
        console.error('Ensure Collection Records For Ended Link Error:', error);
    }
}

// =========================================================================
// 4. رسم جدول الموظفين المرتبطين (مع زر "إنهاء الربط" بكل صف)
// =========================================================================
function renderEndLinkTable(data) {
    const tableBody = document.getElementById('endLinkTableBody');
    if (!tableBody) return;

    if (!data || data.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; color:#94a3b8;">لا يوجد موظفون مرتبطون مطابقون لخيارات البحث.</td></tr>`;
        setupEndLinkPaginationControls(0);
        return;
    }

    const startIndex = (currentEndLinkPage - 1) * endLinksPerPage;
    const endIndex = startIndex + endLinksPerPage;
    const paginatedData = data.slice(startIndex, endIndex);

    tableBody.innerHTML = '';

    paginatedData.forEach(link => {
        const row = document.createElement('tr');

        const employeeName = (link.employees && link.employees.name) ? link.employees.name : '----';
        const companyName = (link.companies && link.companies.name) ? link.companies.name : '----';

        row.innerHTML = `
            <td><strong style="color: #1e293b;">${employeeName}</strong></td>
            <td style="color: #475569;">${companyName}</td>
            <td style="font-weight: 500; color: #334155;">${link.job_title || '----'}</td>
            <td style="text-align: center;">${renderLinkTypeBadge(link.link_type)}</td>
            <td style="text-align: center; font-family: monospace;">${formatEndLinkDate(link.link_date)}</td>
            <td style="text-align: center; font-family: monospace;">${formatEndLinkDate(link.link_end_date)}</td>
            <td style="text-align: center;">
                <button type="button" class="btn-end-link-row" onclick="openEndLinkModal('${link.employee_id}')">
                    <span data-icon="unlink"></span> إنهاء الربط
                </button>
            </td>
        `;
        tableBody.appendChild(row);
    });

    applyIconPlaceholders(tableBody);
    setupEndLinkPaginationControls(data.length);
}

// 🔍 دالة التصفية: تجمع بحث (اسم الموظف أو رقم الهوية) واسم الشركة معاً
function applyEndLinkFilters() {
    const nameText = (document.getElementById('endLinkEmployeeNameSearch')?.value || '').toLowerCase().trim();
    const companyText = (document.getElementById('endLinkCompanySearch')?.value || '').toLowerCase().trim();

    filteredLinksCache = localLinksCache.filter(link => {
        const employeeName = (link.employees && link.employees.name) ? link.employees.name.toLowerCase() : '';
        const employeeNationalId = (link.employees && link.employees.national_id) ? String(link.employees.national_id).toLowerCase() : '';
        const companyName = (link.companies && link.companies.name) ? link.companies.name.toLowerCase() : '';

        // 🆕 حقل البحث الأول يطابق اسم الموظف أو رقم هويته
        const matchesName = !nameText || employeeName.includes(nameText) || employeeNationalId.includes(nameText);
        const matchesCompany = !companyText || companyName.includes(companyText);

        return matchesName && matchesCompany;
    });

    currentEndLinkPage = 1;
    renderEndLinkTable(filteredLinksCache);
}

// 📟 بناء عداد التنقل بين الصفحات أسفل الجدول (نفس نمط شاشة "ربط الموظفين")
function setupEndLinkPaginationControls(totalItems) {
    const controlsContainer = document.getElementById('endLinkPagination');
    if (!controlsContainer) return;
    controlsContainer.innerHTML = '';

    const totalPages = Math.ceil(totalItems / endLinksPerPage);
    if (totalPages <= 1) return;

    const prevBtn = document.createElement('button');
    prevBtn.innerHTML = '&rarr; السابقة';
    prevBtn.disabled = currentEndLinkPage === 1;
    prevBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;';
    if (prevBtn.disabled) prevBtn.style.opacity = '0.5';
    prevBtn.onclick = () => {
        if (currentEndLinkPage > 1) {
            currentEndLinkPage--;
            renderEndLinkTable(filteredLinksCache);
        }
    };
    controlsContainer.appendChild(prevBtn);

    const countLabel = document.createElement('span');
    countLabel.style.cssText = 'font-size: 0.9rem; color: #475569; font-weight: 600; font-family: system-ui, sans-serif; margin: 0 10px;';
    countLabel.textContent = `صفحة ${currentEndLinkPage} من ${totalPages}`;
    controlsContainer.appendChild(countLabel);

    const nextBtn = document.createElement('button');
    nextBtn.innerHTML = 'التالية &larr;';
    nextBtn.disabled = currentEndLinkPage === totalPages;
    nextBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;';
    if (nextBtn.disabled) nextBtn.style.opacity = '0.5';
    nextBtn.onclick = () => {
        if (currentEndLinkPage < totalPages) {
            currentEndLinkPage++;
            renderEndLinkTable(filteredLinksCache);
        }
    };
    controlsContainer.appendChild(nextBtn);
}

// =========================================================================
// 5. سجل الموظفين الذين تم إنهاء ربطهم سابقاً (أرشيف دائم — جدول employee_link_history)
// 🆕 كل صف يعرض نقطة ملوّنة قبل الاسم بحسب procedure_status (خضراء مكتمل / صفراء
// غير مكتمل مع سبب العدم تحت الاسم)، وزر "حالة الإجراءات" لتغييرها لاحقاً.
// 🆕 حقل بحث (اسم الموظف / رقم الهوية / الشركة / المسمى الوظيفي) يصفّي الجدول.
// =========================================================================
async function fetchAndRenderHistoryTable() {
    const tableBody = document.getElementById('endLinkHistoryTableBody');
    if (!tableBody) return;

    const { data, error } = await dbClient
        .from('employee_link_history')
        .select('*')
        .order('ended_at', { ascending: false });

    if (error) {
        console.error('تعذّر تحميل سجل الإنهاءات السابقة:', error.message);
        tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#ef4444; padding:20px;">تعذّر تحميل سجل الإنهاءات السابقة: ${error.message}</td></tr>`;
        return;
    }

    localHistoryCache = data || [];
    applyHistoryFilters();
}

// 🔍 تصفية سجل الأرشيف بحقل البحث (يطابق أي جزء من اسم الموظف أو رقم الهويّة أو
// الشركة أو المسمى الوظيفي)، ثم العودة للصفحة الأولى
function applyHistoryFilters() {
    const text = (document.getElementById('endLinkHistorySearch')?.value || '').toLowerCase().trim();

    filteredHistoryCache = !text
        ? localHistoryCache.slice()
        : localHistoryCache.filter(record => {
            const haystack = [
                record.employee_name,
                record.national_id,
                record.company_name,
                record.job_title,
                record.link_type
            ].map(v => String(v == null ? '' : v).toLowerCase());
            return haystack.some(v => v.includes(text));
        });

    currentHistoryPage = 1;
    renderHistoryTable();
}

function renderHistoryTable() {
    const tableBody = document.getElementById('endLinkHistoryTableBody');
    if (!tableBody) return;

    if (!localHistoryCache || localHistoryCache.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; color:#94a3b8;">لا يوجد حتى الآن أي موظف تم إنهاء ربطه.</td></tr>`;
        setupHistoryPaginationControls(0);
        return;
    }

    if (!filteredHistoryCache || filteredHistoryCache.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; color:#94a3b8;">لا توجد نتائج مطابقة لبحثك في سجل الإنهاءات.</td></tr>`;
        setupHistoryPaginationControls(0);
        return;
    }

    const startIndex = (currentHistoryPage - 1) * historyPerPage;
    const endIndex = startIndex + historyPerPage;
    const paginatedData = filteredHistoryCache.slice(startIndex, endIndex);

    tableBody.innerHTML = paginatedData.map(record => {
        const isIncomplete = record.procedure_status === PROCEDURE_STATUS_INCOMPLETE;
        const reasonText = (record.procedure_incomplete_reason || '').trim();
        const dotTitle = isIncomplete
            ? `إجراءات الإنهاء غير مكتملة${reasonText ? ' — السبب: ' + reasonText : ''}`
            : 'إجراءات الإنهاء مكتملة';
        const dotClass = isIncomplete ? 'incomplete' : 'complete';
        const reasonLine = (isIncomplete && reasonText)
            ? `<div class="procedure-reason-subtext">السبب: ${escapeProcedureHtml(reasonText)}</div>`
            : '';

        return `
        <tr>
            <td>
                <div style="display:flex; align-items:flex-start;">
                    <span class="procedure-dot ${dotClass}" style="margin-top:5px;" title="${escapeProcedureHtml(dotTitle)}"></span>
                    <div>
                        <strong style="color: #1e293b;">${record.employee_name || '----'}</strong>
                        ${reasonLine}
                    </div>
                </div>
            </td>
            <td style="color: #475569;">${record.company_name || '----'}</td>
            <td style="font-weight: 500; color: #334155;">${record.job_title || '----'}</td>
            <td style="text-align: center;">${renderLinkTypeBadge(record.link_type)}</td>
            <td style="text-align: center; font-family: monospace;">${formatEndLinkDate(record.start_date)}</td>
            <td style="text-align: center; font-family: monospace;">${formatEndLinkDate(record.end_date)}</td>
            <td style="text-align: center;">
                <button type="button" class="btn-procedure-status-row" data-perm="edit:end_employee_link" onclick="openProcedureModal('${record.id}')">
                    ${isIncomplete ? '🟡 إكمال الإجراءات' : '🟢 حالة الإجراءات'}
                </button>
                <button type="button" class="btn-restore-link-row" onclick="restoreEndedLink('${record.id}')">
                    <span data-icon="link"></span> استعادة
                </button>
            </td>
        </tr>`;
    }).join('');

    applyIconPlaceholders(tableBody);
    // الأزرار المولَّدة ديناميكياً تحمل data-perm — يجب تطبيق قاعدة الصلاحيات عليها يدوياً
    if (window.Permissions && typeof Permissions.applyButtonGating === 'function') {
        Permissions.applyButtonGating(tableBody);
    }
    setupHistoryPaginationControls(filteredHistoryCache.length);
}

function setupHistoryPaginationControls(totalItems) {
    const controlsContainer = document.getElementById('endLinkHistoryPagination');
    if (!controlsContainer) return;
    controlsContainer.innerHTML = '';

    const totalPages = Math.ceil(totalItems / historyPerPage);
    if (totalPages <= 1) return;

    const prevBtn = document.createElement('button');
    prevBtn.innerHTML = '&rarr; السابقة';
    prevBtn.disabled = currentHistoryPage === 1;
    prevBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;';
    if (prevBtn.disabled) prevBtn.style.opacity = '0.5';
    prevBtn.onclick = () => {
        if (currentHistoryPage > 1) {
            currentHistoryPage--;
            renderHistoryTable();
        }
    };
    controlsContainer.appendChild(prevBtn);

    const countLabel = document.createElement('span');
    countLabel.style.cssText = 'font-size: 0.9rem; color: #475569; font-weight: 600; font-family: system-ui, sans-serif; margin: 0 10px;';
    countLabel.textContent = `صفحة ${currentHistoryPage} من ${totalPages}`;
    controlsContainer.appendChild(countLabel);

    const nextBtn = document.createElement('button');
    nextBtn.innerHTML = 'التالية &larr;';
    nextBtn.disabled = currentHistoryPage === totalPages;
    nextBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;';
    if (nextBtn.disabled) nextBtn.style.opacity = '0.5';
    nextBtn.onclick = () => {
        if (currentHistoryPage < totalPages) {
            currentHistoryPage++;
            renderHistoryTable();
        }
    };
    controlsContainer.appendChild(nextBtn);
}

// =========================================================================
// 🆕 5.1 نافذة تغيير حالة إجراءات إنهاء الربط لسجل بالأرشيف
// (مثلاً: تحويل "غير مكتمل" إلى "مكتمل" عند اكتمال إجراءات الإنهاء، أو العكس)
// عند التحويل إلى "مكتمل" يُفرَّغ السبب، وعند "غير مكتمل" السبب إلزامي.
// =========================================================================
function showProcedureModalAlert(message, type) {
    const box = document.getElementById('procedureModalAlert');
    box.textContent = message;
    box.className = 'form-alert ' + (type === 'success' ? 'alert-success' : 'alert-error');
    box.style.display = 'flex';
}
function hideProcedureModalAlert() {
    document.getElementById('procedureModalAlert').style.display = 'none';
}
function setProcedureModalFieldError(message) {
    const group = document.getElementById('group-procedure_modal');
    const errorEl = document.getElementById('error-procedure_modal');
    if (!group || !errorEl) return;
    if (message) { group.classList.add('has-error'); errorEl.textContent = message; }
    else { group.classList.remove('has-error'); errorEl.textContent = ''; }
}

function getSelectedRadioValue(name) {
    const checked = document.querySelector(`input[name="${name}"]:checked`);
    return checked ? checked.value : null;
}

function syncProcedureModalReasonVisibility() {
    const isIncomplete = getSelectedRadioValue('procedureModalStatus') === PROCEDURE_STATUS_INCOMPLETE;
    document.getElementById('procedureModalReasonGroup').style.display = isIncomplete ? 'block' : 'none';
}

function openProcedureModal(historyId) {
    const record = localHistoryCache.find(r => String(r.id) === String(historyId));
    if (!record) return;

    document.getElementById('procedureModalHistoryId').value = historyId;
    document.getElementById('procedureModalEmployeeName').textContent = record.employee_name || '—';
    document.getElementById('procedureModalCompany').textContent = record.company_name || '—';

    const isIncomplete = record.procedure_status === PROCEDURE_STATUS_INCOMPLETE;
    const targetValue = isIncomplete ? PROCEDURE_STATUS_INCOMPLETE : PROCEDURE_STATUS_COMPLETE;
    document.querySelectorAll('input[name="procedureModalStatus"]').forEach(radio => {
        radio.checked = radio.value === targetValue;
    });
    document.getElementById('procedureModalReason').value = isIncomplete ? (record.procedure_incomplete_reason || '') : '';
    syncProcedureModalReasonVisibility();

    setProcedureModalFieldError(null);
    hideProcedureModalAlert();
    document.getElementById('procedureStatusModal').style.display = 'flex';
}

function closeProcedureModal() {
    document.getElementById('procedureStatusModal').style.display = 'none';
}

async function handleSaveProcedureStatus() {
    hideProcedureModalAlert();

    const historyId = document.getElementById('procedureModalHistoryId').value;
    const record = localHistoryCache.find(r => String(r.id) === String(historyId));
    if (!record) {
        showProcedureModalAlert('تعذّر العثور على سجل الأرشيف المطلوب.', 'error');
        return;
    }

    const status = getSelectedRadioValue('procedureModalStatus') || PROCEDURE_STATUS_COMPLETE;
    const reason = document.getElementById('procedureModalReason').value.trim();

    if (status === PROCEDURE_STATUS_INCOMPLETE && !reason) {
        setProcedureModalFieldError('الرجاء كتابة سبب عدم اكتمال الإجراءات.');
        showProcedureModalAlert('الرجاء تصحيح الحقول المظللة أعلاه.', 'error');
        return;
    }
    setProcedureModalFieldError(null);

    const saveBtn = document.getElementById('btnSaveProcedureStatus');
    const originalText = saveBtn.textContent;
    saveBtn.disabled = true;
    saveBtn.textContent = 'جاري الحفظ...';

    try {
        const { data: updatedRows, error } = await dbClient
            .from('employee_link_history')
            .update({
                procedure_status: status,
                procedure_incomplete_reason: status === PROCEDURE_STATUS_INCOMPLETE ? reason : null,
                procedure_updated_at: new Date().toISOString()
            })
            .eq('id', record.id)
            .select();

        if (error) {
            if (/procedure_/i.test(error.message || '')) {
                throw new Error('أعمدة حالة الإجراءات غير موجودة بعد في قاعدة البيانات — نفّذ سكربت employee_link_history_procedure_status.sql في Supabase أولاً. (' + error.message + ')');
            }
            throw new Error(error.message);
        }
        if (!updatedRows || updatedRows.length === 0) {
            throw new Error('لم يتم تحديث الحالة فعلياً. الأسباب الشائعة: عدم وجود سياسة تعديل (RLS UPDATE Policy) على جدول employee_link_history — نفّذ سكربت employee_link_history_procedure_status.sql في Supabase.');
        }

        closeProcedureModal();
        await fetchAndRenderHistoryTable();
    } catch (error) {
        console.error('Save Procedure Status Error:', error);
        showProcedureModalAlert('فشل حفظ الحالة: ' + error.message, 'error');
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = originalText;
    }
}

// 🔁 استعادة موظف من الأرشيف: إعادة تفعيل ربطه بشركته السابقة (كما كان عليه
// قبل الإنهاء)، وحذف سجل الأرشيف بعد نجاح الاستعادة. يُمنع الإجراء إن كان
// الموظف قد أصبح مرتبطاً بالفعل بشركة أخرى (أو نفس الشركة) بعد إنهاء هذا السجل،
// لأن كل موظف يُربط بشركة واحدة فقط في نفس الوقت (نفس قاعدة شاشة "ربط الموظفين").
// ⚠️ الفحص هنا يقتصر على الروابط "النشطة فقط" (بلا تاريخ انتهاء، أو لم يأتِ
// تاريخ انتهائها بعد)، لأن روابط هذا الموظف المُنهاة سابقاً باتت الآن تبقى
// محفوظة بالجدول (بعد التحوّل من الحذف الفعلي لمجرد تسجيل تاريخ انتهاء) ولا
// يجب أن تُحتسب كربط نشط يمنع الاستعادة.
//
// ⚠️ إصلاح جوهري: جدول employee_links يفرض قيداً فريداً (UNIQUE) على العمود
// employee_id — سجل واحد فقط لكل موظف طوال الوقت مهما تعدّدت فترات عمله. وبما
// أن "إنهاء الربط" (handleConfirmEndLink أدناه) لم يعد يحذف السجل بل يكتفي
// بتحديث link_end_date عليه، فإن هذا الموظف لا يزال يملك سجلاً قديماً (منتهياً)
// بنفس الجدول. لذا يجب "استعادته" عبر تحديث (UPDATE) هذا السجل نفسه بدل إدراج
// (INSERT) سجل جديد بنفس employee_id — وإلا فشلت العملية بخطأ تكرار المفتاح
// الفريد "duplicate key value violates unique constraint employee_links_employee_id_unique".
async function restoreEndedLink(historyId) {
    const record = localHistoryCache.find(r => String(r.id) === String(historyId));
    if (!record) {
        alert('تعذّر العثور على سجل الأرشيف المطلوب استعادته.');
        return;
    }

    if (!confirm(`هل تريد استعادة الموظف "${record.employee_name || ''}" وربطه من جديد بشركة "${record.company_name || ''}"؟`)) {
        return;
    }

    try {
        // 1) التأكد من عدم وجود ربط نشط حالياً لهذا الموظف بأي شركة أخرى
        const todayStr = getTodayDateString();
        const { data: existingLink, error: existingLinkError } = await dbClient
            .from('employee_links')
            .select('id, companies(name)')
            .eq('employee_id', record.employee_id)
            .or(`link_end_date.is.null,link_end_date.gte.${todayStr}`)
            .maybeSingle();

        if (existingLinkError) throw new Error(existingLinkError.message);

        if (existingLink) {
            const existingCompanyName = (existingLink.companies && existingLink.companies.name) ? existingLink.companies.name : 'شركة أخرى';
            alert(`لا يمكن استعادة هذا الموظف: هو مرتبط حالياً بالفعل بشركة "${existingCompanyName}". يجب إنهاء هذا الربط الحالي أولاً قبل استعادته لشركته السابقة.`);
            return;
        }

        // 2) إعادة إنشاء ربط نشط جديد لنفس الشركة والمسمى الوظيفي، بتاريخ ربط
        // جديد هو تاريخ اليوم (بداية فترة عمل جديدة)، مع نفس نوع الربط وقيمة
        // الاشتراك وبيانات الراتب (إجمالي/أساسي/صافي) المحفوظة في سجل الأرشيف إن وُجدت
        const newLinkDate = getTodayDateString();
        const restorePayload = {
            employee_id: record.employee_id,
            company_id: record.company_id,
            job_title: record.job_title || null,
            link_type: record.link_type || 'اضافة',
            link_date: newLinkDate,
            link_end_date: computeLinkEndDate(newLinkDate) || null,
            subscription_value: record.subscription_value != null ? record.subscription_value : 0,
            salary_value: record.salary_value != null ? record.salary_value : null,
            basic_salary_value: record.basic_salary_value != null ? record.basic_salary_value : null,
            net_salary_value: record.net_salary_value != null ? record.net_salary_value : null
        };

        // 🔍 البحث عن سجل الربط السابق لنفس الموظف بجدول employee_links (بلا أي
        // فلترة على تاريخ الانتهاء هذه المرة) — بما أن العمود employee_id فريد
        // بهذا الجدول، لا يمكن أن يوجد أكثر من سجل واحد لنفس الموظف، وهو غالباً
        // موجود فعلاً (السجل المُنهى سابقاً) ما دام هذا الموظف قد رُبط بشركة من قبل.
        const { data: previousLinkRow, error: previousLinkError } = await dbClient
            .from('employee_links')
            .select('id')
            .eq('employee_id', record.employee_id)
            .maybeSingle();
        if (previousLinkError) throw new Error(previousLinkError.message);

        let insertedRows, insertError;
        if (previousLinkRow) {
            // ✅ يوجد سجل سابق لهذا الموظف بالفعل ⇐ يجب تحديثه (UPDATE) لا إدراج
            // سجل جديد، تفادياً لتعارض القيد الفريد على employee_id
            ({ data: insertedRows, error: insertError } = await dbClient
                .from('employee_links')
                .update(restorePayload)
                .eq('id', previousLinkRow.id)
                .select());
        } else {
            // لا يوجد سجل سابق إطلاقاً لهذا الموظف (حالة نادرة) ⇐ إدراج سجل جديد كالمعتاد
            ({ data: insertedRows, error: insertError } = await dbClient
                .from('employee_links')
                .insert([restorePayload])
                .select());
        }
        if (insertError) throw new Error(insertError.message);
        if (!insertedRows || insertedRows.length === 0) {
            throw new Error('لم يتم إنشاء/تحديث الربط فعلياً. تحقق من وجود سياسة تعديل أو إضافة (RLS UPDATE/INSERT Policy) على جدول employee_links في سوبابيس.');
        }

        // 3) إعادة تفعيل حالة الموظف
        const { error: statusError } = await dbClient
            .from('employees')
            .update({ status: 'active' })
            .eq('id', record.employee_id);
        if (statusError) {
            console.error('تعذّر تحديث حالة الموظف بعد الاستعادة:', statusError.message);
        }

        // 4) حذف سجل الأرشيف بعد نجاح الاستعادة
        const { data: deletedHistoryRows, error: deleteHistoryError } = await dbClient
            .from('employee_link_history')
            .delete()
            .eq('id', record.id)
            .select();
        if (deleteHistoryError) {
            console.error('تعذّر حذف سجل الأرشيف بعد الاستعادة:', deleteHistoryError.message);
        } else if (!deletedHistoryRows || deletedHistoryRows.length === 0) {
            console.error('لم يُحذف سجل الأرشيف فعلياً بعد الاستعادة — تحقق من سياسة الحذف (RLS DELETE Policy) على جدول employee_link_history.');
        }

        await fetchAndRenderEndLinkTable();
        await fetchAndRenderHistoryTable();
        await fetchAndRenderExpiredContractsTable();

    } catch (error) {
        console.error('Restore Ended Link Error:', error);
        alert('فشلت عملية الاستعادة: ' + error.message);
    }
}

// =========================================================================
// 🆕 6. "العقود المنتهية": روابط تجاوز تاريخها المتوقع (employee_links.link_end_date)
// فعلياً بمرور الوقت (هذا التاريخ يُحسب تلقائياً كسنة كاملة من تاريخ الربط
// عند إنشاء الرابط — انظر computeLinkEndDate — أو عند "استعادة" موظف)، دون أن
// يُنهيها أحد يدوياً عبر زر "إنهاء الربط" أعلاه.
//
// ⚠️ قبل إضافة هذا الجدول، كانت هذه الحالة تجعل الموظف يختفي بصمت من كل
// شاشات النظام: لا يظهر بجدول "المرتبطين حالياً" أعلاه (استعلامه يستبعد أي
// link_end_date ماضٍ)، ولا بأرشيف "الإنهاءات السابقة" أسفله (ذلك الأرشيف
// employee_link_history لا يُنشأ إلا صراحة عبر handleConfirmEndLink، وهذه
// الحالة لم تمرّ بتلك الدالة إطلاقاً). هذا الجدول يعرضهم كمرجع دائم، مع إمكانية
// "تجديد العقد" مباشرة (تمديد link_end_date بمدة يختارها المستخدم، سنة واحدة
// افتراضياً) بدل الاضطرار لإنهاء الربط يدوياً ثم استعادته من الأرشيف.
//
// 🔍 التمييز عن الروابط المُنهاة يدوياً: كلاهما لهما نفس الشكل بجدول
// employee_links (link_end_date في الماضي، والسجل نفسه لم يُحذف قط — انظر
// تعليق handleConfirmEndLink). الفارق الوحيد هو وجود سجل مطابق (نفس الموظف +
// نفس تاريخ الانتهاء) بأرشيف employee_link_history أم لا: إن وُجد ⇐ كان إنهاءً
// يدوياً ومعروض بالفعل بجدول الأرشيف أسفل الصفحة، فيُستبعَد من هنا تفادياً
// للتكرار. لذا يجب أن يكتمل تحميل localHistoryCache (fetchAndRenderHistoryTable)
// قبل استدعاء هذه الدالة — انظر ترتيب الاستدعاء بمستمع DOMContentLoaded أعلاه.
// =========================================================================
async function fetchAndRenderExpiredContractsTable() {
    const tableBody = document.getElementById('expiredContractsTableBody');
    if (!tableBody) return;

    const todayStr = getTodayDateString();
    const { data, error } = await dbClient
        .from('employee_links')
        .select('*, employees(name, national_id), companies(name)')
        .not('link_end_date', 'is', null)
        .lt('link_end_date', todayStr)
        .order('link_end_date', { ascending: false });

    if (error) {
        console.error('تعذّر تحميل قائمة العقود المنتهية:', error.message);
        tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#ef4444; padding:20px;">تعذّر تحميل قائمة العقود المنتهية: ${error.message}</td></tr>`;
        return;
    }

    const manuallyEndedKeys = new Set(
        (localHistoryCache || []).map(r => `${r.employee_id}::${String(r.end_date || '').split('T')[0]}`)
    );

    localExpiredContractsCache = (data || []).filter(link => {
        const key = `${link.employee_id}::${String(link.link_end_date || '').split('T')[0]}`;
        return !manuallyEndedKeys.has(key);
    });

    currentExpiredContractsPage = 1;
    renderExpiredContractsTable();
}

function renderExpiredContractsTable() {
    const tableBody = document.getElementById('expiredContractsTableBody');
    if (!tableBody) return;

    if (!localExpiredContractsCache || localExpiredContractsCache.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; color:#94a3b8;">لا توجد عقود منتهية حالياً بحاجة لتجديد.</td></tr>`;
        setupExpiredContractsPaginationControls(0);
        return;
    }

    const startIndex = (currentExpiredContractsPage - 1) * expiredContractsPerPage;
    const endIndex = startIndex + expiredContractsPerPage;
    const paginatedData = localExpiredContractsCache.slice(startIndex, endIndex);

    tableBody.innerHTML = '';

    paginatedData.forEach(link => {
        const row = document.createElement('tr');

        const employeeName = (link.employees && link.employees.name) ? link.employees.name : '----';
        const companyName = (link.companies && link.companies.name) ? link.companies.name : '----';

        row.innerHTML = `
            <td><strong style="color: #1e293b;">${employeeName}</strong></td>
            <td style="color: #475569;">${companyName}</td>
            <td style="font-weight: 500; color: #334155;">${link.job_title || '----'}</td>
            <td style="text-align: center;">${renderLinkTypeBadge(link.link_type)}</td>
            <td style="text-align: center; font-family: monospace;">${formatEndLinkDate(link.link_date)}</td>
            <td style="text-align: center; font-family: monospace; color:#b45309; font-weight:600;">${formatEndLinkDate(link.link_end_date)}</td>
            <td style="text-align: center;">
                <button type="button" class="btn-restore-link-row" onclick="openRenewContractPrompt('${link.id}')">
                    🔄 تجديد العقد
                </button>
            </td>
        `;
        tableBody.appendChild(row);
    });

    setupExpiredContractsPaginationControls(localExpiredContractsCache.length);
}

function setupExpiredContractsPaginationControls(totalItems) {
    const controlsContainer = document.getElementById('expiredContractsPagination');
    if (!controlsContainer) return;
    controlsContainer.innerHTML = '';

    const totalPages = Math.ceil(totalItems / expiredContractsPerPage);
    if (totalPages <= 1) return;

    const prevBtn = document.createElement('button');
    prevBtn.innerHTML = '&rarr; السابقة';
    prevBtn.disabled = currentExpiredContractsPage === 1;
    prevBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;';
    if (prevBtn.disabled) prevBtn.style.opacity = '0.5';
    prevBtn.onclick = () => {
        if (currentExpiredContractsPage > 1) {
            currentExpiredContractsPage--;
            renderExpiredContractsTable();
        }
    };
    controlsContainer.appendChild(prevBtn);

    const countLabel = document.createElement('span');
    countLabel.style.cssText = 'font-size: 0.9rem; color: #475569; font-weight: 600; font-family: system-ui, sans-serif; margin: 0 10px;';
    countLabel.textContent = `صفحة ${currentExpiredContractsPage} من ${totalPages}`;
    controlsContainer.appendChild(countLabel);

    const nextBtn = document.createElement('button');
    nextBtn.innerHTML = 'التالية &larr;';
    nextBtn.disabled = currentExpiredContractsPage === totalPages;
    nextBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;';
    if (nextBtn.disabled) nextBtn.style.opacity = '0.5';
    nextBtn.onclick = () => {
        if (currentExpiredContractsPage < totalPages) {
            currentExpiredContractsPage++;
            renderExpiredContractsTable();
        }
    };
    controlsContainer.appendChild(nextBtn);
}

// 🆕 يطلب من المستخدم مدة التجديد بالسنوات (افتراضياً سنة واحدة، قابلة
// للتعديل لأكثر) عبر prompt بسيط (نفس نمط toggleCollectionStatus بشاشة
// "تحصيل الموظفين")، ثم يمرّرها لـ handleRenewContract لتنفيذ التجديد فعلياً
function openRenewContractPrompt(linkId) {
    const link = localExpiredContractsCache.find(l => String(l.id) === String(linkId));
    if (!link) return;

    const employeeName = (link.employees && link.employees.name) ? link.employees.name : '----';

    const enteredRaw = prompt(
        `تجديد عقد الموظف "${employeeName}" — أدخل مدة التجديد بالسنوات (افتراضياً سنة واحدة، يمكن إدخال أكثر مثل 2 أو 3):`,
        '1'
    );
    if (enteredRaw === null) return; // إلغاء المستخدم — لا تغيير

    const years = parseFloat(String(enteredRaw).trim());
    if (isNaN(years) || years <= 0) {
        alert('الرجاء إدخال مدة تجديد صحيحة أكبر من صفر (بالسنوات).');
        return;
    }

    handleRenewContract(link, years);
}

// 🆕 تنفيذ تجديد العقد فعلياً: تمديد employee_links.link_end_date لنفس السجل
// (بلا حذف/إنشاء ربط جديد ولا تغيير تاريخ الربط الأصلي link_date) إلى تاريخ
// جديد = تاريخ اليوم + مدة التجديد المُدخلة بالسنوات — العقد كان منتهياً
// فعلياً، فالتجديد يبدأ فترة جديدة اعتباراً من الآن (وليس استكمالاً من تاريخ
// الانتهاء القديم). يدعم قيماً عشرية (مثل 1.5 سنة) عبر تقريبها لعدد أيام
// (365.25 يوماً/سنة) بدل الاقتصار على سنوات صحيحة فقط.
async function handleRenewContract(link, years) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let newEndDateObj;
    if (Number.isInteger(years)) {
        newEndDateObj = new Date(today.getTime());
        newEndDateObj.setFullYear(newEndDateObj.getFullYear() + years);
    } else {
        const totalDays = Math.round(years * 365.25);
        newEndDateObj = new Date(today.getTime() + totalDays * 86400000);
    }

    const yyyy = newEndDateObj.getFullYear();
    const mm = String(newEndDateObj.getMonth() + 1).padStart(2, '0');
    const dd = String(newEndDateObj.getDate()).padStart(2, '0');
    const newEndDateStr = `${yyyy}-${mm}-${dd}`;

    const employeeName = (link.employees && link.employees.name) ? link.employees.name : '----';
    if (!confirm(`سيتم تجديد عقد الموظف "${employeeName}" حتى تاريخ ${formatEndLinkDate(newEndDateStr)}. هل تريد المتابعة؟`)) return;

    try {
        const { data: updatedRows, error: updateError } = await dbClient
            .from('employee_links')
            .update({ link_end_date: newEndDateStr })
            .eq('id', link.id)
            .select();
        if (updateError) throw new Error(updateError.message);
        if (!updatedRows || updatedRows.length === 0) {
            throw new Error('لم يتم تجديد العقد فعلياً. تحقق من وجود سياسة تعديل (RLS UPDATE Policy) على جدول employee_links في سوبابيس.');
        }

        // 🛡️ التأكد من أن حالة الموظف "نشط" بعد التجديد (غالباً كانت لا تزال
        // active أصلاً بما أن هذا الرابط لم يُنهَ يدوياً من قبل قط، لكن نضبطها
        // احتياطاً حتى لو تغيّرت بطريقة أخرى)
        const { error: statusError } = await dbClient
            .from('employees')
            .update({ status: 'active' })
            .eq('id', link.employee_id);
        if (statusError) {
            console.error('تعذّر تحديث حالة الموظف بعد تجديد العقد:', statusError.message);
        }

        alert(`تم تجديد عقد الموظف "${employeeName}" بنجاح حتى ${formatEndLinkDate(newEndDateStr)}.`);

        await fetchAndRenderEndLinkTable();
        await fetchAndRenderExpiredContractsTable();

    } catch (error) {
        console.error('Renew Contract Error:', error);
        alert('فشلت عملية تجديد العقد: ' + error.message);
    }
}

// =========================================================================
// 7. نافذة تأكيد إنهاء الربط
// =========================================================================
function showEndLinkModalAlert(message, type) {
    const box = document.getElementById('endLinkModalAlert');
    box.textContent = message;
    box.className = 'form-alert ' + (type === 'success' ? 'alert-success' : 'alert-error');
    box.style.display = 'flex';
}
function hideEndLinkModalAlert() {
    document.getElementById('endLinkModalAlert').style.display = 'none';
}
function setEndDateFieldError(message) {
    const group = document.getElementById('group-end_date');
    const errorEl = document.getElementById('error-end_date');
    if (!group || !errorEl) return;
    if (message) { group.classList.add('has-error'); errorEl.textContent = message; }
    else { group.classList.remove('has-error'); errorEl.textContent = ''; }
}

// 🆕 خطأ حقل حالة الإجراءات/السبب بنافذة الإنهاء
function setEndProcedureFieldError(message) {
    const group = document.getElementById('group-end_procedure');
    const errorEl = document.getElementById('error-end_procedure');
    if (!group || !errorEl) return;
    if (message) { group.classList.add('has-error'); errorEl.textContent = message; }
    else { group.classList.remove('has-error'); errorEl.textContent = ''; }
}

// 🆕 إظهار حقل "سبب عدم اكتمال الإجراءات" فقط عند اختيار "غير مكتمل"
function syncEndProcedureReasonVisibility() {
    const isIncomplete = getSelectedRadioValue('endProcedureStatus') === PROCEDURE_STATUS_INCOMPLETE;
    document.getElementById('endProcedureReasonGroup').style.display = isIncomplete ? 'block' : 'none';
}

function openEndLinkModal(employeeId) {
    const link = localLinksCache.find(l => String(l.employee_id) === String(employeeId));
    if (!link) return;

    document.getElementById('endLinkModalEmployeeId').value = employeeId;
    document.getElementById('endLinkModalEmployeeName').textContent = (link.employees && link.employees.name) ? link.employees.name : '—';
    document.getElementById('endLinkModalCompany').textContent = (link.companies && link.companies.name) ? link.companies.name : '—';
    document.getElementById('endLinkModalJobTitle').textContent = link.job_title || '—';
    document.getElementById('endLinkModalLinkDate').textContent = formatEndLinkDate(link.link_date);

    document.getElementById('endLinkModalDate').value = getTodayDateString();
    setEndDateFieldError(null);

    // 🆕 إعادة ضبط حالة الإجراءات للافتراضي (مكتمل، بلا سبب) عند كل فتح للنافذة
    document.querySelectorAll('input[name="endProcedureStatus"]').forEach(radio => {
        radio.checked = radio.value === PROCEDURE_STATUS_COMPLETE;
    });
    document.getElementById('endProcedureReason').value = '';
    syncEndProcedureReasonVisibility();
    setEndProcedureFieldError(null);

    hideEndLinkModalAlert();

    // ⚠️ modal-overlay في employees.css لا يملك متغيّر CSS classlist ".open"
    // (خلافاً لـ blacklist.css/users.css) — تحكّمه يتم فقط عبر style.display
    // مباشرة من JS (تماماً كما في support.js لنافذة التذاكر)، ولهذا لا تُستخدم
    // classList.add/remove('open') هنا وإلا تبقى النافذة غير مرئية دائماً —
    // وهذا بالضبط ما كان يمنع ظهور النافذة/عمل زر "إنهاء الربط" سابقاً.
    document.getElementById('endLinkModal').style.display = 'flex';
}

function closeEndLinkModal() {
    document.getElementById('endLinkModal').style.display = 'none';
}

async function handleConfirmEndLink() {
    hideEndLinkModalAlert();

    const employeeId = document.getElementById('endLinkModalEmployeeId').value;
    const endDate = document.getElementById('endLinkModalDate').value;
    const link = localLinksCache.find(l => String(l.employee_id) === String(employeeId));

    if (!link) {
        showEndLinkModalAlert('تعذّر العثور على بيانات ربط هذا الموظف، ربما تم إنهاؤه بالفعل من مكان آخر.', 'error');
        return;
    }

    if (!endDate) {
        setEndDateFieldError('الرجاء تحديد تاريخ انتهاء الربط.');
        showEndLinkModalAlert('الرجاء تصحيح الحقول المظللة أعلاه.', 'error');
        return;
    }

    if (link.link_date && endDate < link.link_date) {
        setEndDateFieldError('تاريخ الانتهاء لا يمكن أن يكون قبل تاريخ الربط.');
        showEndLinkModalAlert('الرجاء تصحيح الحقول المظللة أعلاه.', 'error');
        return;
    }
    setEndDateFieldError(null);

    // 🆕 حالة إجراءات الإنهاء: السبب إلزامي إن كانت "غير مكتمل"
    const procedureStatus = getSelectedRadioValue('endProcedureStatus') || PROCEDURE_STATUS_COMPLETE;
    const procedureReason = document.getElementById('endProcedureReason').value.trim();
    if (procedureStatus === PROCEDURE_STATUS_INCOMPLETE && !procedureReason) {
        setEndProcedureFieldError('الرجاء كتابة سبب عدم اكتمال الإجراءات.');
        showEndLinkModalAlert('الرجاء تصحيح الحقول المظللة أعلاه.', 'error');
        return;
    }
    setEndProcedureFieldError(null);

    const confirmBtn = document.getElementById('btnConfirmEndLink');
    const originalText = confirmBtn.textContent;
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'جاري الحفظ...';

    try {
        // 1) تسجيل تاريخ انتهاء ربط هذا الموظف — هذا هو ما يجعله "غير مرتبط
        //    حالياً" بأي شركة في كل أنحاء النظام (التقارير، شاشة العرض، شاشة
        //    إضافة ربط جديد...)، دون حذف سجل الربط نفسه فعلياً.
        //
        //    ⚠️ إصلاح جوهري: كان هذا الإجراء سابقاً يحذف سجل الربط
        //    (employee_links) نهائياً، وبما أن جدول employee_collections
        //    (سجل تحصيل الموظف الشهري) مرتبط به بعلاقة ON DELETE CASCADE،
        //    كان حذف الربط يحذف معه بصمت كامل سجل تحصيل الموظف التاريخي —
        //    فقدان دائم للبيانات. الآن نكتفي بتحديث link_end_date على نفس
        //    السجل، فيبقى محفوظاً بكل تاريخه (ولإتاحة استخدامه لاحقاً بصفحة
        //    "تفاصيل الموظف ودفعات السداد" حتى بعد انتهاء ربطه).
        //
        // ⚠️ نطلب .select() على التحديث حتى نعرف بالضبط هل تم تحديث أي سجل
        // فعلياً؛ فبعض إعدادات RLS بسوبابيس تمنع التحديث بصمت (تُرجع نجاحاً
        // بدون أي صف مُحدَّث فعلياً بدل رسالة خطأ صريحة).
        const { data: updatedRows, error: updateError } = await dbClient
            .from('employee_links')
            .update({ link_end_date: endDate })
            .eq('id', link.id)
            .select();
        if (updateError) throw new Error(updateError.message);

        if (!updatedRows || updatedRows.length === 0) {
            throw new Error('لم يتم تسجيل تاريخ انتهاء ربط هذا الموظف فعلياً. الأسباب الشائعة: عدم وجود سياسة تعديل (RLS UPDATE Policy) على جدول employee_links في سوبابيس.');
        }

        // 2) إضافة سجل دائم لأرشيف "الموظفين الذين تم إنهاء ربطهم" — اسم الموظف،
        //    الشركة التي كان يعمل بها، المسمى الوظيفي، وفترة العمل (من تاريخ
        //    الربط الأصلي إلى تاريخ الإنهاء المُدخل)، بالإضافة لنوع الربط وقيمة
        //    الاشتراك وبيانات الراتب (إجمالي/أساسي/صافي) حتى يمكن إعادة إنشاء
        //    نفس الربط لاحقاً عند "استعادة" الموظف لشركته السابقة.
        //    🆕 + حالة إجراءات الإنهاء (مكتمل/غير مكتمل) وسبب عدم الاكتمال.
        //
        //    ⚠️ إصلاح مهم: سابقاً كان فشل هذه الخطوة يُسجَّل بالكونسول فقط دون
        //    أي تنبيه للمستخدم، فإن كانت هناك سياسة إضافة (RLS INSERT Policy)
        //    ناقصة على جدول employee_link_history، كان سجل الأرشيف لا يُنشأ
        //    فعلياً بصمت — رغم أن إنهاء الربط نفسه "نجح" ظاهرياً. النتيجة:
        //    اسم الموظف وبياناته القديمة تضيع تماماً ولا يمكن استرجاعها لاحقاً
        //    (لا تظهر بجدول "سجل الإنهاءات السابقة" هنا، ولا في شاشة "إدارة
        //    المهام" كبديل لاسم الموظف بعد انتهاء ربطه). الآن نتحقق صراحة من
        //    نجاح الإضافة عبر .select() وننبّه المستخدم بوضوح إن فشلت.
        const historyPayload = {
            employee_id: parseInt(employeeId, 10),
            employee_name: (link.employees && link.employees.name) ? link.employees.name : null,
            national_id: (link.employees && link.employees.national_id) ? link.employees.national_id : null,
            company_id: link.company_id != null ? link.company_id : null,
            company_name: (link.companies && link.companies.name) ? link.companies.name : null,
            job_title: link.job_title || null,
            start_date: link.link_date || null,
            end_date: endDate,
            link_type: link.link_type || null,
            subscription_value: link.subscription_value != null ? link.subscription_value : null,
            salary_value: link.salary_value != null ? link.salary_value : null,
            basic_salary_value: link.basic_salary_value != null ? link.basic_salary_value : null,
            net_salary_value: link.net_salary_value != null ? link.net_salary_value : null,
            procedure_status: procedureStatus,
            procedure_incomplete_reason: procedureStatus === PROCEDURE_STATUS_INCOMPLETE ? procedureReason : null,
            procedure_updated_at: new Date().toISOString()
        };

        let { data: insertedHistoryRows, error: historyError } = await dbClient
            .from('employee_link_history')
            .insert([historyPayload])
            .select();

        // 🛡️ احتياطاً: إن لم يُنفَّذ سكربت SQL الخاص بأعمدة حالة الإجراءات بعد
        // (الأعمدة غير موجودة)، لا نفقد سجل الأرشيف بالكامل — نعيد محاولة الإدراج
        // بدون هذه الأعمدة الجديدة وننبّه المستخدم بوضوح لتنفيذ السكربت.
        let procedureColumnsMissing = false;
        if (historyError && /procedure_/i.test(historyError.message || '')) {
            procedureColumnsMissing = true;
            const fallbackPayload = { ...historyPayload };
            delete fallbackPayload.procedure_status;
            delete fallbackPayload.procedure_incomplete_reason;
            delete fallbackPayload.procedure_updated_at;
            ({ data: insertedHistoryRows, error: historyError } = await dbClient
                .from('employee_link_history')
                .insert([fallbackPayload])
                .select());
        }

        if (historyError) {
            console.error('تعذّر إضافة سجل أرشيف إنهاء الربط:', historyError.message);
            alert('⚠️ تم إنهاء ربط الموظف بنجاح، لكن تعذّر حفظ بياناته بالأرشيف: ' + historyError.message + '\n\nقد تحتاج لإضافة سياسة إدراج (RLS INSERT Policy) على جدول employee_link_history في سوبابيس. بدون هذا الأرشيف، لن يظهر اسم الموظف لاحقاً في المهام المُسندة إليه سابقاً.');
        } else if (!insertedHistoryRows || insertedHistoryRows.length === 0) {
            console.error('لم يُحفظ سجل أرشيف إنهاء الربط فعلياً رغم عدم ظهور أي خطأ — تحقق من سياسة الإضافة (RLS INSERT Policy) على جدول employee_link_history.');
            alert('⚠️ تم إنهاء ربط الموظف بنجاح، لكن لم يُحفظ سجل أرشيفي لبياناته فعلياً. غالباً السبب عدم وجود سياسة إضافة (RLS INSERT Policy) على جدول employee_link_history في سوبابيس. بدون هذا الأرشيف، لن يظهر اسم الموظف لاحقاً في المهام المُسندة إليه سابقاً.');
        } else if (procedureColumnsMissing) {
            alert('⚠️ تم إنهاء الربط وحفظ الأرشيف، لكن لم تُحفظ حالة الإجراءات (مكتمل/غير مكتمل) لأن أعمدتها غير موجودة بعد في قاعدة البيانات. نفّذ سكربت employee_link_history_procedure_status.sql في Supabase (SQL Editor) ثم حدّد الحالة لهذا الموظف من زر "حالة الإجراءات" بجدول السجل.');
        }

        // 3) تحديث حالة الموظف تلقائياً إلى "غير نشط"
        const { error: statusError } = await dbClient
            .from('employees')
            .update({ status: 'inactive' })
            .eq('id', parseInt(employeeId, 10));

        if (statusError) {
            console.error('تعذّر تحديث حالة الموظف بعد إنهاء الربط:', statusError.message);
        }

        // 4) إن كان نوع ربطه "اضافة": إنشاء سجلات تحصيل الأشهر التي لم تُسجَّل
        //    بعد (من تاريخ الربط حتى تاريخ الإنهاء) تلقائياً — بلا المساس بأي
        //    سجل تحصيل محفوظ مسبقاً
        await ensureCollectionRecordsForEndedLink(link, endDate);

        closeEndLinkModal();
        await fetchAndRenderEndLinkTable();
        await fetchAndRenderHistoryTable();
        await fetchAndRenderExpiredContractsTable();

    } catch (error) {
        console.error('End Employee Link Error:', error);
        showEndLinkModalAlert('فشلت العملية: ' + error.message, 'error');
    } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = originalText;
    }
}
