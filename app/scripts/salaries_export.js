// =========================================================================
// 💵 تصدير الرواتب: ملف Excel لموظفي شركة محددة (الاسم، رقم الهوية، تاريخ
// التعيين = تاريخ الربط، الراتب = 0) يُعبَّأ ثم يُستورد من "استيراد الرواتب".
// =========================================================================
let salExportCompanyCombo = null;
const SAL_EXPORT_HEADERS = ['اسم الموظف', 'رقم الهوية', 'تاريخ التعيين', 'الراتب'];

function salExportShowMsg(text, kind) {
    const el = document.getElementById('salExportMsg');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'salaries-msg' + (text ? ` show ${kind || 'info'}` : '');
}

document.addEventListener('DOMContentLoaded', async () => {
    const allowed = await Permissions.guardPage('salaries_export');
    if (!allowed) return;

    const monthInput = document.getElementById('salExportMonth');
    const exportBtn = document.getElementById('btnSalExport');
    const searchInput = document.getElementById('salExportCompanySearch');
    monthInput.value = EmployeeSalaries.currentMonthValue();

    const refreshBtn = () => { exportBtn.disabled = !(salExportCompanyCombo.getValue() && monthInput.value); };
    salExportCompanyCombo = EmployeeSalaries.createSearchableCombobox({
        inputId: 'salExportCompanySearch',
        hiddenId: 'salExportCompany',
        dropdownId: 'salExportCompanyDropdown',
        emptyText: 'لا توجد شركات مطابقة',
        onChange: refreshBtn
    });

    try {
        const companies = await EmployeeSalaries.fetchCompanies();
        salExportCompanyCombo.setOptions(companies.map(c => ({ value: String(c.id), label: c.name || `شركة #${c.id}` })));
        salExportCompanyCombo.enable('اكتب اسم الشركة للبحث أو اختر من القائمة...');
    } catch (error) {
        searchInput.placeholder = 'تعذّر تحميل الشركات';
        salExportShowMsg('تعذّر تحميل الشركات: ' + error.message, 'err');
        return;
    }

    monthInput.addEventListener('change', refreshBtn);
    exportBtn.addEventListener('click', exportSalariesTemplate);
});

async function exportSalariesTemplate() {
    const monthValue = document.getElementById('salExportMonth').value;
    const exportBtn = document.getElementById('btnSalExport');
    const companyId = salExportCompanyCombo.getValue();
    if (!companyId || !monthValue) return;
    const companyName = salExportCompanyCombo.getLabel();

    exportBtn.disabled = true;
    salExportShowMsg('جاري تجهيز الملف...', 'info');
    try {
        const links = await EmployeeSalaries.fetchCompanyLinksForMonth(companyId, monthValue, { includeArchived: true });
        if (links.length === 0) {
            salExportShowMsg('لا يوجد موظفو «إضافة» مرتبطون بهذه الشركة خلال الشهر المختار.', 'err');
            return;
        }

        const rows = links
            .map(l => ({
                name: (l.employees && l.employees.name) || '',
                nationalId: (l.employees && l.employees.national_id) || '',
                hireDate: EmployeeSalaries.formatDateDMY(l.link_date)
            }))
            .sort((a, b) => a.name.localeCompare(b.name, 'ar'));

        const ws = XLSX.utils.aoa_to_sheet([SAL_EXPORT_HEADERS]);
        rows.forEach((r, i) => {
            const rowIdx = i + 1;
            // رقم الهوية والتاريخ كنص حتى لا يحوّلهما Excel إلى أرقام/تواريخ
            ws[XLSX.utils.encode_cell({ r: rowIdx, c: 0 })] = { t: 's', v: r.name };
            ws[XLSX.utils.encode_cell({ r: rowIdx, c: 1 })] = { t: 's', v: String(r.nationalId) };
            ws[XLSX.utils.encode_cell({ r: rowIdx, c: 2 })] = { t: 's', v: r.hireDate };
            ws[XLSX.utils.encode_cell({ r: rowIdx, c: 3 })] = { t: 'n', v: 0, z: '#,##0.00' };
        });
        ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: 3 } });
        ws['!cols'] = [{ wch: 28 }, { wch: 16 }, { wch: 16 }, { wch: 14 }];

        const wb = XLSX.utils.book_new();
        wb.Workbook = { Views: [{ RTL: true }] };
        XLSX.utils.book_append_sheet(wb, ws, 'الرواتب');

        const safeCompany = companyName.replace(/[\\/:*?"<>|]/g, '-').trim();
        XLSX.writeFile(wb, `الرواتب_${safeCompany}_${monthValue}.xlsx`);
        const endedCount = links.filter(l => l.link_end_date && String(l.link_end_date).split('T')[0] < new Date().toISOString().slice(0, 10)).length;
        salExportShowMsg(`تم تصدير ${rows.length} موظف${endedCount ? ` (منهم ${endedCount} انتهى ربطه)` : ''}. عبّئ عمود «الراتب» ثم استورد الملف.`, 'ok');
    } catch (error) {
        console.error('تعذّر تصدير الرواتب:', error.message);
        salExportShowMsg('تعذّر تصدير الملف: ' + error.message, 'err');
    } finally {
        exportBtn.disabled = !(salExportCompanyCombo.getValue() && document.getElementById('salExportMonth').value);
    }
}
