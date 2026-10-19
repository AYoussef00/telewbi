// =========================================================================
// 🎨 مكتبة الأيقونات الموحّدة (Unified SVG Icon Library)
// =========================================================================
// كل الأيقونات هنا عبارة عن SVG داخلي مرسوم يدوياً بنفس الطراز الخطي
// (بلا تلوين، stroke="currentColor") بدلاً من رموز الإيموجي التعبيرية.
// السبب: كل نظام تشغيل (ماك/ويندوز/لينكس) يرسم الإيموجي بخط الإيموجي
// الخاص به فيظهر شكلاً مختلفاً تماماً بين الأجهزة؛ أما الـ SVG فيُرسم
// بواسطة المتصفح نفسه ويظهر متطابقاً 100% على كل الأجهزة وأنظمة التشغيل.
//
// طريقة الاستخدام:
// 1) في HTML الثابت: أضف السمة data-icon="اسم_الأيقونة" على عنصر <span>
//    فارغ (بديلاً عن كتابة الإيموجي مباشرة داخله)، وستُعبَّأ تلقائياً بعد
//    تحميل الصفحة عبر applyIconPlaceholders() التي تُستدعى تلقائياً عند
//    DOMContentLoaded. مثال:
//      <span class="menu-icon" data-icon="building"></span>
// 2) داخل أكواد JS التي تبني HTML ديناميكياً (Template Literals): الأسلوب
//    المُعتمَد الأحدث هو نفس أسلوب HTML الثابت — ضع data-icon="اسم_الأيقونة"
//    على العنصر مباشرة داخل النص المبني (بدل كتابة الإيموجي أو استدعاء
//    ${ICONS.xxx} مباشرة)، ثم استدعِ يدوياً بعد الحقن بالـ DOM:
//      applyIconPlaceholders(containerElement)
//    مثال: `<button data-icon="trash"></button>` ثم بعد tableBody.innerHTML=...
//    نادِ applyIconPlaceholders(tableBody).
// 3) إن أضفت عناصر [data-icon] جديدة بعد التحميل الأول (مثلاً عند إعادة
//    رسم صفوف جدول، أو حقن قالب Navbar/Sidebar ديناميكياً عبر fetch)، نادِ
//    يدوياً: applyIconPlaceholders(containerElement)
// =========================================================================

const ICONS = {
    // أشخاص / شركات
    building: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="11" height="18"/><rect x="15" y="9" width="5" height="12"/><line x1="7" y1="7" x2="9" y2="7"/><line x1="10" y1="7" x2="12" y2="7"/><line x1="7" y1="11" x2="9" y2="11"/><line x1="10" y1="11" x2="12" y2="11"/><line x1="7" y1="15" x2="9" y2="15"/><line x1="10" y1="15" x2="12" y2="15"/></svg>`,
    person: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.5"/><path d="M4.5 20c1-4 4-6 7.5-6s6.5 2 7.5 6"/></svg>`,
    people: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3"/><path d="M2.5 19.5c.8-3.4 3.2-5.2 6.5-5.2s5.7 1.8 6.5 5.2"/><circle cx="17" cy="9" r="2.4"/><path d="M15.5 14.6c2.6.3 4.3 1.9 5 4.9"/></svg>`,
    "id-card": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="1.8"/><circle cx="8.5" cy="11" r="2"/><path d="M5.5 16c.6-1.8 1.8-2.6 3-2.6s2.4.8 3 2.6"/><line x1="14" y1="9" x2="18.5" y2="9"/><line x1="14" y1="12" x2="18.5" y2="12"/></svg>`,
    crown: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8l3.5 3L12 6l4.5 5L20 8l-1.5 9h-13z"/></svg>`,
    "user-tie": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.2"/><path d="M5 20c1-4 3.8-6 7-6s6 2 7 6"/><path d="M12 11.5v3l1.3 1.8"/></svg>`,

    // إجراءات عامة
    edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l1-4.2L15.6 5.2a1.7 1.7 0 0 1 2.4 0l.8.8a1.7 1.7 0 0 1 0 2.4L8.2 19 4 20z"/><path d="M13.8 6.9l3.3 3.3"/></svg>`,
    trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 7V4.5h6V7"/><path d="M6 7l1 12.5A2 2 0 0 0 9 21h6a2 2 0 0 0 2-1.5L18 7"/><path d="M10 11v6M14 11v6"/></svg>`,
    eye: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/></svg>`,
    search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.5" cy="10.5" r="6.5"/><line x1="15.3" y1="15.3" x2="20" y2="20"/></svg>`,
    close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>`,
    refresh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11A8 8 0 0 0 6.3 6.3L4 8.5"/><path d="M4 4v4.5h4.5"/><path d="M4 13a8 8 0 0 0 13.7 4.7L20 15.5"/><path d="M20 20v-4.5h-4.5"/></svg>`,
    link: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1.5 1.5"/><path d="M14 10a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1.5-1.5"/></svg>`,
    unlink: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 14.5a3.5 3.5 0 0 0 5 0l1.3-1.3"/><path d="M14.5 9.5a3.5 3.5 0 0 0-5 0l-1.3 1.3"/><line x1="4" y1="4" x2="20" y2="20"/></svg>`,
    upload: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4M8 8l4-4 4 4"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/></svg>`,
    download: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M8 11l4 4 4-4"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>`,
    printer: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 8V3.5h10V8"/><rect x="4" y="8" width="16" height="8" rx="1.3"/><path d="M7 15.5h10V21H7z"/></svg>`,
    warning: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5 21.5 20h-19z"/><line x1="12" y1="9.5" x2="12" y2="14"/><circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none"/></svg>`,
    blocked: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><line x1="6" y1="18" x2="18" y2="6"/></svg>`,
    lightbulb: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 21h4"/><path d="M12 3a6.5 6.5 0 0 0-4 11.6c.7.6 1 1.4 1 2.4h6c0-1 .3-1.8 1-2.4A6.5 6.5 0 0 0 12 3Z"/></svg>`,
    "check-circle": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M8 12.3l2.5 2.5L16 9.3"/></svg>`,

    // مستندات وتصنيفات
    document: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><line x1="9.5" y1="12" x2="15" y2="12"/><line x1="9.5" y1="15.5" x2="15" y2="15.5"/></svg>`,
    clipboard: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4.5" width="12" height="16" rx="1.5"/><rect x="9" y="2.8" width="6" height="3" rx="1"/><line x1="8.5" y1="10" x2="15.5" y2="10"/><line x1="8.5" y1="13.5" x2="15.5" y2="13.5"/><line x1="8.5" y1="17" x2="13" y2="17"/></svg>`,
    paperclip: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M16.5 6.5l-7.8 7.8a3 3 0 0 0 4.2 4.2l8.3-8.3a5 5 0 0 0-7.1-7.1l-8.3 8.3a7 7 0 0 0 9.9 9.9"/></svg>`,
    tag: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 3.5H5v6.5L14 19l6.5-6.5z"/><circle cx="8.3" cy="7" r="1.1" fill="currentColor" stroke="none"/></svg>`,
    "tag-dot": `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="8" y="8" width="8" height="8" transform="rotate(45 12 12)"/></svg>`,
    "card-index": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7l2-3h5l2 3h9v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z"/><line x1="7" y1="12" x2="17" y2="12"/></svg>`,
    receipt: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18l-2-1.4L14 21l-2-1.4L10 21l-2-1.4L6 21z"/><line x1="8.5" y1="8" x2="15.5" y2="8"/><line x1="8.5" y1="11.5" x2="15.5" y2="11.5"/><line x1="8.5" y1="15" x2="13" y2="15"/></svg>`,
    bank: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9.5 12 4l9 5.5"/><line x1="4" y1="9.5" x2="20" y2="9.5"/><line x1="5.5" y1="9.5" x2="5.5" y2="18.5"/><line x1="9.5" y1="9.5" x2="9.5" y2="18.5"/><line x1="14.5" y1="9.5" x2="14.5" y2="18.5"/><line x1="18.5" y1="9.5" x2="18.5" y2="18.5"/><line x1="3.5" y1="18.5" x2="20.5" y2="18.5"/><line x1="3" y1="21" x2="21" y2="21"/></svg>`,
    home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11 12 4l8 7"/><path d="M6 9.5V20h12V9.5"/><rect x="10" y="13.5" width="4" height="6.5"/></svg>`,

    // وقت وتقويم
    clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.5l4 2.3"/></svg>`,
    calendar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="16" rx="1.5"/><line x1="3.5" y1="9.5" x2="20.5" y2="9.5"/><line x1="8" y1="3" x2="8" y2="6.5"/><line x1="16" y1="3" x2="16" y2="6.5"/></svg>`,
    hourglass: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12M6 21h12M7 3c0 5 4 6.5 5 9-1 2.5-5 4-5 9M17 3c0 5-4 6.5-5 9 1 2.5 5 4 5 9"/></svg>`,

    // رسوم بيانية ولوحة التحكم
    "chart-bar": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="20" x2="20" y2="20"/><rect x="6" y="13" width="3" height="7"/><rect x="11" y="9" width="3" height="11"/><rect x="16" y="5" width="3" height="15"/></svg>`,
    "chart-up": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="4,17 10,11 13,14 20,6"/><polyline points="14,6 20,6 20,12"/></svg>`,
    "chart-down": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="4,7 10,13 13,10 20,17"/><polyline points="14,17 20,17 20,11"/></svg>`,
    "chart-pie": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v9l6.5 6.5"/><path d="M21 12a9 9 0 1 1-9-9"/></svg>`,
    top: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8.5" r="5"/><path d="M9 12.8 7.5 21l4.5-2.5 4.5 2.5-1.5-8.2"/></svg>`,
    desktop: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="1.5"/><line x1="8" y1="20" x2="16" y2="20"/><line x1="12" y1="16" x2="12" y2="20"/></svg>`,
    bolt: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M13 2 4 14h6l-1 8 9-12h-6z"/></svg>`,

    // نظام / إعدادات / أمان
    gear: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 3v2.2M12 18.8V21M21 12h-2.2M5.2 12H3M18.4 5.6l-1.5 1.5M7.1 16.9l-1.5 1.5M18.4 18.4l-1.5-1.5M7.1 7.1L5.6 5.6"/></svg>`,
    shield: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.2 19 6v6c0 5-3 8.3-7 9.8-4-1.5-7-4.8-7-9.8V6z"/><path d="M9.2 12l2 2 3.6-4"/></svg>`,
    lock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10.5" width="14" height="10" rx="1.8"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg>`,
    key: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="14.5" r="3.5"/><path d="M10.5 12 18 4.5M16 6.5l2 2M13.3 9.2l2 2"/></svg>`,
    bell: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 10a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6.5H4c.5-1 2-2.5 2-6.5Z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>`,
    globe: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 4 6 4 9s-1.5 6.4-4 9c-2.5-2.6-4-6-4-9s1.5-6.4 4-9Z"/></svg>`,
    logout: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3"/><path d="M14 8l4 4-4 4"/><line x1="18" y1="12" x2="9" y2="12"/></svg>`,
    headset: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 13v-1a8 8 0 0 1 16 0v1"/><rect x="3" y="13" width="4" height="6" rx="1.3"/><rect x="17" y="13" width="4" height="6" rx="1.3"/><path d="M20 19v1a2.5 2.5 0 0 1-2.5 2.5H14"/></svg>`,
    "chevron-down": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="5,9 12,16 19,9"/></svg>`,
    "chevron-left": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15,5 8,12 15,19"/></svg>`,

    // نقاط الحالة (ألوان ثابتة الدلالة، بلا حدود)
    "dot-red": `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="#ef4444"/></svg>`,
    "dot-green": `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="#22c55e"/></svg>`,
    "dot-orange": `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="#f97316"/></svg>`,
    "dot-blue": `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="#3b82f6"/></svg>`,

    // قطاعات وظيفية (الصفحة الرئيسية التسويقية)
    restaurant: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v7a2 2 0 0 0 4 0V3M8 10v11"/><path d="M16 3c-1.5 0-2 2-2 4.5S15 12 16 12v9"/></svg>`,
    plane: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg>`,
    bag: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8h12l-1 12H7z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>`,

    // روابط التواصل الاجتماعي بالفوتر (بدائل مبسّطة غير محمية بحقوق نشر)
    camera: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7l1.5-3h5L16 7"/><circle cx="12" cy="13.5" r="3.5"/></svg>`,
    briefcase: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7.5" width="18" height="12" rx="1.5"/><path d="M8.5 7.5V5.5a1.5 1.5 0 0 1 1.5-1.5h4a1.5 1.5 0 0 1 1.5 1.5v2"/><line x1="3" y1="12.5" x2="21" y2="12.5"/></svg>`,
    music: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l10-2v13"/><circle cx="7" cy="18" r="2.3"/><circle cx="17" cy="16" r="2.3"/></svg>`,
    robot: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="9" width="14" height="10" rx="2"/><line x1="12" y1="5.5" x2="12" y2="9"/><circle cx="12" cy="4" r="1.2" fill="currentColor" stroke="none"/><circle cx="9" cy="13.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="13.5" r="1.2" fill="currentColor" stroke="none"/><line x1="2.5" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="21.5" y2="12"/></svg>`
};

// إتاحة الكائن عالمياً بشكل صريح (احتياطاً، رغم أن const بأعلى ملف كلاسيكي
// تكون على أي حال مرئية لبقية ملفات <script> اللاحقة بنفس الصفحة)
window.ICONS = ICONS;

// =========================================================================
// تعبئة كل العناصر [data-icon] الموجودة داخل نطاق معيّن (أو كامل المستند)
// =========================================================================
function applyIconPlaceholders(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-icon]').forEach(el => {
        const name = el.getAttribute('data-icon');
        if (ICONS[name] && el.dataset.iconApplied !== '1') {
            el.innerHTML = ICONS[name];
            el.classList.add('icon-svg');
            el.dataset.iconApplied = '1';
        }
    });
}
window.applyIconPlaceholders = applyIconPlaceholders;

// حقن تنسيق أساسي بسيط لضبط أبعاد كل الأيقونات لتتبع حجم الخط المحيط بها
// (بنفس فكرة .menu-icon svg الموجودة أصلاً بملف sidebar.css)، لتفادي الحاجة
// لتعديل كل ملف CSS يدوياً في كل صفحة.
(function injectIconBaseStyles() {
    const style = document.createElement('style');
    style.textContent = `
        [data-icon] { display: inline-flex; align-items: center; justify-content: center; }
        .icon-svg, [data-icon] svg { width: 1em; height: 1em; display: block; }
    `;
    document.head.appendChild(style);
})();

document.addEventListener('DOMContentLoaded', () => applyIconPlaceholders());