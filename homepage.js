// ==========================================================================
// نظام الترجمة (بصمة الأعمال) — تم تضمين نصوص اللغتين مباشرة داخل هذا الملف
// بدل تحميلهما عبر fetch("ar.json"/"en.json"). السبب: متصفحات الويب تمنع
// طلبات fetch لملفات محلية عند فتح الصفحة مباشرة من القرص (بروتوكول file://)
// بسبب سياسة CORS، مما كان يجعل زر تبديل اللغة لا يعمل إطلاقاً في هذه الحالة
// رغم أن ar.json/en.json كانتا سليمتين تماماً. التضمين المباشر هنا يجعل
// الترجمة تعمل بشكل متطابق سواء فُتحت الصفحة من القرص مباشرة، أو عبر خادم
// محلي، أو من الاستضافة النهائية — دون أي طلب شبكة إضافي.
// ==========================================================================

const AR_TRANSLATIONS = {
    "page_title": "بصمة الأعمال",
    "logo_text": "بصمة الأعمال",
    "nav_employers": "أصحاب العمل",
    "nav_find_jobs": "ابحث عن وظيفة",
    "btn_register": "تسجيل جديد",
    "btn_employee_login": "دخول موظف",
    "btn_login": "تسجيل دخول الشركات",
    "nav_companies": "الشركات",
    "hero_title": "المنصة المحلية الرائدة للإستشارات الإدارية للشركات",
    "hero_desc": "نقدّم حلولاً رقمية متكاملة لإدارة الموارد البشرية والعمليات الإدارية اليومية لشركتك، بأعلى معايير الكفاءة والاحترافية.",
    "companies_title": "شركات تثق بمنصة بصمة الأعمال",
    "companies_subtitle": "أكثر من 300+ شركة ناشئة وصغيرة ومتوسطة وكبرى في جميع أنحاء المملكة",
    "comp_half_m": "نصف مليون",
    "comp_vox": "فوكس",
    "comp_noon": "نون",
    "comp_floward": "فلاورد",
    "comp_whites": "المفهوم العميق",
    "comp_foodics": "فودكس",
    "comp_anoush": "أنوش",
    "comp_last_hour": "لاست آور",
    "comp_alhabib": "الحبيب",
    "comp_bens": "بنز كوكيز",
    "comp_tamimi": "التميمي",
    "comp_alshaya": "الشايع",
    "about_title": "من نحن",
    "about_p1": "\"بصمة الأعمال\" شركة سعودية متخصصة في تقديم الخدمات والاستشارات الإدارية، نساعد الشركات على إدارة مواردها البشرية وعملياتها اليومية بكفاءة عالية من خلال منصة رقمية متكاملة تواكب أعلى معايير الجودة.",
    "about_p2": "نغطي إدارة الموظفين، الحضور والانصراف، توزيع ومتابعة المهام، وإصدار التقارير الإدارية الدقيقة، مع تركيزنا الدائم على الابتكار والدقة لتمكين الشركات من اتخاذ قرارات أفضل.",
    "about_p3": "بفضل فريقنا المتخصص وأحدث التقنيات، نسعى دائماً لأن نكون الخيار الأمثل للشركات والمؤسسات الراغبة في تطوير إدارتها وتعزيز إنتاجيتها داخل المملكة العربية السعودية وخارجها.",
    "mission_title": "رسالتنا",
    "vision_title": "رؤيتنا",
    "vision_p1": "نطمح في \"بصمة الأعمال\" إلى تحقيق الريادة في مجال الخدمات والاستشارات الإدارية الرقمية، من خلال تقديم حلول مبتكرة وشاملة تُمكّن الشركات من إدارة مواردها بكفاءة عالية ووفق أفضل الممارسات العالمية.",
    "vision_p2": "نسعى لأن نكون الشريك الأمثل لعملائنا من خلال خدمات متميزة تسهم في نمو أعمالهم وتحقيق التنمية المستدامة، داخل المملكة العربية السعودية وخارجها.",
    "mission_p1": "انطلاقاً من إيماننا العميق بأهمية الإدارة الفعّالة، نقدّم حلولاً متكاملة لإدارة الموارد البشرية والعمليات الإدارية وفق أعلى معايير الجودة العالمية، معتمدين على فرق عمل مدرَّبة وأحدث التقنيات. نركّز على رضا عملائنا ونسعى دائماً لتطوير خدماتنا لمواكبة التطورات التقنية وتلبية احتياجات السوق المتنوعة.",

    "footer_col1_title": "بصمة الأعمال",
    "footer_brand_tagline": "للخدمات والاستشارات الإدارية",
    "footer_brand_desc": "نساعد الشركات على إدارة مواردها البشرية وعملياتها اليومية من خلال منصة رقمية متكاملة تواكب أعلى معايير الجودة والاحترافية.",
    "footer_brand_highlight": "نساعد شركتك على النمو ببناء أنظمة إدارية أكثر كفاءة واستدامة.",
    "footer_heading_company": "الشركة",
    "footer_heading_features": "مزايا المنصة",
    "footer_heading_contact": "تواصل معنا",
    "footer_link_about": "من نحن",
    "footer_link_register_company": "تسجيل شركة جديدة",
    "footer_link_company_login": "تسجيل دخول الشركات",
    "footer_contact": "اتصل بنا",
    "footer_emp_login": "دخول الموظفين",
    "footer_feature_employees": "إدارة الموظفين",
    "footer_feature_attendance": "الحضور والانصراف",
    "footer_feature_tasks": "إدارة المهام وتوزيعها",
    "footer_feature_companies": "إدارة الشركات المشتركة",
    "footer_feature_reports": "التقارير الإدارية الدقيقة",
    "footer_feature_roles": "الأدوار والصلاحيات",
    "footer_address": "الرياض - طريق الصحابة - حي إشبيلية - مجمع الحمراء سيتي - الطابق الثالث، مكتب رقم 301",
    "footer_btn_call": "اتصل الآن",
    "footer_btn_email": "راسلنا بالبريد",
    "footer_copy": "© 2026 بصمة الأعمال",
    "footer_vat": "الرقم الضريبي: 1234567890",
    "footer_privacy": "سياسة الخصوصية",
    "footer_terms": "الشروط والأحكام"
};

const EN_TRANSLATIONS = {
    "page_title": "Business Imprint",
    "logo_text": "Business Imprint",
    "nav_employers": "Employers",
    "nav_find_jobs": "Find Jobs",
    "btn_register": "Register",
    "btn_employee_login": "Employee Login",
    "btn_login": "Employers Login ",
    "nav_companies": "Companies",
    "hero_title": "The Leading Local Platform for Administrative Consulting for Businesses",
    "hero_desc": "We provide integrated digital solutions to manage your company's human resources and day-to-day administrative operations, with the highest standards of efficiency and professionalism.",
    "companies_title": "Companies that trust Business Imprint",
    "companies_subtitle": "More than 300+ SME and Enterprise across the kingdom",
    "comp_half_m": "½ M",
    "comp_vox": "VOX",
    "comp_noon": "noon",
    "comp_floward": "FLOWARD",
    "comp_whites": "whites",
    "comp_foodics": "FOODICS",
    "comp_anoush": "Anoush",
    "comp_last_hour": "LAST HOUR",
    "comp_alhabib": "ALHABIB",
    "comp_bens": "Ben's Cookies",
    "comp_tamimi": "Tamimi",
    "comp_alshaya": "Alshaya",
    "about_title": "About Us",
    "about_p1": "\"Business Imprint\" is a Saudi company specialized in providing administrative services and consulting, helping companies manage their human resources and daily operations efficiently through an integrated digital platform that meets the highest quality standards.",
    "about_p2": "We cover employee management, attendance tracking, task distribution and follow-up, and issuing precise administrative reports, with a constant focus on innovation and accuracy to enable companies to make better decisions.",
    "about_p3": "Thanks to our specialized team and the latest technologies, we always strive to be the ideal choice for companies and institutions looking to develop their management and boost their productivity, in Saudi Arabia and abroad.",
    "mission_title": "Our Mission",
    "vision_title": "Our Vision",
    "vision_p1": "At \"Business Imprint\", we aspire to achieve leadership in digital administrative services and consulting, by offering innovative, comprehensive solutions that enable companies to manage their resources efficiently and in line with global best practices.",
    "vision_p2": "We strive to be the ideal partner for our clients through distinguished services that contribute to their business growth and promote sustainable development, in Saudi Arabia and abroad.",
    "mission_p1": "Driven by our deep belief in the importance of effective management, we provide integrated solutions for human resources and administrative operations in line with the highest international quality standards, relying on trained teams and the latest technologies. We focus on customer satisfaction and constantly strive to develop our services to keep pace with technological developments and meet diverse market needs.",

    "footer_col1_title": "Business Imprint",
    "footer_brand_tagline": "Administrative Services & Consulting",
    "footer_brand_desc": "We help companies manage their human resources and daily operations through an integrated digital platform that meets the highest standards of quality and professionalism.",
    "footer_brand_highlight": "We help your business grow by building more efficient, sustainable management systems.",
    "footer_heading_company": "Company",
    "footer_heading_features": "Platform Features",
    "footer_heading_contact": "Contact Us",
    "footer_link_about": "About Us",
    "footer_link_register_company": "Register Your Company",
    "footer_link_company_login": "Company Login",
    "footer_contact": "Contact Us",
    "footer_emp_login": "Employers Login",
    "footer_feature_employees": "Employee Management",
    "footer_feature_attendance": "Attendance & Check-in",
    "footer_feature_tasks": "Task Management & Assignment",
    "footer_feature_companies": "Subscribed Companies Management",
    "footer_feature_reports": "Precise Administrative Reports",
    "footer_feature_roles": "Roles & Permissions",
    "footer_address": "Riyadh - Al Sahaba Road - Ishbiliya - Al Hamra City Complex - Third Floor, Office No. 301",
    "footer_btn_call": "Call Now",
    "footer_btn_email": "Email Us",
    "footer_copy": "© 2026 Business Imprint",
    "footer_vat": "VAT Number: 1234567890",
    "footer_privacy": "Privacy Policy",
    "footer_terms": "Terms & Agreements"
};

function loadTranslation(lang) {
    return lang === 'en' ? EN_TRANSLATIONS : AR_TRANSLATIONS;
}

function switchLanguage(lang) {
    var data = loadTranslation(lang);
    if (!data) return;

    var elements = document.querySelectorAll('[data-i18n]');

    // Apply fade out class natively
    elements.forEach(function(element) {
        element.classList.add('fade-out');
    });

    setTimeout(function() {
        elements.forEach(function(element) {
            var key = element.getAttribute('data-i18n');
            if (data[key]) {
                if (element.tagName === 'TITLE') {
                    document.title = data[key];
                } else {
                    element.textContent = data[key];
                }
            }
        });

        var htmlTag = document.documentElement;
        var langBtn = document.getElementById('langToggle');

        htmlTag.setAttribute('lang', lang);
        htmlTag.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
        if (langBtn) langBtn.textContent = lang === 'ar' ? 'English' : 'العربية';

        // Re-introduce content fade-in
        elements.forEach(function(element) {
            element.classList.remove('fade-out');
        });
    }, 250);
}

// Ensure elements bind safely after loading sequence completes
document.addEventListener('DOMContentLoaded', function() {
    var langButton = document.getElementById('langToggle');
    if (langButton) {
        langButton.addEventListener('click', function(e) {
            e.preventDefault();
            var currentLang = document.documentElement.getAttribute('lang') || 'ar';
            var newLang = currentLang === 'ar' ? 'en' : 'ar';

            localStorage.setItem('preferredLanguage', newLang);
            switchLanguage(newLang);
        });
    }

    var savedLang = localStorage.getItem('preferredLanguage') || 'ar';
    switchLanguage(savedLang);
});