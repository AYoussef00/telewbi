// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================
const SUPABASE_URL = "https://mcdhxdfkuokhmhtfvjev.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_yt9V8lsNU1zN3Ix2CvovbQ_QCA2VDdM";
const dbClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 🏢 بيانات "بصمة الأعمال" الثابتة كبائع (المُصدر) في كل فاتورة — مطابقة
// تماماً لبيانات الفاتورة الضريبية الرسمية المعتمدة لدى الشركة
const INVOICE_SELLER_INFO = {
    name_ar: 'شركة بصمة الأعمال للاستشارات الادارية',
    name_en: 'Business Imprint for Administrative Consulting',
    vat_number: '314916466600003',
    cr_number: '7041103123',
    country_ar: 'المملكة العربية السعودية',
    country_en: 'Saudi Arabia',
    city: 'الرياض',
    district: 'اشبيلية',
    street: 'الصحابة',
    building_number: '7076',
    additional_number: '7076',
    postal_code: '13225',
    // اسم الحساب البنكي المعروض بأسفل الفاتورة (طُلب صراحةً استخدام "شركة" بدل "مؤسسة")
    bank_account_name: 'شركة بصمة الأعمال للاستشارات الإدارية',
    bank_account_number: '24800000836806',
    bank_iban: 'SA8110000024800000836806',
    bank_name: 'بنك الاهلي السعودي',
    logo_url: 'logo.png'
};

const INVOICE_STATUS_LABELS_AR = { unpaid: 'غير مدفوعة', paid: 'مدفوعة', overdue: 'متأخرة' };

// 🏷️ عنوان نوع الفاتورة يُبنى ديناميكياً من نوع عقد الشركة (company.contract_type)
// بدلاً من عنوان ثابت "فاتورة مبيعات ضريبية" — القيم الممكنة لنوع العقد بشاشة
// إضافة/تعديل الشركة هي بالضبط: "إضافة"، "إستضافة"، "إستضافة/إضافة".
function getInvoiceTypeTitle(contractType) {
    const type = (contractType || '').trim();
    if (type === 'إضافة') return { ar: 'فاتورة إضافة', en: 'Addition Invoice' };
    if (type === 'إستضافة') return { ar: 'فاتورة استضافة', en: 'Hosting Invoice' };
    // "إستضافة/إضافة" أو أي قيمة غير معروفة/فارغة: نستخدم العنوان المزدوج كافتراضي آمن
    return { ar: 'فاتورة إضافة / استضافة', en: 'Addition / Hosting Invoice' };
}

// 💰 تنسيق القيم المالية بمنزلتين عشريتين بأرقام إنجليزية دائماً
function formatInvoiceCurrency(value) {
    const num = parseFloat(value);
    if (isNaN(num)) return '0.00';
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
}

// 📅 تنسيق تاريخ بصيغة DD/MM/YYYY
function formatInvoiceDate(dateStr) {
    if (!dateStr) return '—';
    const datePart = String(dateStr).split('T')[0];
    const parts = datePart.split('-');
    if (parts.length !== 3) return String(dateStr);
    const [y, m, d] = parts;
    return `${d}/${m}/${y}`;
}

function formatInvoiceDisplayNumber(invoiceRow) {
    if (!invoiceRow) return '—';
    const year = invoiceRow.invoice_date ? String(invoiceRow.invoice_date).slice(0, 4) : String(new Date().getFullYear());
    const seq = String(invoiceRow.id).padStart(6, '0');
    return `INV-${year}-${seq}`;
}

// =========================================================================
// 🧮 حساب إجماليات بند واحد (نفس منطق add_invoice.js تماماً لضمان تطابق الأرقام
// المعروضة بجدول البنود مع الإجماليات المحفوظة بالفاتورة)
// =========================================================================
function computeInvoiceLineTotals(item) {
    const unitPrice = parseFloat(item.unit_price) || 0;
    const quantity = parseFloat(item.quantity) || 0;
    const discountAmount = parseFloat(item.discount_amount) || 0;
    const vatRate = (item.vat_rate !== null && item.vat_rate !== undefined && item.vat_rate !== '')
        ? parseFloat(item.vat_rate)
        : 15;

    const grossAmount = unitPrice * quantity;
    const amountExclVat = Math.max(grossAmount - discountAmount, 0);
    const vatAmount = amountExclVat * (vatRate / 100);
    const amountInclVat = amountExclVat + vatAmount;

    return { amountExclVat, vatAmount, amountInclVat, vatRate, discountAmount };
}

// =========================================================================
// 🔤 تحويل الأرقام إلى كلمات عربية — "المبلغ كتابة"
// =========================================================================
const AR_WORDS_ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'];
const AR_WORDS_TEENS = ['عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const AR_WORDS_TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const AR_WORDS_HUNDREDS = ['', 'مائة', 'مئتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];
const AR_WORDS_SCALES = [
    null,
    { singular: 'ألف', dual: 'ألفان', plural: 'آلاف' },
    { singular: 'مليون', dual: 'مليونان', plural: 'ملايين' },
    { singular: 'مليار', dual: 'ملياران', plural: 'مليارات' }
];

function arWordsTwoDigits(n) {
    if (n === 0) return '';
    if (n < 10) return AR_WORDS_ONES[n];
    if (n < 20) return AR_WORDS_TEENS[n - 10];
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    if (ones === 0) return AR_WORDS_TENS[tens];
    return AR_WORDS_ONES[ones] + ' و' + AR_WORDS_TENS[tens];
}
function arWordsThreeDigits(n) {
    const h = Math.floor(n / 100);
    const rest = n % 100;
    const parts = [];
    if (h > 0) parts.push(AR_WORDS_HUNDREDS[h]);
    const restWords = arWordsTwoDigits(rest);
    if (restWords) parts.push(restWords);
    return parts.join(' و');
}
function arWordsScaleFor(count, scaleIndex) {
    const w = AR_WORDS_SCALES[scaleIndex];
    if (count === 1) return w.singular;
    if (count === 2) return w.dual;
    if (count >= 3 && count <= 10) return w.plural;
    return w.singular;
}
function integerToArabicWords(num) {
    if (num === 0) return 'صفر';
    const groups = [];
    let n = num;
    while (n > 0) { groups.push(n % 1000); n = Math.floor(n / 1000); }
    const parts = [];
    for (let i = groups.length - 1; i >= 0; i--) {
        const groupVal = groups[i];
        if (groupVal === 0) continue;
        if (i === 0) parts.push(arWordsThreeDigits(groupVal));
        else if (groupVal === 1) parts.push(arWordsScaleFor(1, i));
        else if (groupVal === 2) parts.push(arWordsScaleFor(2, i));
        else parts.push(arWordsThreeDigits(groupVal) + ' ' + arWordsScaleFor(groupVal, i));
    }
    return parts.join(' و');
}
function arWordsAmountWithUnit(intPart, singular, dual, pluralFew, accusative) {
    if (intPart === 1) return singular + ' واحد';
    if (intPart === 2) return dual;
    if (intPart >= 3 && intPart <= 10) return integerToArabicWords(intPart) + ' ' + pluralFew;
    return integerToArabicWords(intPart) + ' ' + accusative;
}
function numberToArabicCurrencyWords(amount) {
    const rounded = Math.round((amount || 0) * 100) / 100;
    const intPart = Math.floor(rounded);
    const decimalPart = Math.round((rounded - intPart) * 100);

    let result;
    if (intPart === 0 && decimalPart === 0) {
        result = 'صفر ريال سعودي';
    } else {
        result = intPart > 0
            ? arWordsAmountWithUnit(intPart, 'ريال سعودي', 'ريالان سعوديان', 'ريالات سعودية', 'ريالاً سعودياً')
            : '';
        if (decimalPart > 0) {
            const halalaWords = arWordsAmountWithUnit(decimalPart, 'هللة', 'هللتان', 'هللات', 'هللة');
            result = result ? (result + ' و' + halalaWords) : halalaWords;
        }
    }
    return result + ' فقط لا غير';
}

// =========================================================================
// 2. تحميل بيانات الفاتورة وبناء الورقة الكاملة
// =========================================================================
function getInvoiceIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('id');
}

document.addEventListener('DOMContentLoaded', async () => {
    const allowed = await Permissions.guardPage('finance_invoices');
    if (!allowed) return;

    const invoiceId = getInvoiceIdFromUrl();
    const statusEl = document.getElementById('invoiceLoadStatus');

    if (!invoiceId) {
        statusEl.textContent = 'لم يتم تحديد فاتورة صحيحة لعرضها.';
        return;
    }

    try {
        const { data: invoice, error } = await dbClient
            .from('invoices')
            .select('*, companies(*)')
            .eq('id', invoiceId)
            .maybeSingle();

        if (error) throw new Error(error.message);
        if (!invoice) {
            statusEl.textContent = 'لم يتم العثور على هذه الفاتورة. قد تكون قد حُذفت.';
            return;
        }

        statusEl.style.display = 'none';
        renderInvoiceSheet(invoice);
        bindInvoiceToolbar(invoice);

    } catch (error) {
        console.error('تعذّر تحميل بيانات الفاتورة:', error.message);
        statusEl.textContent = 'فشل تحميل بيانات الفاتورة: ' + error.message;
    }
});

function bindInvoiceToolbar(invoice) {
    document.getElementById('btnBackToInvoices').addEventListener('click', () => {
        window.location.href = 'invoices.html';
    });
    document.getElementById('btnPrintInvoice').addEventListener('click', () => {
        window.print();
    });

    const status = invoice.status || 'unpaid';
    const markPaidBtn = document.getElementById('btnMarkPaid');

    // 🛡️ إصلاح ثغرة: كان هذا الزر يُظهَر بناءً على حالة الفاتورة فقط (غير
    // مدفوعة) بمعزل تماماً عن صلاحية "edit:finance_invoices" — رغم أن الزر
    // يحمل data-perm بملف HTML، فإن تعيين style.display = '' هنا يدوياً كان
    // يتجاوز إخفاء CSS الافتراضي فيظهر الزر حتى لمسؤول الشركة (الممنوع صراحة
    // من تعديل الفواتير بملف permissions.js عبر COMPANY_ROLE_BLOCKED_WRITE_SECTIONS).
    // الإصلاح: لا نُظهر الزر أصلاً إلا لمن يملك الصلاحية فعلياً.
    const canMarkPaid = Permissions.can('edit', 'finance_invoices');

    if (status !== 'paid' && canMarkPaid) {
        markPaidBtn.style.display = '';
        markPaidBtn.addEventListener('click', async () => {
            // 🛡️ دفاع بعمق: تحقق إضافي وقت الضغط الفعلي، حتى لا يبقى أي مسار
            // لتنفيذ العملية لمن لا يملك الصلاحية (مثلاً عبر إعادة إظهار الزر
            // يدوياً من أدوات المطوّر بالمتصفح وتجاوز إخفاء الواجهة).
            if (!Permissions.can('edit', 'finance_invoices')) {
                alert('ليست لديك صلاحية تعليم الفواتير كمدفوعة.');
                return;
            }
            if (!confirm('هل تريد تعليم هذه الفاتورة كمدفوعة؟')) return;
            try {
                const { data: updatedRows, error } = await dbClient
                    .from('invoices')
                    .update({ status: 'paid' })
                    .eq('id', invoice.id)
                    .select();
                if (error) throw error;
                if (!updatedRows || updatedRows.length === 0) {
                    alert('لم يتم تحديث حالة الفاتورة فعلياً. تحقق من وجود سياسة تعديل (RLS UPDATE Policy) على جدول invoices في سوبابيس.');
                    return;
                }
                window.location.reload();
            } catch (error) {
                alert('فشلت العملية: ' + error.message);
            }
        });
    }
}

function renderInvoiceSheet(invoice) {
    const company = invoice.companies || {};
    const items = Array.isArray(invoice.items) ? invoice.items : [];
    const status = invoice.status || 'unpaid';

    const subtotal = invoice.subtotal != null ? parseFloat(invoice.subtotal) : 0;
    const discountTotal = invoice.discount_amount != null ? parseFloat(invoice.discount_amount) : 0;
    const vatTotal = invoice.vat_amount != null ? parseFloat(invoice.vat_amount) : 0;
    const grandTotal = invoice.total_amount != null ? parseFloat(invoice.total_amount) : 0;

    const invoiceDateDisplay = formatInvoiceDate(invoice.invoice_date);
    const invoiceNumberDisplay = formatInvoiceDisplayNumber(invoice);

    // 🏷️ عنوان الفاتورة حسب نوع عقد الشركة (إضافة / استضافة / إضافة و استضافة معاً)
    const typeTitle = getInvoiceTypeTitle(company.contract_type);

    const itemsRowsHtml = items.map((item, index) => {
        const t = computeInvoiceLineTotals(item);
        return `
            <tr>
                <td>${index + 1}</td>
                <td class="item-description-cell">${escapeHtml(item.description || '—')}</td>
                <td>${escapeHtml(item.unit || 'خدمة')}</td>
                <td>${formatInvoiceCurrency(item.unit_price)}</td>
                <td>${item.quantity != null ? item.quantity : 0}</td>
                <td>${formatInvoiceCurrency(t.discountAmount)}</td>
                <td>${formatInvoiceCurrency(t.amountExclVat)}</td>
                <td>${t.vatRate}%</td>
                <td>${formatInvoiceCurrency(t.vatAmount)}</td>
                <td>${formatInvoiceCurrency(t.amountInclVat)}</td>
            </tr>
        `;
    }).join('');

    const statusRibbonClass = status === 'paid' ? 'status-paid' : (status === 'overdue' ? 'status-overdue' : 'status-unpaid');
    const statusRibbonLabel = INVOICE_STATUS_LABELS_AR[status] || 'غير مدفوعة';

    const sheetHtml = `
        <div class="invoice-sheet">

            <span class="invoice-status-ribbon ${statusRibbonClass}">${statusRibbonLabel}</span>

            <!-- ===================== رأس الفاتورة ===================== -->
            <div class="invoice-header">
                <div class="invoice-header-qr">
                    <div class="invoice-title-en">${typeTitle.en}</div>
                    <div class="invoice-title-ar">${typeTitle.ar}</div>
                </div>
                <div class="invoice-header-logo">
                    <img src="logo.png" alt="شعار بصمة الأعمال" onerror="this.style.display='none'">
                    <div class="seller-name-ar">${INVOICE_SELLER_INFO.name_ar}</div>
                </div>
                <div class="invoice-header-seller">
                    <div><span class="seller-label">الرقم الضريبي: </span><span class="seller-value">${INVOICE_SELLER_INFO.vat_number}</span></div>
                    <div><span class="seller-label">سجل تجاري: </span><span class="seller-value">${INVOICE_SELLER_INFO.cr_number}</span></div>
                    <div><span class="seller-label">البلد: </span><span class="seller-value">${INVOICE_SELLER_INFO.country_ar}</span></div>
                    <div><span class="seller-label">المدينة: </span><span class="seller-value">${INVOICE_SELLER_INFO.city}</span></div>
                    <div><span class="seller-label">الحي: </span><span class="seller-value">${INVOICE_SELLER_INFO.district}</span></div>
                    <div><span class="seller-label">الشارع: </span><span class="seller-value">${INVOICE_SELLER_INFO.street}</span></div>
                    <div><span class="seller-label">رقم المبنى: </span><span class="seller-value">${INVOICE_SELLER_INFO.building_number}</span></div>
                    <div><span class="seller-label">الرقم الإضافي: </span><span class="seller-value">${INVOICE_SELLER_INFO.additional_number}</span></div>
                    <div><span class="seller-label">الرمز البريدي: </span><span class="seller-value">${INVOICE_SELLER_INFO.postal_code}</span></div>
                </div>
            </div>

            <!-- ===================== بيانات العميل ===================== -->
            <div class="invoice-client-section-title">بيانات العميل</div>
            <table class="invoice-meta-table">
                <thead>
                    <tr>
                        <th>رقم الفاتورة</th>
                        <th>تاريخ الفاتورة</th>
                        <th>طريقة الدفع</th>
                        <th>اسم العميل</th>
                        <th>السجل التجاري</th>
                        <th>الرقم الضريبي للعميل</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>${invoiceNumberDisplay}</td>
                        <td>${invoiceDateDisplay}</td>
                        <td>${escapeHtml(invoice.payment_method || 'أجل')}</td>
                        <td>${escapeHtml(company.name || '—')}</td>
                        <td>${escapeHtml(company.cr_number || '—')}</td>
                        <td>${escapeHtml(company.tax_number || '—')}</td>
                    </tr>
                </tbody>
            </table>
            <table class="invoice-client-table">
                <thead>
                    <tr>
                        <th>البلد</th>
                        <th>المدينة</th>
                        <th>العنوان الوطني</th>
                        <th>جوال العميل</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>المملكة العربية السعودية</td>
                        <td>${escapeHtml(company.city || '—')}</td>
                        <td>${escapeHtml(company.address || '—')}</td>
                        <td>${escapeHtml(company.phone || '—')}</td>
                    </tr>
                </tbody>
            </table>

            <!-- ===================== بنود الفاتورة ===================== -->
            <table class="invoice-items-print-table">
                <thead>
                    <tr>
                        <th>م</th>
                        <th>الصنف / الوصف</th>
                        <th>الوحدة</th>
                        <th>السعر</th>
                        <th>الكمية</th>
                        <th>مبلغ الخصم</th>
                        <th>الإجمالي غير شامل الضريبة</th>
                        <th>معدل الضريبة</th>
                        <th>قيمة الضريبة</th>
                        <th>الإجمالي شامل الضريبة</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemsRowsHtml || '<tr><td colspan="10" style="padding:16px; color:#94a3b8;">لا توجد بنود</td></tr>'}
                </tbody>
            </table>

            <!-- ===================== الملاحظة + المبلغ كتابة + صندوق الإجماليات ===================== -->
            <div class="invoice-footer-summary">
                <div class="invoice-footer-note">
                    <div class="thanks-note">*** نشكركم لزيارتكم ونتطلع لرؤيتكم مرة اخرى ***</div>
                    <div class="amount-words-label">المبلغ كتابة:</div>
                    <div>${numberToArabicCurrencyWords(grandTotal)}</div>
                    ${invoice.notes ? `<div style="margin-top:10px;"><strong>ملاحظات: </strong>${escapeHtml(invoice.notes)}</div>` : ''}
                </div>
                <div class="invoice-totals-summary-box">
                    <div class="totals-row"><span>الإجمالي قبل الضريبة</span><span class="totals-value">${formatInvoiceCurrency(subtotal)}</span></div>
                    <div class="totals-row"><span>الخصم</span><span class="totals-value">${formatInvoiceCurrency(discountTotal)}</span></div>
                    <div class="totals-row"><span>قيمة ضريبة القيمة المضافة</span><span class="totals-value">${formatInvoiceCurrency(vatTotal)}</span></div>
                    <div class="totals-row"><span>الإجمالي شامل الضريبة</span><span class="totals-value">${formatInvoiceCurrency(grandTotal)}</span></div>
                </div>
            </div>

            <!-- ===================== الحساب البنكي والتوقيعات ===================== -->
            <div class="invoice-bank-signature">
                <div class="invoice-bank-block">
                    <strong>اسم الحساب: ${INVOICE_SELLER_INFO.bank_account_name}</strong>
                    <div>رقم الحساب: ${INVOICE_SELLER_INFO.bank_account_number}</div>
                    <div>الآيبان: ${INVOICE_SELLER_INFO.bank_iban}</div>
                    <div>${INVOICE_SELLER_INFO.bank_name}</div>
                </div>
                <div class="invoice-signature-block">
                    <div class="sig-title">بصمة اعمال</div>
                    <div class="sig-line">البائع: ......................................</div>
                    <div class="sig-line">المستلم: ......................................</div>
                </div>
            </div>

        </div>
    `;

    document.getElementById('invoiceSheetRoot').innerHTML = sheetHtml;

    // 🛡️ العنصر الوحيد ذو الصلة داخل ورقة الفاتورة المُدرجة للتو ديناميكياً هو
    // زر "تعليم كمدفوعة" بشريط الأدوات العلوي (ثابت بالـHTML أصلاً ويحمل
    // data-perm بالفعل)؛ لا توجد أزرار إجراءات جديدة تحمل data-perm داخل
    // sheetHtml نفسها، فلا حاجة لتطبيق إضافي هنا على هذه الحاوية تحديداً.
}

// 🛡️ تفادي حقن HTML غير آمن من بيانات نصية قد تحتوي رموزاً خاصة (اسم شركة/ملاحظات...)
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
}