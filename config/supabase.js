/* =========================================================================
 * config/supabase.js — الإعداد المركزي للاتصال بـ Supabase (مصدر واحد للمشروع كله)
 *
 * يُحمَّل في كل صفحة بعد مكتبة supabase-js مباشرةً وقبل أي سكربت آخر، ويعرّف:
 *   SUPABASE_URL / SUPABASE_ANON_KEY : بيانات المشروع
 *   dbClient                         : العميل المشترك الذي تستخدمه كل الصفحات
 * لتغيير المشروع أو المفتاح عدّل هذا الملف فقط.
 * (المفتاح هنا publishable/anon وهو مصمّم ليكون ظاهراً بالمتصفح؛ الحماية الفعلية
 *  تتم عبر سياسات RLS في قاعدة البيانات.)
 * ========================================================================= */
const SUPABASE_URL = "https://mcdhxdfkuokhmhtfvjev.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_yt9V8lsNU1zN3Ix2CvovbQ_QCA2VDdM";

// اسم مخصّص (dbClient) حتى لا يتعارض مع الكائن العام 'supabase' القادم من المكتبة
const dbClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
