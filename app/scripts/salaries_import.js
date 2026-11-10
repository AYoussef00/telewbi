// =========================================================================
// 💵 استيراد الرواتب: يقرأ ملف Excel/CSV (أعمدة: اسم الموظف، رقم الهوية،
// تاريخ التعيين، الراتب)، يطابق الصفوف برقم الهوية مع موظفي «الإضافة» بالشركة
// والشهر المختارين، يعرض معاينة، ثم يحفظ الرواتب بجدول employee_salaries
// (تُستبدل قيمة نفس الموظف/الشهر لو استُوردت سابقاً). الرصيد بشاشة التحصيل =
// هذا الراتب، وإن لم يُستورد شيء فالراتب الأساسي من الربط.
// =========================================================================
const SAL_ID_HEADER = 'رقم الهوية';
const SAL_SALARY_HEADER = 'الراتب';

let salParsedRows = [];      // [{ name, nationalId, salary: {value|empty|invalid} }]
let salPreviewItems = [];    // نتيجة المطابقة الحالية
let salLinksCache = { key: null, byNationalId: new Map() };

function salShowMsg(text, kind) {
    const el = document.getElementById('salImportMsg');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'salaries-msg' + (text ? ` show ${kind || 'info'}` : '');
}

function salNormHeader(v) {
    return String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
}

document.addEventListener('DOMContentLoaded', async () => {
    const allowed = await Permissions.guardPage('salaries_import');
    if (!allowed) return;

    const monthInput = document.getElementById('salImportMonth');
    const searchInput = document.getElementById('salImportCompanySearch');
    monthInput.value = EmployeeSalaries.currentMonthValue();

    const companyCombo = EmployeeSalaries.createSearchableCombobox({
        inputId: 'salImportCompanySearch',
        hiddenId: 'salImportCompany',
        dropdownId: 'salImportCompanyDropdown',
        emptyText: 'لا توجد شركات مطابقة',
        onChange: rebuildSalPreview
    });

    try {
        const companies = await EmployeeSalaries.fetchCompanies();
        companyCombo.setOptions(companies.map(c => ({ value: String(c.id), label: c.name || `شركة #${c.id}` })));
        companyCombo.enable('اكتب اسم الشركة للبحث أو اختر من القائمة...');
    } catch (error) {
        searchInput.placeholder = 'تعذّر تحميل الشركات';
        salShowMsg('تعذّر تحميل الشركات: ' + error.message, 'err');
        return;
    }

    document.getElementById('salImportFile').addEventListener('change', handleSalFileChosen);
    monthInput.addEventListener('change', rebuildSalPreview);
    document.getElementById('salIgnoreZero').addEventListener('change', rebuildSalPreview);
    document.getElementById('btnSalImport').addEventListener('click', runSalImport);
});

// ---------------------------------------------------------------------
// قراءة الملف
// ---------------------------------------------------------------------
function handleSalFileChosen(event) {
    const file = event.target.files && event.target.files[0];
    salParsedRows = [];
    if (!file) { rebuildSalPreview(); return; }

    const reader = new FileReader();
    reader.onerror = () => salShowMsg('تعذّرت قراءة الملف.', 'err');
    reader.onload = (e) => {
        try {
            const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
            const sheet = wb.Sheets[wb.SheetNames[0]];
            const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });

            // أول صف يحوي عنواني "رقم الهوية" و"الراتب" هو صف العناوين
            let headerRowIdx = -1, idCol = -1, salaryCol = -1, nameCol = -1;
            for (let i = 0; i < Math.min(matrix.length, 15); i++) {
                const cells = matrix[i].map(salNormHeader);
                const iId = cells.indexOf(SAL_ID_HEADER);
                const iSal = cells.indexOf(SAL_SALARY_HEADER);
                if (iId !== -1 && iSal !== -1) {
                    headerRowIdx = i; idCol = iId; salaryCol = iSal;
                    nameCol = cells.indexOf('اسم الموظف');
                    break;
                }
            }
            if (headerRowIdx === -1) {
                salShowMsg(`لم أجد عمودَي «${SAL_ID_HEADER}» و«${SAL_SALARY_HEADER}» في الملف. استخدم الملف المصدَّر من «تصدير الرواتب» دون تغيير عناوينه.`, 'err');
                rebuildSalPreview();
                return;
            }

            for (let i = headerRowIdx + 1; i < matrix.length; i++) {
                const row = matrix[i];
                const nationalId = EmployeeSalaries.normalizeNationalId(row[idCol]);
                if (!nationalId) continue; // صف فارغ/إجمالي بلا هوية
                salParsedRows.push({
                    name: nameCol !== -1 ? String(row[nameCol] == null ? '' : row[nameCol]) : '',
                    nationalId,
                    salary: EmployeeSalaries.parseSalaryCell(row[salaryCol])
                });
            }
            if (salParsedRows.length === 0) {
                salShowMsg('الملف لا يحتوي على أي صف بيانات (أرقام هوية).', 'err');
            } else {
                salShowMsg('', '');
            }
            rebuildSalPreview();
        } catch (err) {
            console.error('تعذّر تحليل الملف:', err.message);
            salShowMsg('تعذّر تحليل الملف: تأكد أنه ملف Excel أو CSV صالح.', 'err');
        }
    };
    reader.readAsArrayBuffer(file);
}

// ---------------------------------------------------------------------
// المطابقة والمعاينة
// ---------------------------------------------------------------------
async function loadSalLinks(companyId, monthValue) {
    const key = `${companyId}|${monthValue}`;
    if (salLinksCache.key === key) return salLinksCache.byNationalId;
    const links = await EmployeeSalaries.fetchCompanyLinksForMonth(companyId, monthValue);
    const byNationalId = new Map();
    links.forEach(l => {
        const nid = EmployeeSalaries.normalizeNationalId(l.employees && l.employees.national_id);
        if (!nid) return;
        const prev = byNationalId.get(nid);
        // لو تكرر الموظف بأكثر من ربط بالشهر نفسه: الأحدث تاريخ ربط
        if (!prev || String(l.link_date || '') > String(prev.link_date || '')) byNationalId.set(nid, l);
    });
    salLinksCache = { key, byNationalId };
    return byNationalId;
}

async function rebuildSalPreview() {
    const card = document.getElementById('salPreviewCard');
    const importBtn = document.getElementById('btnSalImport');
    const companyId = document.getElementById('salImportCompany').value;
    const monthValue = document.getElementById('salImportMonth').value;
    salPreviewItems = [];
    importBtn.disabled = true;

    if (salParsedRows.length === 0) { card.style.display = 'none'; return; }
    if (!companyId || !monthValue) {
        card.style.display = 'none';
        salShowMsg('اختر الشركة والشهر لعرض معاينة الملف.', 'info');
        return;
    }

    try {
        const byNationalId = await loadSalLinks(companyId, monthValue);
        const ignoreZero = document.getElementById('salIgnoreZero').checked;

        salPreviewItems = salParsedRows.map(r => {
            const link = byNationalId.get(r.nationalId);
            const item = { ...r, link, status: 'ok', label: 'سيُستورد' };
            item.displayName = (link && link.employees && link.employees.name) || r.name || '';

            if (!link) { item.status = 'bad'; item.label = 'غير موجود بالشركة/الشهر المختار'; }
            else if (r.salary.invalid) { item.status = 'bad'; item.label = 'راتب غير صالح'; }
            else if (r.salary.empty) { item.status = 'skip'; item.label = 'راتب فارغ — يُتجاهل'; }
            else if (ignoreZero && r.salary.value === 0) { item.status = 'skip'; item.label = 'راتب 0 — يُتجاهل'; }
            return item;
        });

        // نفس الموظف بأكثر من صف صالح بالملف: يُعتمد آخر صف صالح فقط
        const lastOkIndexById = new Map();
        salPreviewItems.forEach((it, i) => { if (it.status === 'ok') lastOkIndexById.set(it.nationalId, i); });
        salPreviewItems.forEach((it, i) => {
            if (it.status === 'ok' && lastOkIndexById.get(it.nationalId) !== i) {
                it.status = 'skip'; it.label = 'مكرر (يُعتمد آخر صف صالح)';
            }
        });

        renderSalPreview();
        salShowMsg('', '');
        importBtn.disabled = !salPreviewItems.some(it => it.status === 'ok');
    } catch (error) {
        console.error('تعذّر بناء المعاينة:', error.message);
        card.style.display = 'none';
        salShowMsg('تعذّر جلب موظفي الشركة: ' + error.message, 'err');
    }
}

function renderSalPreview() {
    const card = document.getElementById('salPreviewCard');
    const body = document.getElementById('salPreviewBody');
    const summary = document.getElementById('salPreviewSummary');
    card.style.display = 'block';

    const count = (s) => salPreviewItems.filter(i => i.status === s).length;
    summary.innerHTML = '';
    [
        { text: `إجمالي الصفوف: ${salPreviewItems.length}`, cls: '' },
        { text: `ستُستورد: ${count('ok')}`, cls: 'ok' },
        { text: `متجاهَلة: ${count('skip')}`, cls: 'warn' },
        { text: `بها خطأ: ${count('bad')}`, cls: 'bad' }
    ].forEach(c => {
        const chip = document.createElement('span');
        chip.className = 'salaries-chip ' + c.cls;
        chip.textContent = c.text;
        summary.appendChild(chip);
    });

    body.innerHTML = '';
    salPreviewItems.forEach(it => {
        const tr = document.createElement('tr');
        const cells = [
            it.displayName || '—',
            it.nationalId,
            it.salary.empty ? '—' : (it.salary.invalid ? 'غير صالح' : it.salary.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })),
            it.label
        ];
        cells.forEach((text, idx) => {
            const td = document.createElement('td');
            td.textContent = text; // textContent: لا يُفسَّر محتوى الملف كـ HTML أبداً
            if (idx >= 2) td.style.textAlign = 'center';
            if (idx === 3) td.className = it.status === 'ok' ? 'sal-status-ok' : (it.status === 'bad' ? 'sal-status-bad' : 'sal-status-warn');
            tr.appendChild(td);
        });
        body.appendChild(tr);
    });
}

// ---------------------------------------------------------------------
// الحفظ
// ---------------------------------------------------------------------
async function runSalImport() {
    const importBtn = document.getElementById('btnSalImport');
    const monthValue = document.getElementById('salImportMonth').value;
    const toImport = salPreviewItems.filter(it => it.status === 'ok');
    if (toImport.length === 0 || !monthValue) return;

    importBtn.disabled = true;
    salShowMsg('جاري استيراد الرواتب...', 'info');
    try {
        const nowIso = new Date().toISOString();
        const payload = toImport.map(it => ({
            employee_link_id: it.link.id,
            salary_month: `${monthValue}-01`,
            salary_amount: it.salary.value,
            updated_at: nowIso
        }));
        const CHUNK = 500;
        for (let i = 0; i < payload.length; i += CHUNK) {
            const { error } = await dbClient.from('employee_salaries')
                .upsert(payload.slice(i, i + CHUNK), { onConflict: 'employee_link_id,salary_month' });
            if (error) throw new Error(error.message);
        }
        salShowMsg(`تم استيراد رواتب ${payload.length} موظف للشهر ${monthValue}. تظهر الآن في عمود «الرصيد» بتحصيل الموظفين.`, 'ok');
    } catch (error) {
        console.error('تعذّر استيراد الرواتب:', error.message);
        salShowMsg('تعذّر الاستيراد: ' + error.message + ' — تأكد من تنفيذ سكربت employee_salaries_setup.sql.', 'err');
        importBtn.disabled = false;
    }
}
