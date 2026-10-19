// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================

// =========================================================================
// 2. قواعد التحقق (Validation Rules)
// =========================================================================
// يسمح الآن بالأحرف العربية بالإضافة للأرقام والعلامات الشائعة في المسميات
// الوظيفية (مثل: - / & ( ) . , + ')، بشرط وجود حرف عربي واحد على الأقل بالنص
const AR_TEXT_REGEX = /^[؀-ۿ0-9\s\-\/&().,+']+$/;
const HAS_ARABIC_LETTER = /[؀-ۿ]/;

// حقل "الإنجليزي" يقبل حروفاً عربية أيضاً (المستخدم قد يكتب بالعربي مؤقتاً
// أو يستخدم الترجمة التلقائية)، بالإضافة للأرقام والعلامات الشائعة
const EN_TEXT_REGEX = /^[A-Za-z؀-ۿ0-9\s\-\/&().,+']+$/;
const HAS_LETTER = /[A-Za-z؀-ۿ]/;

function getErrorMessages(isEnglish) {
    return {
        name_ar_required: isEnglish ? 'Please enter the job title in Arabic.' : 'الرجاء إدخال المسمى الوظيفي بالعربي.',
        name_ar_short: isEnglish ? 'Must be at least 2 characters.' : 'يجب أن يتكون من حرفين على الأقل.',
        name_ar_invalid: isEnglish ? 'Please use Arabic letters (numbers and symbols like - / & ( ) . , + are allowed).' : 'الرجاء استخدام حروف عربية (يمكن إضافة أرقام وعلامات مثل - / & ( ) . , + مع الحروف).',
        name_en_required: isEnglish ? 'Please enter the job title in English.' : 'الرجاء إدخال المسمى الوظيفي بالإنجليزي.',
        name_en_short: isEnglish ? 'Must be at least 2 characters.' : 'يجب أن يتكون من حرفين على الأقل.',
        name_en_invalid: isEnglish ? 'Please use English or Arabic letters (numbers and symbols like - / & ( ) . , + are allowed).' : 'الرجاء استخدام حروف إنجليزية أو عربية (يمكن إضافة أرقام وعلامات مثل - / & ( ) . , + مع الحروف).'
    };
}

function validateField(fieldName, form, msgs) {
    const get = (id) => form.querySelector('#' + id);

    switch (fieldName) {
        case 'name_ar': {
            const val = get('jobNameAr').value.trim();
            if (!val) return msgs.name_ar_required;
            if (val.length < 2) return msgs.name_ar_short;
            if (!AR_TEXT_REGEX.test(val) || !HAS_ARABIC_LETTER.test(val)) return msgs.name_ar_invalid;
            return null;
        }
        case 'name_en': {
            const val = get('jobNameEn').value.trim();
            if (!val) return msgs.name_en_required;
            if (val.length < 2) return msgs.name_en_short;
            if (!EN_TEXT_REGEX.test(val) || !HAS_LETTER.test(val)) return msgs.name_en_invalid;
            return null;
        }
        default:
            return null;
    }
}

function setFieldError(fieldName, message) {
    const group = document.getElementById('group-' + fieldName);
    const errorEl = document.getElementById('error-' + fieldName);
    if (!group || !errorEl) return;

    if (message) {
        group.classList.add('has-error');
        group.classList.remove('is-valid');
        errorEl.textContent = message;
    } else {
        group.classList.remove('has-error');
        group.classList.add('is-valid');
        errorEl.textContent = '';
    }
}

function validateAllFields(form) {
    const isEnglish = document.documentElement.getAttribute('lang') === 'en';
    const msgs = getErrorMessages(isEnglish);
    const fieldNames = ['name_ar', 'name_en'];

    let isValid = true;
    let firstInvalidField = null;

    fieldNames.forEach((fieldName) => {
        const errorMsg = validateField(fieldName, form, msgs);
        setFieldError(fieldName, errorMsg);
        if (errorMsg) {
            isValid = false;
            if (!firstInvalidField) firstInvalidField = fieldName;
        }
    });

    if (firstInvalidField) {
        const el = document.getElementById('group-' + firstInvalidField).querySelector('input, select');
        if (el) el.focus();
    }

    return isValid;
}

function showFormAlert(message, type) {
    const alertBox = document.getElementById('formAlert');
    if (!alertBox) return;
    alertBox.textContent = message;
    alertBox.className = 'form-alert ' + (type === 'success' ? 'alert-success' : 'alert-error');
    alertBox.style.display = 'flex';
    alertBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideFormAlert() {
    const alertBox = document.getElementById('formAlert');
    if (!alertBox) return;
    alertBox.style.display = 'none';
}

// =========================================================================
// 3. الترجمة التلقائية من العربي إلى الإنجليزي (خدمة MyMemory المجانية، بدون
//    الحاجة لمفتاح API) — تُستخدم لتعبئة حقل "المسمى بالإنجليزي" تلقائياً
// =========================================================================
function showTranslateHint(message) {
    const hintEl = document.getElementById('translateHint');
    if (!hintEl) return;
    if (message) {
        hintEl.textContent = message;
        hintEl.style.display = 'block';
    } else {
        hintEl.style.display = 'none';
        hintEl.textContent = '';
    }
}

async function translateArabicToEnglish(text) {
    const trimmed = (text || '').trim();
    if (!trimmed) return '';

    const response = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(trimmed)}&langpair=ar|en`);
    if (!response.ok) throw new Error('تعذّر الاتصال بخدمة الترجمة.');

    const data = await response.json();
    const translated = data && data.responseData && data.responseData.translatedText;
    if (!translated) throw new Error('لم يتم العثور على ترجمة مناسبة.');

    // تنظيف بسيط: إزالة المسافات الزائدة
    return translated.trim().replace(/\s+/g, ' ');
}

async function runAutoTranslate({ force }) {
    const isEnglish = document.documentElement.getAttribute('lang') === 'en';
    const arInput = document.getElementById('jobNameAr');
    const enInput = document.getElementById('jobNameEn');
    const translateBtn = document.getElementById('btnAutoTranslate');
    if (!arInput || !enInput) return;

    const arValue = arInput.value.trim();
    if (!arValue) return;

    // في التعبئة التلقائية الصامتة (عند مغادرة حقل العربي) لا نتجاوز قيمة كتبها
    // المستخدم بنفسه بالفعل بحقل الإنجليزي؛ أما زر "ترجمة تلقائية" فهو طلب
    // صريح من المستخدم لذا يُسمح له بالاستبدال دائماً
    if (!force && enInput.value.trim()) return;

    if (translateBtn) translateBtn.disabled = true;
    showTranslateHint(isEnglish ? 'Translating automatically...' : 'جاري الترجمة تلقائياً...');

    try {
        const translated = await translateArabicToEnglish(arValue);
        enInput.value = translated;
        setFieldError('name_en', null);
        showTranslateHint(isEnglish ? 'Auto-translated — feel free to edit it.' : 'تمت الترجمة تلقائياً — يمكنك تعديلها إن أردت.');
    } catch (error) {
        console.error('تعذّر جلب الترجمة التلقائية:', error.message);
        // فشل صامت في التعبئة التلقائية بالخلفية، وتنبيه فقط عند الطلب الصريح بالزر
        showTranslateHint(force ? (isEnglish ? 'Auto-translation failed, please type it manually.' : 'تعذّرت الترجمة التلقائية، الرجاء كتابتها يدوياً.') : '');
    } finally {
        if (translateBtn) translateBtn.disabled = false;
    }
}

// =========================================================================
// 4. ربط الأحداث
// =========================================================================
document.addEventListener('DOMContentLoaded', async function() {
    const allowed = await Permissions.guardPage('job_titles');
    if (!allowed) return;

    const form = document.getElementById('addJobForm');
    const cancelBtn = document.getElementById('btnCancel');

    const fieldIdsMap = {
        jobNameAr: 'name_ar',
        jobNameEn: 'name_en'
    };

    Object.keys(fieldIdsMap).forEach((inputId) => {
        const el = document.getElementById(inputId);
        if (!el) return;
        el.addEventListener('blur', () => {
            const isEnglish = document.documentElement.getAttribute('lang') === 'en';
            const msgs = getErrorMessages(isEnglish);
            const fieldName = fieldIdsMap[inputId];
            setFieldError(fieldName, validateField(fieldName, form, msgs));
        });
    });

    // تعبئة تلقائية صامتة لحقل الإنجليزي عند مغادرة حقل العربي (فقط إن كان الإنجليزي فارغاً)
    const jobNameArInput = document.getElementById('jobNameAr');
    if (jobNameArInput) {
        jobNameArInput.addEventListener('blur', () => { runAutoTranslate({ force: false }); });
    }

    // زر "ترجمة تلقائية" الصريح: يترجم دائماً ويستبدل أي محتوى حالي بحقل الإنجليزي
    const translateBtn = document.getElementById('btnAutoTranslate');
    if (translateBtn) {
        translateBtn.addEventListener('click', (e) => {
            e.preventDefault();
            runAutoTranslate({ force: true });
        });
    }

    // 1. زر إلغاء يرجع لصفحة قائمة المسميات الوظيفية
    cancelBtn.addEventListener('click', function() {
        if (confirm('هل أنت متأكد من إلغاء العملية؟ لن يتم حفظ البيانات.')) {
            window.location.href = Routes.url('job-titles');
        }
    });

    // 2. حفظ المسمى الوظيفي في جدول professions
    form.addEventListener('submit', async function(event) {
        event.preventDefault();
        hideFormAlert();

        const isEnglish = document.documentElement.getAttribute('lang') === 'en';

        if (!validateAllFields(form)) {
            showFormAlert(
                isEnglish ? 'Please fix the highlighted fields below.' : 'الرجاء تصحيح الحقول المظللة أدناه.',
                'error'
            );
            return;
        }

        const nameAr = document.getElementById('jobNameAr').value.trim();
        const nameEn = document.getElementById('jobNameEn').value.trim();

        const submitBtn = form.querySelector('.btn-submit');
        const originalBtnText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = isEnglish ? 'Saving...' : 'جاري الحفظ...';

        try {
            // فحص عدم تكرار نفس المسمى الوظيفي (بالعربي أو الإنجليزي)
            const { data: existingJob, error: checkError } = await dbClient
                .from('professions')
                .select('id')
                .or(`name_ar.eq.${nameAr},name_en.eq.${nameEn}`)
                .maybeSingle();

            if (checkError) throw new Error(checkError.message);

            if (existingJob) {
                const dupMsg = isEnglish ? 'This job title already exists.' : 'هذا المسمى الوظيفي مضاف مسبقاً.';
                setFieldError('name_ar', dupMsg);
                showFormAlert(dupMsg, 'error');
                return;
            }

            const payload = {
                name_ar: nameAr,
                name_en: nameEn
            };

            const { error: insertError } = await dbClient
                .from('professions')
                .insert([payload]);

            if (insertError) throw new Error(insertError.message);

            showFormAlert(isEnglish ? 'Job title added successfully! Redirecting...' : 'تم إضافة المسمى الوظيفي بنجاح، جاري التحويل...', 'success');
            setTimeout(() => {
                window.location.href = Routes.url('job-titles');
            }, 1200);

        } catch (error) {
            console.error('Profession Creation Error:', error.message);
            showFormAlert((isEnglish ? 'Operation failed: ' : 'فشلت العملية: ') + error.message, 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = originalBtnText;
        }
    });
});