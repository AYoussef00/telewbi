// =========================================================================
// 1. الاتصال بقاعدة بيانات سوبابيس
// =========================================================================
const SUPABASE_URL = "https://mcdhxdfkuokhmhtfvjev.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_yt9V8lsNU1zN3Ix2CvovbQ_QCA2VDdM";
const dbClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUserId = null;
const PREF_CHECKBOX_IDS = ['notifTasks', 'notifAttendance', 'notifSupport', 'notifSystem'];

// 🐛 إصلاح: هذه الصفحة تستخدم حاوية ".page-container" (مخفية افتراضياً إلى أن
// يُظهرها permissions.js — انظر الشرح الكامل بتعليق global-layout.css) لكنها
// لم تكن تُحمِّل permissions.js إطلاقاً، فيبقى محتواها مخفياً للأبد — بالضبط
// مشكلة "تفضيلات الإشعارات لا تعمل" التي أبلغ عنها المستخدم. الحل: تحميل
// permissions.js واستدعاء guardPage('dashboard') فور بدء الصفحة (قسم مُستثنى
// دائماً من نظام التقييد، فيسمح فوراً لأي مستخدم مسجّل دخول ويُظهر المحتوى
// بلا انتظار مهلة الـ6 ثوانٍ الاحتياطية).
document.addEventListener('DOMContentLoaded', async () => {
    const allowed = await Permissions.guardPage('dashboard');
    if (!allowed) return;

    await loadNotificationPreferences();

    document.getElementById('notifMasterToggle').addEventListener('change', handleMasterToggleChange);
    PREF_CHECKBOX_IDS.forEach(id => {
        document.getElementById(id).addEventListener('change', syncMasterToggleState);
    });
    document.getElementById('btnSaveNotifPrefs').addEventListener('click', handleSaveNotificationPreferences);
});

// 📥 جلب تفضيلات المستخدم الحالي (أو الافتراضات: كل الإشعارات مُفعّلة)
async function loadNotificationPreferences() {
    try {
        const { data: { session } } = await dbClient.auth.getSession();
        // 🛡️ حالة "لا توجد جلسة" أصبحت مُغطّاة مركزياً الآن عبر permissions.js
        // (نفس الفحص الذي مرّ به Permissions.guardPage أعلاه بالفعل، ويُحوِّل
        // تلقائياً لصفحة index.html) — نكتفي هنا بإيقاف هادئ بلا تحويل مستقل
        // قد يتسابق مع ذلك التحويل المركزي.
        if (!session) return;
        currentUserId = session.user.id;

        const { data: prefRow, error } = await dbClient
            .from('notification_preferences')
            .select('tasks_notifications, attendance_notifications, support_notifications, system_notifications')
            .eq('user_id', currentUserId)
            .maybeSingle();

        if (error) throw new Error(error.message);

        // لا يوجد صف بعد لهذا المستخدم = كل الإشعارات مُفعّلة افتراضياً
        document.getElementById('notifTasks').checked = prefRow ? !!prefRow.tasks_notifications : true;
        document.getElementById('notifAttendance').checked = prefRow ? !!prefRow.attendance_notifications : true;
        document.getElementById('notifSupport').checked = prefRow ? !!prefRow.support_notifications : true;
        document.getElementById('notifSystem').checked = prefRow ? !!prefRow.system_notifications : true;

        syncMasterToggleState();

    } catch (error) {
        console.error('تعذّر تحميل تفضيلات الإشعارات:', error.message);
        showNotifAlert('تعذّر تحميل تفضيلاتك الحالية: ' + error.message, 'error');
    }
}

// المفتاح الرئيسي "تفعيل الكل": يعكس حالة "الكل مُفعّل" فقط، ويُعطّل/يُفعّل الكل عند تبديله يدوياً
function handleMasterToggleChange(event) {
    const shouldEnableAll = event.target.checked;
    PREF_CHECKBOX_IDS.forEach(id => { document.getElementById(id).checked = shouldEnableAll; });
}

function syncMasterToggleState() {
    const allChecked = PREF_CHECKBOX_IDS.every(id => document.getElementById(id).checked);
    document.getElementById('notifMasterToggle').checked = allChecked;
}

function showNotifAlert(message, type) {
    const alertBox = document.getElementById('notifFormAlert');
    alertBox.textContent = message;
    alertBox.className = 'form-alert ' + (type === 'success' ? 'alert-success' : 'alert-error');
    alertBox.style.display = 'flex';
}
function hideNotifAlert() {
    document.getElementById('notifFormAlert').style.display = 'none';
}

// 💾 حفظ التفضيلات (upsert: إنشاء الصف إن لم يوجد، أو تحديثه إن وُجد)
async function handleSaveNotificationPreferences() {
    hideNotifAlert();

    const payload = {
        user_id: currentUserId,
        tasks_notifications: document.getElementById('notifTasks').checked,
        attendance_notifications: document.getElementById('notifAttendance').checked,
        support_notifications: document.getElementById('notifSupport').checked,
        system_notifications: document.getElementById('notifSystem').checked,
        updated_at: new Date().toISOString()
    };

    const saveBtn = document.getElementById('btnSaveNotifPrefs');
    const originalText = saveBtn.textContent;
    saveBtn.disabled = true;
    saveBtn.textContent = 'جاري الحفظ...';

    try {
        const { error } = await dbClient.from('notification_preferences').upsert(payload, { onConflict: 'user_id' });
        if (error) throw new Error(error.message);

        showNotifAlert('تم حفظ تفضيلات الإشعارات بنجاح.', 'success');
    } catch (error) {
        console.error('فشل حفظ تفضيلات الإشعارات:', error.message);
        showNotifAlert('فشل الحفظ: ' + error.message, 'error');
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = originalText;
    }
}