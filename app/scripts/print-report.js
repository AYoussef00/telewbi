// =========================================================================
// وحدة مشتركة لبناء "صفحات طباعة" احترافية بنفس تصميم النموذج المرجعي
// (ترويسة شركة + رمز QR + رقم مستند + جدول بترويسة زرقاء + علامة مائية
// متكررة + تذييل بكل صفحة) — تُستخدم في عدة أماكن:
//  1) attendance-report.js عند الضغط على "طباعة" (تبني الصفحات وتستدعي window.print)
//  2) tasks-report.js عند الضغط على "طباعة" (نفس الفكرة لتقرير المهام)
//  3) companies-report.js عند الضغط على "طباعة" (نفس الفكرة لتقرير الشركات)
//  4) view_report.js (الصفحة العامة التي يفتحها رمز QR لعرض أي من التقارير)
// بهذا الشكل يبقى التصميم متطابقاً تماماً بين الطباعة المحلية وصفحة العرض
// العامة، دون تكرار الكود في مكانين.
// =========================================================================

const REPORT_PRINT_ROWS_PER_PAGE = 24; // لا يزال يُستخدم فقط بتقرير الحضور الثابت الأعمدة (buildAttendanceReportPrintPagesHtml) أدناه

// ⚠️ هذان الثابتان أصبحا اختياريَّين فقط منذ اعتماد التقسيم بالقياس الفعلي
// (packRowsIntoPrintPages أدناه) بدل عدد صفوف ثابت مخمَّن — buildGenericReportPrintPagesHtml
// (تقارير المهام/الشركات/الموظفين) يملأ كل صفحة تلقائياً بأقصى عدد صفوف
// يسعها ارتفاعها الفعلي دون أي تخمين مسبق، فلم تعد هناك حاجة لتمرير رقم
// ثابت. أُبقي عليهما مُصدَّرين هنا فقط للتوافق الخلفي مع أي استدعاء قديم قد
// يمرّرهما صراحة كسقف أقصى اختياري (rowsPerPage بـbuildGenericReportPrintPagesHtml).
const TASKS_REPORT_ROWS_PER_PAGE = 12;
const COMPANIES_REPORT_ROWS_PER_PAGE = 16;

function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// =========================================================================
// توليد رقم مستند قصير (8 خانات Hex كبيرة)، بنفس شكل النموذج المرجعي (مثال: 3ABCE96B)
// =========================================================================
function generateReportDocNumber() {
    try {
        return crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    } catch (e) {
        return Math.random().toString(16).slice(2, 10).toUpperCase();
    }
}

// تنسيق التاريخ بصيغة DD-MM-YYYY (نفس صيغة "تاريخ التقرير" بالنموذج المرجعي)
function formatDateDDMMYYYY(d) {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
}

// =========================================================================
// توليد رمز QR كصورة (Data URL) عبر مكتبة qrcode.js — تُستدعى فقط من صفحات
// الطباعة (attendance-report.html / tasks-report.html) التي تحمّل مكتبة
// QRCode؛ إن لم تكن المكتبة محمّلة (كما هو الحال بصفحة العرض العامة
// view_report.html) تُعاد null بأمان
// =========================================================================
async function generateReportQrDataUrl(text) {
    if (typeof QRCode === 'undefined') return null;
    try {
        return await QRCode.toDataURL(text, {
            width: 160,
            margin: 1,
            color: { dark: '#1e293b', light: '#ffffff' }
        });
    } catch (error) {
        console.error('تعذّر توليد رمز QR:', error.message);
        return null;
    }
}

// =========================================================================
// بناء صورة العلامة المائية المتكررة "بصمة الأعمال" كنمط SVG مُرمّز (Data URI)
// يُستخدم كخلفية متكررة (background-repeat) خلف كل صفحة طباعة
// =========================================================================
function buildWatermarkDataUri() {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="220">
  <text x="6" y="130" font-size="24" font-family="Cairo, Tahoma, sans-serif" fill="rgba(120,120,120,0.16)" transform="rotate(-28 150 110)">بصمة الأعمال</text>
</svg>`;
    const base64 = btoa(unescape(encodeURIComponent(svg)));
    return `data:image/svg+xml;base64,${base64}`;
}

// =========================================================================
// ترويسة الصفحة الأولى فقط: يمين = تاريخ التقرير + رقم المستند،
// وسط = اسم الشركة (أو "بصمة الأعمال" حين لا يوجد فلترة على شركة واحدة) +
// عنوان التقرير، يسار = رمز QR (إن توفر)
// =========================================================================
function buildLetterheadHtml({ docNumber, companyLabel, subtitleText, reportDateText, qrDataUrl }) {
    return `
        <div class="print-letterhead">
            <div class="letterhead-meta">
                <p>تاريخ التقرير: ${escapeHtml(reportDateText)}</p>
                <p>رقم المستند: ${escapeHtml(docNumber)}</p>
            </div>
            <div class="letterhead-brand">
                <h1>${escapeHtml(companyLabel)}</h1>
                <p>${escapeHtml(subtitleText)}</p>
            </div>
            ${qrDataUrl
                ? `<div class="letterhead-qr"><img src="${qrDataUrl}" alt="رمز QR لعرض التقرير"></div>`
                : `<div class="letterhead-qr-placeholder"></div>`
            }
        </div>`;
}

function buildHeaderRowHtml(showCompanyColumn) {
    const cells = ['<th class="col-name">الموظف</th>'];
    if (showCompanyColumn) cells.push('<th class="col-center">الشركة</th>');
    cells.push(
        '<th class="col-center">التاريخ</th>',
        '<th class="col-center">الحالة</th>',
        '<th class="col-center">دخول</th>',
        '<th class="col-center">خروج</th>',
        '<th class="col-center">ساعات العمل</th>'
    );
    return cells.join('');
}

function buildRowHtml(row, showCompanyColumn) {
    const cells = [`<td class="col-name">${escapeHtml(row.employee_name)}</td>`];
    if (showCompanyColumn) cells.push(`<td class="col-center">${escapeHtml(row.company_name)}</td>`);

    const hoursDisplay = (row.hours === null || row.hours === undefined || row.hours === '')
        ? '—'
        : Number(row.hours).toFixed(2);

    cells.push(
        `<td class="col-center">${escapeHtml(row.date)}</td>`,
        `<td class="col-center">${escapeHtml(row.status)}</td>`,
        `<td class="col-center">${escapeHtml(row.check_in || '—')}</td>`,
        `<td class="col-center">${escapeHtml(row.check_out || '—')}</td>`,
        `<td class="col-center">${hoursDisplay}</td>`
    );
    return `<tr>${cells.join('')}</tr>`;
}

// =========================================================================
// الدالة الرئيسية (تقرير الحضور والانصراف تحديداً — أعمدة ثابتة): تبني كامل
// صفحات الطباعة (مقسّمة تلقائياً كل REPORT_PRINT_ROWS_PER_PAGE صفاً في صفحة
// A4 مستقلة)، بحيث تظهر الترويسة الكبيرة (الشركة/QR/رقم المستند) بالصفحة
// الأولى فقط. ⚠️ لا تُعدَّل أعمدة هذه الدالة (مستخدَمة أيضاً بصفحة العرض
// العامة view_report.html لعرض لقطات تقرير حضور قديمة محفوظة بجدول
// report_snapshots بنفس الشكل بالضبط) — لتقارير بأعمدة مختلفة استخدم
// buildGenericReportPrintPagesHtml أدناه بدلاً من تعديل هذه الدالة.
//
// 🆕 بناءً على طلب المستخدم صراحة: هذه الدالة (تقرير الحضور والانصراف
// تحديداً) لم تعد تعرض لا العلامة المائية المتكررة "بصمة الأعمال" ولا عبارة
// "هذه الخدمة مقدمة من بصمة الأعمال" أسفل كل صفحة — يبقى فقط "صفحة X من Y".
// هذه الدالة مستخدَمة حصراً لتقرير الحضور والانصراف (محلياً وعبر رمز QR)،
// فالإزالة هنا لا تؤثر على أي تقرير آخر.
// =========================================================================
function buildAttendanceReportPrintPagesHtml(opts) {
    const {
        docNumber,
        companyLabel,
        subtitleText = 'تقرير الحضور والانصراف',
        reportDateText,
        showCompanyColumn,
        rows = [],
        qrDataUrl
    } = opts;

    const chunks = [];
    for (let i = 0; i < rows.length; i += REPORT_PRINT_ROWS_PER_PAGE) {
        chunks.push(rows.slice(i, i + REPORT_PRINT_ROWS_PER_PAGE));
    }
    if (chunks.length === 0) chunks.push([]);
    const totalPages = chunks.length;
    const emptyColspan = showCompanyColumn ? 7 : 6;

    return chunks.map((pageRows, idx) => `
        <section class="print-page">
            ${idx === 0 ? buildLetterheadHtml({ docNumber, companyLabel, subtitleText, reportDateText, qrDataUrl }) : ''}
            <table class="print-report-table">
                <thead><tr>${buildHeaderRowHtml(showCompanyColumn)}</tr></thead>
                <tbody>${
                    pageRows.length
                        ? pageRows.map(r => buildRowHtml(r, showCompanyColumn)).join('')
                        : `<tr><td colspan="${emptyColspan}" class="col-center" style="padding:24px;color:#94a3b8;">لا توجد سجلات</td></tr>`
                }</tbody>
            </table>
            <div class="print-footer">
                <span></span>
                <span>صفحة ${idx + 1} من ${totalPages}</span>
            </div>
        </section>
    `).join('');
}

// =========================================================================
// نسخة عامة (Generic) بأعمدة قابلة للتخصيص — تُستخدم لأي تقرير جديد لا
// يطابق شكل تقرير الحضور والانصراف الثابت أعلاه (مثال: تقرير المهام،
// تقرير الموظفين، تقرير الشركات). نفس الترويسة/العلامة المائية/التذييل
// بالضبط، لكن الأعمدة تُمرَّر ديناميكياً بدل أن تكون مكتوبة يدوياً.
//
// columns: مصفوفة عناصر { key, label, align } حيث align = 'right' (عمود
// اسم رئيسي، محاذاة يمين — نفس شكل عمود "الموظف" بتقرير الحضور) أو 'center'
// (بقية الأعمدة، محاذاة وسط). rows: مصفوفة كائنات عادية، كل مفتاح بها يطابق
// key أحد الأعمدة المُمرَّرة.
//
// 🆕 صف "إجمالي" اختياري: أي صف بمصفوفة rows يحمل المفتاح الإضافي
// __isTotalRow: true (بجانب مفاتيح الأعمدة العادية) يُعرَض بتنسيق مميّز
// (خط عريض + خط علوي فاصل + خلفية فاتحة) عبر buildGenericRowHtml أدناه —
// دون أي تأثير على الصفوف العادية بأي تقرير آخر لا يمرّر هذا المفتاح
// (توافق خلفي كامل: تقرير المهام/الموظفين/التحصيل... تستمر كما هي تماماً).
// يُستخدم هذا حالياً من companies-report.js لعرض إجمالي الاستضافة/الإضافة/
// عدد الموظفين أسفل تقرير الشركات المطبوع.
//
// 🆕 showBranding (اختياري، افتراضياً true): يتحكم معاً بإظهار/إخفاء
// العلامة المائية المتكررة "بصمة الأعمال" خلف الصفحة وعبارة "هذه الخدمة
// مقدمة من بصمة الأعمال" أسفلها (يبقى رقم الصفحة "صفحة X من Y" ظاهراً دوماً
// بغض النظر عن هذا الخيار). بناءً على طلب المستخدم صراحة، يُمرَّر false من
// tasks-report.js فقط (تقرير المهام) — بقية التقارير (الشركات/الموظفين/
// التحصيل) لا تمرّر هذا الخيار إطلاقاً فتبقى كما كانت تماماً (القيمة
// الافتراضية true، بلا أي تغيير في مظهرها).
// =========================================================================
function buildGenericHeaderRowHtml(columns) {
    return columns.map(col => `<th class="${col.align === 'right' ? 'col-name' : 'col-center'}">${escapeHtml(col.label)}</th>`).join('');
}

function buildGenericRowHtml(row, columns) {
    const isTotalRow = !!(row && row.__isTotalRow);
    const totalCellStyle = isTotalRow
        ? ' style="font-weight:800;border-top:2px solid #1e293b;background-color:#eef1f8;"'
        : '';
    const cells = columns.map(col => {
        const raw = row[col.key];
        const display = (raw === null || raw === undefined || raw === '') ? '—' : raw;
        // سطر ثانوي اختياري تحت القيمة الرئيسية (col.subKey): مثلاً اسم الشركة تحت اسم الموظف
        const subRaw = col.subKey ? row[col.subKey] : null;
        const subHtml = (subRaw !== null && subRaw !== undefined && subRaw !== '' && subRaw !== '----')
            ? `<div style="font-size:0.85em;font-weight:500;color:#64748b;margin-top:2px;">${escapeHtml(subRaw)}</div>`
            : '';
        return `<td class="${col.align === 'right' ? 'col-name' : 'col-center'}"${totalCellStyle}>${escapeHtml(display)}${subHtml}</td>`;
    });
    return `<tr>${cells.join('')}</tr>`;
}

// =========================================================================
// ⚠️ تقسيم الصفوف على الصفحات: بالقياس الفعلي بدل عدد صفوف ثابت
// -------------------------------------------------------------------------
// كان التقسيم سابقاً يعتمد على عدد أسطر ثابت لكل صفحة (rowsPerPage)، وهو
// تخمين يفشل بطريقتين متعاكستين حسب طول محتوى الأعمدة:
//  • رقم كبير جداً (كالافتراضي القديم 24) مع أعمدة نصية تلتف لعدة أسطر
//    (عنوان المهمة، اسم الشركة/البريد الإلكتروني...) يجعل ارتفاع الصفحة
//    الفعلي يفيض عن ارتفاع ورقة A4 الواحدة (.print-page { overflow: hidden }
//    يمنع تدفّق المحتوى الزائد لصفحة تالية أثناء الطباعة الفعلية، فتُقصّ/
//    تختفي الصفوف الأخيرة أسفل الصفحة).
//  • رقم صغير جداً (كالحلول المؤقتة السابقة الخاصة بكل تقرير على حدة) يترك
//    مساحة فارغة كبيرة أسفل كل صفحة حين تكون الصفوف قصيرة فعلياً (سطر واحد)،
//    فلا يُستغَل ارتفاع الصفحة كاملاً كما ينبغي.
//
// الحل: تُقاس كل صفحة فعلياً في عنصر DOM مخفي (بنفس فئة .print-page وأبعادها
// الحقيقية 210mm×290mm) قبل الطباعة — تُضاف الصفوف واحداً تلو الآخر ويُقاس
// الارتفاع الناتج فعلياً (getBoundingClientRect)، فتُملأ كل صفحة بأكبر عدد
// من الصفوف يسعها ارتفاعها الحقيقي (بصرف النظر عن التفاف النص من عدمه)، ثم
// تبدأ صفحة جديدة فور تجاوز الحد. هذا يضمن معاً: لا صفوف مخفية/مقصوصة أبداً،
// ولا مساحة مهدورة أسفل الصفحة حين يسمح المحتوى بمزيد من الصفوف.
// =========================================================================
function measurePrintPageNominalHeight() {
    const probe = document.createElement('section');
    probe.className = 'print-page';
    probe.style.visibility = 'hidden';
    probe.style.position = 'fixed';
    probe.style.top = '0';
    probe.style.insetInlineStart = '-99999px';
    probe.style.pointerEvents = 'none';
    document.body.appendChild(probe);
    const height = probe.getBoundingClientRect().height;
    document.body.removeChild(probe);
    return height;
}

function packRowsIntoPrintPages({ columns, rows, headerRowHtml, letterheadHtml, maxRowsPerPage }) {
    const nominalHeight = measurePrintPageNominalHeight();

    const probe = document.createElement('section');
    probe.className = 'print-page';
    probe.style.visibility = 'hidden';
    probe.style.position = 'fixed';
    probe.style.top = '0';
    probe.style.insetInlineStart = '-99999px';
    probe.style.pointerEvents = 'none';
    document.body.appendChild(probe);

    // ⚠️ إصلاح أداء حاسم: كانت هذه الدالة سابقاً تُعيد كتابة innerHTML بكامل
    // صفوف الصفحة المتراكمة حتى الآن مع كل صف جديد يُختبر — أي أن المتصفح
    // كان يُعيد تحليل (reparse) نص HTML كامل ومتزايد الطول من الصفر مع كل
    // صف، فتصبح التكلفة الكلية تربيعية O(n²) بعدد الصفوف (سريعة جداً مع
    // عشرات الصفوف، لكنها تصل لعدة ثوانٍ مع 500 صف، ودقائق مع بضعة آلاف —
    // وهو ما يجعل الطباعة تبدو "متجمدة/لا تعمل" مع تقارير بيانات كبيرة).
    // الحل: يُبنى هيكل الصفحة (الترويسة + الجدول + tbody فارغ) مرة واحدة
    // فقط عند بدء كل صفحة، ثم يُضاف كل صف جديد مباشرة كعنصر DOM منفصل عبر
    // insertAdjacentHTML('beforeend', ...) بدل إعادة كتابة كل شيء — فتصبح
    // التكلفة خطية O(n) بعدد الصفوف الإجمالي، بصرف النظر عن حجم التقرير.
    function startPageProbe(includeLetterhead) {
        probe.innerHTML = `
            ${includeLetterhead ? letterheadHtml : ''}
            <table class="print-report-table">
                <thead><tr>${headerRowHtml}</tr></thead>
                <tbody></tbody>
            </table>
        `;
        return probe.querySelector('tbody');
    }

    const pages = [];
    let rowIndex = 0;
    let isFirstPage = true;

    while (rowIndex < rows.length) {
        const pageRows = [];
        const tbody = startPageProbe(isFirstPage);

        while (rowIndex < rows.length) {
            if (maxRowsPerPage && pageRows.length >= maxRowsPerPage) break;

            tbody.insertAdjacentHTML('beforeend', buildGenericRowHtml(rows[rowIndex], columns));
            const height = probe.getBoundingClientRect().height;
            const wouldOverflow = height > nominalHeight;

            // لا نترك صفحة فارغة أبداً: أول صف يُقبل دوماً حتى لو تجاوز
            // وحده ارتفاع الصفحة (نص طويل جداً لا يمكن تقسيمه على صفحتين)
            if (wouldOverflow && pageRows.length > 0) {
                tbody.lastElementChild.remove(); // تراجع — سيُعاد اختباره كأول صف بالصفحة التالية
                break;
            }

            pageRows.push(rows[rowIndex]);
            rowIndex++;

            if (wouldOverflow) break; // الصف الوحيد بالصفحة تجاوز وحده الارتفاع — صفحة جديدة للتالي
        }

        pages.push(pageRows);
        isFirstPage = false;
    }

    document.body.removeChild(probe);
    return pages.length ? pages : [[]];
}

function buildGenericReportPrintPagesHtml(opts) {
    const {
        docNumber,
        companyLabel,
        subtitleText = 'تقرير',
        reportDateText,
        columns = [],
        rows = [],
        qrDataUrl,
        // اختياري: سقف أقصى لعدد الصفوف بالصفحة حتى لو اتسع ارتفاعها لأكثر
        // (نادراً ما يُحتاج له بعد اعتماد القياس الفعلي؛ أُبقي عليه للتوافق
        // الخلفي مع أي استدعاء قديم يمرّر rowsPerPage صراحة)
        rowsPerPage: maxRowsPerPage,
        // 🆕 اختياري (افتراضياً true): يتحكم بإظهار/إخفاء العلامة المائية
        // وعبارة "هذه الخدمة مقدمة من بصمة الأعمال" معاً — انظر الشرح أعلى الملف
        showBranding = true
    } = opts;

    const watermarkUrl = showBranding ? buildWatermarkDataUri() : null;
    const emptyColspan = columns.length || 1;
    const headerRowHtml = buildGenericHeaderRowHtml(columns);
    const letterheadHtml = buildLetterheadHtml({ docNumber, companyLabel, subtitleText, reportDateText, qrDataUrl });

    const pages = rows.length
        ? packRowsIntoPrintPages({ columns, rows, headerRowHtml, letterheadHtml, maxRowsPerPage })
        : [[]];
    const totalPages = pages.length;

    return pages.map((pageRows, idx) => `
        <section class="print-page">
            ${showBranding ? `<div class="print-watermark" style="background-image:url('${watermarkUrl}')"></div>` : ''}
            ${idx === 0 ? letterheadHtml : ''}
            <table class="print-report-table">
                <thead><tr>${headerRowHtml}</tr></thead>
                <tbody>${
                    pageRows.length
                        ? pageRows.map(r => buildGenericRowHtml(r, columns)).join('')
                        : `<tr><td colspan="${emptyColspan}" class="col-center" style="padding:24px;color:#94a3b8;">لا توجد سجلات</td></tr>`
                }</tbody>
            </table>
            <div class="print-footer">
                ${showBranding ? '<span>هذه الخدمة مقدمة من بصمة الأعمال</span>' : '<span></span>'}
                <span>صفحة ${idx + 1} من ${totalPages}</span>
            </div>
        </section>
    `).join('');
}

// إتاحة الدوال عالمياً لكل صفحات الطباعة (attendance-report.js / tasks-report.js /
// companies-report.js) وصفحة العرض العام (view_report.js)
window.PrintReport = {
    buildAttendanceReportPrintPagesHtml,
    buildGenericReportPrintPagesHtml,
    generateReportDocNumber,
    formatDateDDMMYYYY,
    generateReportQrDataUrl,
    TASKS_REPORT_ROWS_PER_PAGE,
    COMPANIES_REPORT_ROWS_PER_PAGE
};