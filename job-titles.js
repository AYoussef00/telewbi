// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================
const SUPABASE_URL = "https://mcdhxdfkuokhmhtfvjev.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_yt9V8lsNU1zN3Ix2CvovbQ_QCA2VDdM";
const dbClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let localProfessionsCache = [];
let filteredProfessionsCache = [];

// إعدادات تقسيم الصفحات
let currentProfessionPage = 1;
const professionsPerPage = 7;

document.addEventListener('DOMContentLoaded', async () => {
    const allowed = await Permissions.guardPage('job_titles');
    if (!allowed) return;

    fetchAndRenderProfessions();

    const addJobBtn = document.querySelector('.btn-add-job');
    if (addJobBtn) {
        addJobBtn.addEventListener('click', () => {
            window.location.href = 'add_job.html';
        });
    }
});

// 📊 دالة جلب المسميات الوظيفية حياً من جدول professions
async function fetchAndRenderProfessions() {
    const tableBody = document.getElementById('professionsTableBody');
    if (!tableBody) return;

    const { data: professions, error } = await dbClient
        .from('professions')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error("خطأ في الاتصال بقاعدة البيانات:", error.message);
        tableBody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#ef4444; padding:20px;">فشل تحميل قائمة المسميات الوظيفية.</td></tr>`;
        return;
    }

    localProfessionsCache = professions || [];
    filteredProfessionsCache = localProfessionsCache;
    currentProfessionPage = 1;

    renderProfessionsTable(filteredProfessionsCache);
}

// 📑 بناء صفوف الجدول
function renderProfessionsTable(data) {
    const tableBody = document.getElementById('professionsTableBody');
    if (!tableBody) return;
    tableBody.innerHTML = '';

    if (data.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:30px; color:#94a3b8;">لا توجد مسميات وظيفية مطابقة للبحث.</td></tr>`;
        setupProfessionPaginationControls(0);
        return;
    }

    const isEnglish = document.documentElement.getAttribute('lang') === 'en';

    const startIndex = (currentProfessionPage - 1) * professionsPerPage;
    const endIndex = startIndex + professionsPerPage;
    const paginatedData = data.slice(startIndex, endIndex);

    paginatedData.forEach(profession => {
        const row = document.createElement('tr');

        const createdDate = profession.created_at
            ? new Date(profession.created_at).toLocaleDateString(isEnglish ? 'en-GB' : 'ar-SA')
            : '----';

        row.innerHTML = `
            <td><strong style="color: #1e293b;">${profession.name_ar || '----'}</strong></td>
            <td style="color: #475569; direction: ltr; text-align: right;">${profession.name_en || '----'}</td>
            <td style="color: #64748b;">${createdDate}</td>
            <td style="text-align: center;">
                <button class="action-icon-btn" data-perm="edit:job_titles" title="تعديل المسمى الوظيفي" onclick="editProfession('${profession.id}')">${ICONS.edit}</button>
                <button class="action-icon-btn" data-perm="delete:job_titles" style="color:#ef4444;" title="حذف المسمى الوظيفي" onclick="deleteProfession('${profession.id}')">${ICONS.trash}</button>
            </td>
        `;
        tableBody.appendChild(row);
    });

    setupProfessionPaginationControls(data.length);

    // 🛡️ الأزرار أعلاه (تعديل/حذف الصف) بُنيت للتو ديناميكياً وتحمل السمة
    // data-perm — يجب تطبيق حارس الصلاحيات عليها يدوياً هنا لإظهارها فقط لمن
    // يملك الصلاحية المطابقة (تُستدعى هذه الدالة أيضاً بكل إعادة رسم عبر
    // البحث/الفلترة/التنقل بين الصفحات، فتغطي كل حالات إعادة الرسم تلقائياً).
    Permissions.applyButtonGating(tableBody);
}

// 📟 بناء عناصر التحكم بالصفحات
function setupProfessionPaginationControls(totalItems) {
    const controlsContainer = document.getElementById('professionsPagination');
    if (!controlsContainer) return;
    controlsContainer.innerHTML = '';

    const totalPages = Math.ceil(totalItems / professionsPerPage);
    if (totalPages <= 1) return;

    const isEnglish = document.documentElement.getAttribute('lang') === 'en';

    const prevBtn = document.createElement('button');
    prevBtn.innerHTML = isEnglish ? '&larr; Prev' : '&rarr; السابقة';
    prevBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;';
    prevBtn.disabled = currentProfessionPage === 1;
    if (prevBtn.disabled) prevBtn.style.opacity = '0.5';
    prevBtn.onclick = () => {
        if (currentProfessionPage > 1) {
            currentProfessionPage--;
            renderProfessionsTable(filteredProfessionsCache);
        }
    };
    controlsContainer.appendChild(prevBtn);

    const countLabel = document.createElement('span');
    countLabel.style.cssText = 'font-size: 0.9rem; color: #475569; font-weight: 600; font-family: system-ui, sans-serif; margin: 0 10px;';
    countLabel.textContent = isEnglish ? `Page ${currentProfessionPage} of ${totalPages}` : `صفحة ${currentProfessionPage} من ${totalPages}`;
    controlsContainer.appendChild(countLabel);

    const nextBtn = document.createElement('button');
    nextBtn.innerHTML = isEnglish ? 'Next &rarr;' : 'التالية &larr;';
    nextBtn.style.cssText = 'padding: 6px 12px; border: 1px solid #cbd5e1; background: #fff; border-radius: 4px; cursor: pointer; color: #475569; font-weight: 500;';
    nextBtn.disabled = currentProfessionPage === totalPages;
    if (nextBtn.disabled) nextBtn.style.opacity = '0.5';
    nextBtn.onclick = () => {
        if (currentProfessionPage < totalPages) {
            currentProfessionPage++;
            renderProfessionsTable(filteredProfessionsCache);
        }
    };
    controlsContainer.appendChild(nextBtn);
}

// 🔍 دالة البحث الفوري (بالعربي أو الإنجليزي)
function handleProfessionFilterChange() {
    const text = (document.getElementById('jobSearchInput').value || '').toLowerCase().trim();

    filteredProfessionsCache = localProfessionsCache.filter(p => {
        return (p.name_ar && p.name_ar.toLowerCase().includes(text)) ||
               (p.name_en && p.name_en.toLowerCase().includes(text));
    });

    currentProfessionPage = 1;
    renderProfessionsTable(filteredProfessionsCache);
}

// 📝 الانتقال لصفحة تعديل المسمى الوظيفي (صفحة مستقلة وليست نافذة منبثقة)
function editProfession(id) {
    window.location.href = 'edit_job.html?id=' + encodeURIComponent(id);
}

// 🗑️ حذف مسمى وظيفي نهائياً بعد التأكيد
async function deleteProfession(id) {
    const isEnglish = document.documentElement.getAttribute('lang') === 'en';
    const confirmMessage = isEnglish
        ? "Are you sure you want to permanently delete this job title?"
        : "هل أنت متأكد من حذف هذا المسمى الوظيفي نهائياً؟";

    if (!confirm(confirmMessage)) return;

    try {
        const { data, error } = await dbClient
            .from('professions')
            .delete()
            .eq('id', id)
            .select();

        if (error) throw error;

        // إن لم يُحذف أي صف (data فارغة) رغم عدم وجود خطأ صريح، غالباً يعني ذلك
        // أن سياسة RLS بقاعدة البيانات تمنع الحذف بصمت لهذا المستخدم
        if (!data || data.length === 0) {
            const rlsMsg = isEnglish
                ? "Delete failed: you may not have permission to delete this record (check RLS policy on the professions table)."
                : "فشل الحذف: قد لا تملك صلاحية حذف هذا السجل (تحقق من سياسة RLS الخاصة بجدول professions).";
            alert(rlsMsg);
            return;
        }

        alert(isEnglish ? "Deleted successfully!" : "تم الحذف بنجاح!");
        await fetchAndRenderProfessions();
    } catch (error) {
        console.error("Error deleting profession:", error.message);
        alert((isEnglish ? "Delete failed: " : "فشل الحذف: ") + error.message);
    }
}