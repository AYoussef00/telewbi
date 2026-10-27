// =========================================================================
// صفحة عامة (بدون تسجيل دخول) تعرض "لقطة" محفوظة من تقرير الحضور والانصراف
// أو تقرير المهام — تُفتح عبر مسح رمز QR المطبوع على ورقة التقرير
// (?id=<معرّف اللقطة>) وتقرأ بياناتها من جدول report_snapshots (سياسة قراءة
// عامة/anon مُفعّلة عليه) ثم تبنيها بنفس تصميم الطباعة تماماً عبر الوحدة
// المشتركة print-report.js.
//
// ⚠️ التمييز بين نوعي التقرير: عمود report_type بجدول report_snapshots
// (يُضاف عبر سكربت SQL منفصل — إن لم يكن موجوداً بعد يُعامَل الصف دائماً
// كتقرير حضور، وهو السلوك الافتراضي القديم قبل إضافة تقرير المهام، فيبقى
// عرض أي لقطة حضور قديمة يعمل تماماً كالسابق دون أي تغيير). لقطات تقرير
// المهام/الشركات الجديدة تُحفظ بـ report_type='tasks'/'companies' + عمود
// columns (تعريف الأعمدة المطلوب عرضها) فتُعرض عبر buildGenericReportPrintPagesHtml
// بدلاً من الدالة المخصصة لتقرير الحضور.
//
// ⚠️ عدد الصفوف بالصفحة: يُحسب تلقائياً بالقياس الفعلي داخل
// buildGenericReportPrintPagesHtml (نفس الآلية المستخدمة بالطباعة المحلية
// لكل من tasks-report.js وcompanies-report.js) — لا يُمرَّر هنا أي رقم ثابت
// عمداً، لضمان تطابق شكل صفحة العرض العامة هذه تماماً مع النسخة المطبوعة
// محلياً (كلتاهما تملآن كل صفحة لأقصى ما يسعها ارتفاعها الحقيقي).
//
// 🆕 العلامة المائية وعبارة "هذه الخدمة مقدمة من بصمة الأعمال": تقرير
// الحضور والانصراف لا يعرضهما إطلاقاً (buildAttendanceReportPrintPagesHtml
// نفسها لم تعد تعرضهما — انظر print-report.js)، وتقرير المهام تحديداً أيضاً
// لا يعرضهما هنا (report_type === 'tasks')، بينما بقية التقارير العامة
// (الشركات وغيرها) تستمر بعرضهما كالمعتاد.
// =========================================================================

document.addEventListener('DOMContentLoaded', async () => {
    const statusEl = document.getElementById('viewReportStatus');
    const root = document.getElementById('viewReportRoot');
    const printBtn = document.getElementById('btnPrintView');
    const toolbarTitle = document.getElementById('viewReportToolbarTitle');

    if (printBtn) printBtn.addEventListener('click', () => window.print());

    const params = new URLSearchParams(window.location.search);
    const snapshotId = params.get('id');

    if (!snapshotId) {
        statusEl.textContent = 'رابط غير صالح: لا يوجد معرّف تقرير ضمن الرابط.';
        return;
    }

    try {
        const { data, error } = await dbClient
            .from('report_snapshots')
            .select('*')
            .eq('id', snapshotId)
            .maybeSingle();

        if (error) throw error;

        if (!data) {
            statusEl.textContent = 'تعذّر العثور على هذا التقرير — تأكد من صحة الرابط.';
            return;
        }

        if (toolbarTitle) {
            toolbarTitle.textContent = `🕒 عرض ${data.report_title || 'تقرير الحضور والانصراف'} — بصمة الأعمال`;
        }

        const isGenericReport = data.report_type && data.report_type !== 'attendance' && Array.isArray(data.columns);

        root.innerHTML = isGenericReport
            ? window.PrintReport.buildGenericReportPrintPagesHtml({
                docNumber: data.doc_number || '—',
                companyLabel: data.company_name || 'بصمة الأعمال',
                subtitleText: data.report_title || 'تقرير',
                reportDateText: data.report_date_text || '',
                columns: data.columns,
                rows: data.rows || [],
                qrDataUrl: null, // لا حاجة لعرض رمز QR داخل الصفحة التي فتحها الرمز نفسه
                showBranding: data.report_type !== 'tasks', // تقرير المهام تحديداً بلا علامة مائية/عبارة تذييل
                showWatermark: data.report_type !== 'company_links' // تقرير ربط الشركات بلا علامة مائية
            })
            : window.PrintReport.buildAttendanceReportPrintPagesHtml({
                docNumber: data.doc_number || '—',
                companyLabel: data.company_name || 'بصمة الأعمال',
                subtitleText: data.report_title || 'تقرير الحضور والانصراف',
                reportDateText: data.report_date_text || '',
                showCompanyColumn: !!data.show_company_column,
                rows: data.rows || [],
                qrDataUrl: null
            });

        statusEl.style.display = 'none';

    } catch (error) {
        console.error('تعذّر تحميل بيانات التقرير:', error.message);
        statusEl.textContent = 'تعذّر تحميل بيانات التقرير: ' + error.message;
    }
});