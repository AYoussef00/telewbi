// =========================================================================
// 1. معطيات الاتصال الآمن بسوبابيس (Supabase Credentials)
// =========================================================================
// 2. Structural runtime pagination trackers
let workingDatasetState = [];
let currentActivePage = 1;
const RECORDS_PER_PAGE_LIMIT = 5;

// =========================================================================
// 1أ. تاريخ ووقت الدخول الفعلي بترويسة لوحة التحكم — كان نصاً ثابتاً مكتوباً
// يدوياً بملفي ar.json/en.json ("التاريخ: 14 يوليو 2026") لا يتغيّر أبداً.
// أصبح الآن يُحسب من ساعة جهاز المستخدم الفعلية عند كل تحميل، ويتحدّث تلقائياً
// كل دقيقة ليبقى "حياً" طيلة بقاء الصفحة مفتوحة، ويُعاد رسمه فوراً عند تبديل
// اللغة حتى يطابق تنسيق التاريخ (عربي/إنجليزي) الصحيح.
// =========================================================================
function renderDashboardDateTime() {
    const el = document.getElementById('dashboardCurrentDateTime');
    if (!el) return;

    const isEnglish = document.documentElement.getAttribute('lang') === 'en';
    const now = new Date();
    // نفرض ترقيماً لاتينياً (u-nu-latn) حتى مع اللغة العربية، لمطابقة بقية أرقام
    // النظام (الهاتف، الرقم الضريبي...) التي تُعرض دائماً بأرقام لاتينية
    const locale = isEnglish ? 'en-US' : 'ar-u-nu-latn';

    const datePart = now.toLocaleDateString(locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const timePart = now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

    el.textContent = `${datePart} — ${timePart}`;
}

// =========================================================================
// 1ب. جلب كامل صفوف جدول ما على دفعات (Pagination) — سوبابيس (PostgREST) يفرض
// حداً افتراضياً 1000 صف كحد أقصى لكل طلب، وأي طلب select(...) بلا .range()
// صريح كان يُقتطع صامتاً عند تجاوز هذا الحد (نفس المشكلة التي أُصلحت بتقارير
// الحضور/المهام/الموظفين/الشركات وشاشتي إدارة الحضور والشركات). لا تنطبق هذه
// المشكلة على استعلامات العدّ (count: 'exact', head: true) بالأسفل لأنها لا
// تُعيد صفوفاً أصلاً، فيبقى العدد دقيقاً دائماً بغض النظر عن حجم الجدول —
// builderFactory(from, to) يجب أن يُعيد استعلام سوبابيس جاهزاً (Promise) مع
// .range(from, to) مُطبّق عليه بالفعل.
// =========================================================================
const DASHBOARD_FETCH_PAGE_SIZE = 1000;

async function fetchAllRows(builderFactory) {
    let allRows = [];
    let from = 0;

    while (true) {
        const { data, error } = await builderFactory(from, from + DASHBOARD_FETCH_PAGE_SIZE - 1);
        if (error) throw error;

        allRows = allRows.concat(data || []);

        if (!data || data.length < DASHBOARD_FETCH_PAGE_SIZE) break; // آخر صفحة
        from += DASHBOARD_FETCH_PAGE_SIZE;
    }

    return allRows;
}

document.addEventListener('DOMContentLoaded', async () => {
    const allowed = await Permissions.guardPage('dashboard');
    if (!allowed) return;

    // نحدّد أولاً دور المستخدم الحالي: لوحة تحكم عامة (مسؤول) أو لوحة تحكم
    // مخصّصة لشركة (دور company) أو لوحة تحكم موظف — انظر القسم 8 بالأسفل
    //
    // ⚠️ مهم: نستدعي notifyLayoutComponentReady() هنا يدوياً بعد اكتمال تحديد
    // الدور وإظهار اللوحة الصحيحة (كطرف ثالث بجانب السايدبار وشريط التنقل) —
    // انظر تعليق app-core.js: LAYOUT_READY_REQUIRED أصبح 3 تحديداً بصفحة
    // لوحة التحكم بدل 2، فلا تُخفى شاشة التحميل (#pageLoader) إلا بعد أن تكون
    // اللوحة الصحيحة (المسؤول/الشركة/الموظف) ظاهرة فعلياً خلفها — بدل إخفائها
    // فور جهوزية السايدبار والنافبار فقط (طلبان سريعان لا علاقة لهما بطلب
    // تحديد الدور من قاعدة البيانات)، وهو ما كان يسبب ظهور لوحة المسؤول
    // العامة للحظة قبل استبدالها بلوحة تحكم الموظف الصحيحة.
    loadCurrentUserScopeAndRenderDashboard().finally(() => {
        if (window.notifyLayoutComponentReady) window.notifyLayoutComponentReady();
    });

    // ⏰ التاريخ/الوقت الفعلي بترويسة اللوحة — يُرسم فوراً، ثم يُحدَّث تلقائياً
    // كل دقيقة، ويُعاد رسمه أيضاً فور تبديل اللغة (المستمع أدناه يعمل عبر
    // التفويض Delegation لأن زر تبديل اللغة يُحقن لاحقاً ضمن navbar.html)
    renderDashboardDateTime();
    setInterval(renderDashboardDateTime, 60000);
    document.addEventListener('click', (e) => {
        if (e.target.closest && e.target.closest('#languageSwitcher')) {
            setTimeout(renderDashboardDateTime, 260);
        }
    });

    const daysFilterEl = document.getElementById('daysFilter');
    if (daysFilterEl) {
        daysFilterEl.addEventListener('change', () => loadEmployeeGrowthChart(getSelectedDaysRange()));
    }
});

function getSelectedDaysRange() {
    const daysFilterEl = document.getElementById('daysFilter');
    const parsed = parseInt(daysFilterEl && daysFilterEl.value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

// =========================================================================
// 3. فحص الجلسة وحارس بوابة اللوحة (Route Guard)
// =========================================================================
async function checkUserAuthentication() {
    try {
        const { data: { session }, error } = await dbClient.auth.getSession();

        if (error || !session) {
            alert("انتهت الجلسة أو لم يتم تسجيل الدخول، سيتم توجيهك فوراً للرئيسية.");
            window.location.href = Routes.url('index');
            return;
        }

        // مزامنة العدادات ديناميكياً من الجداول الحقيقية فور نجاح الهوية
        fetchAndUpdateCounters();
    } catch (err) {
        console.error("خطأ حماية واجهة الإدارة:", err);
        window.location.href = Routes.url('index');
    }
}

// =========================================================================
// 4. جلب العدادات من قاعدة بيانات Supabase (Real-time Counters)
// =========================================================================
// 📊 إجمالي الشركات + إجمالي الموظفين + إجمالي ربط الموظفين + المهام المكتملة
// (البطاقات الأربع الأولى بلوحة التحكم)
// ⚠️ هذه استعلامات عدّ فقط (count: 'exact', head: true) — لا تُعيد صفوفاً على
// الإطلاق، فالعدد المُرجَع دقيق دائماً بغض النظر عن حجم الجدول ولا يحتاج لأي
// تقسيم صفحات (لا يخضع لحد الـ1000 صف الخاص بإرجاع البيانات نفسها).
async function fetchAndUpdateCounters() {
    try {
        const [companiesResult, employeesResult, employeeLinksResult, completedTasksResult] = await Promise.all([
            dbClient.from('companies').select('*', { count: 'exact', head: true }),
            dbClient.from('employees').select('*', { count: 'exact', head: true }),
            // إجمالي عدد صفوف "الروابط النشطة حالياً" بجدول employee_links —
            // بديل بطاقة "المستخدمون النشطون" السابقة. ⚠️ بعد أن أصبح "إنهاء
            // ربط موظف" يُسجِّل تاريخ انتهاء بدل حذف السجل فعلياً، تبقى الروابط
            // المُنهاة محفوظة بنفس الجدول — لذا وجب تقييد هذا العدّ بالروابط
            // النشطة فقط (بلا تاريخ انتهاء، أو لم يأتِ تاريخ انتهائها بعد) حتى
            // يستمر تمثيله لعدد الروابط الفعلية القائمة حالياً، مطابقاً لسلوكه
            // السابق حين كانت كل الروابط بالجدول نشطة بالضرورة (الحذف الفعلي).
            dbClient.from('employee_links').select('*', { count: 'exact', head: true })
                .or(`link_end_date.is.null,link_end_date.gte.${todayDateString()}`),
            // إجمالي المهام التي حالتها "مكتملة" بجدول tasks — كانت بطاقة "المهام
            // المكتملة" ثابتة على 0 بلا أي جلب فعلي من قاعدة البيانات
            dbClient.from('tasks').select('*', { count: 'exact', head: true }).eq('status', 'مكتملة')
        ]);

        if (companiesResult.error) throw companiesResult.error;
        if (employeesResult.error) throw employeesResult.error;
        if (employeeLinksResult.error) throw employeeLinksResult.error;
        if (completedTasksResult.error) throw completedTasksResult.error;

        const companiesEl = document.getElementById('companiesCounter');
        const employeesEl = document.getElementById('employeesCounter');
        const employeeLinksEl = document.getElementById('employeeLinksCounter');
        const completedTasksEl = document.getElementById('completedTasksCounter');

        if (companiesEl) companiesEl.textContent = companiesResult.count ?? 0;
        if (employeesEl) employeesEl.textContent = employeesResult.count ?? 0;
        if (employeeLinksEl) employeeLinksEl.textContent = employeeLinksResult.count ?? 0;
        if (completedTasksEl) completedTasksEl.textContent = completedTasksResult.count ?? 0;
    } catch (error) {
        console.error("فشل مزامنة العدادات الحية:", error);
    }
}

// =========================================================================
// 5. بطاقة "أفضل الشركات" — أعلى 5 شركات وفق عدد الموظفين الفعلي المرتبط
//    بكل شركة، بدلاً من البيانات التجريبية الثابتة
//
//    ⚠️ العدد يُحسب من جدول employee_links (روابط الموظفين الحالية بالشركات)،
//    وليس من العمود المهجور employees.company_id الذي يبقى دائماً null منذ أن
//    أصبحت "ربط الموظفين" شاشة مستقلة عن "إضافة موظف" (نفس خلل الأعمدة المهجورة
//    الذي أُصلح سابقاً بعدة شاشات هذه الجلسة) — وهو تحديداً سبب ظهور هذه البطاقة
//    فارغة دائماً رغم وجود موظفين مرتبطين فعلياً بشركات.
//
//    ⚠️ كلا الجدولين يُجلبان على دفعات (fetchAllRows) بدل طلب واحد، حتى لا
//    يُقتطع العدد الفعلي صامتاً عند تجاوز حد الـ1000 صف من سوبابيس.
//
//    ⚠️ روابط نشطة فقط: بعد أن أصبح "إنهاء ربط موظف" يُسجِّل تاريخ انتهاء بدل
//    حذف السجل فعلياً، تبقى روابط الموظفين المُنهاة محفوظة بالجدول — بدون هذا
//    الفلتر كانت أعداد الموظفين لكل شركة ستشمل موظفين منتهي ربطهم فعلياً.
// =========================================================================
const TOP_COMPANIES_BAR_COLORS = ['b-blue', 'b-green', 'b-orange', 'b-pink', 'b-purple'];

async function loadTopCompaniesByEmployeeCount() {
    const container = document.getElementById('topCompaniesBarChart');
    if (!container) return;

    try {
        const [companies, links] = await Promise.all([
            fetchAllRows((from, to) =>
                dbClient.from('companies').select('id, name')
                    .order('id', { ascending: true })
                    .range(from, to)
            ),
            fetchAllRows((from, to) =>
                dbClient.from('employee_links').select('company_id')
                    .or(`link_end_date.is.null,link_end_date.gte.${todayDateString()}`)
                    .order('id', { ascending: true })
                    .range(from, to)
            )
        ]);

        // احتساب عدد الموظفين الفعلي لكل شركة اعتماداً على جدول الربط الحي (كل
        // صف = ربط حالي بين موظف وشركة)
        const employeeCountByCompanyId = new Map();
        links.forEach(link => {
            if (link.company_id == null) return;
            const key = String(link.company_id);
            employeeCountByCompanyId.set(key, (employeeCountByCompanyId.get(key) || 0) + 1);
        });

        // نأخذ فقط الشركات التي لديها موظف واحد على الأقل، مرتّبة تنازلياً، وأفضل 5 منها
        const rankedCompanies = companies
            .map(company => ({
                name: company.name || '----',
                count: employeeCountByCompanyId.get(String(company.id)) || 0
            }))
            .filter(row => row.count > 0)
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

        renderTopCompaniesBarChart(rankedCompanies);

    } catch (error) {
        console.error('فشل تحميل بيانات أفضل الشركات:', error);
        container.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon" data-icon="chart-down"></span>
                <p>تعذّر تحميل بيانات الشركات</p>
            </div>
        `;
        applyIconPlaceholders(container);
    }
}

function renderTopCompaniesBarChart(rankedCompanies) {
    const container = document.getElementById('topCompaniesBarChart');
    if (!container) return;

    if (!rankedCompanies || rankedCompanies.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon" data-icon="chart-down"></span>
                <p>لا توجد بيانات لعرضها</p>
            </div>
        `;
        applyIconPlaceholders(container);
        return;
    }

    const maxCount = rankedCompanies[0].count || 1;

    container.innerHTML = rankedCompanies.map((row, index) => {
        const widthPercent = Math.max(4, Math.round((row.count / maxCount) * 100));
        const colorClass = TOP_COMPANIES_BAR_COLORS[index % TOP_COMPANIES_BAR_COLORS.length];
        const safeName = String(row.name).replace(/</g, '&lt;').replace(/>/g, '&gt;');

        return `
            <div class="bar-row">
                <span class="bar-name" title="${safeName}">${safeName}</span>
                <div class="bar-track"><div class="bar-line ${colorClass}" style="width: ${widthPercent}%;"></div></div>
                <span class="bar-count">${row.count}</span>
            </div>
        `;
    }).join('');
}

// =========================================================================
// 6. بطاقة "النمو" — نمو إجمالي عدد الموظفين التراكمي عبر آخر 30/60 يوماً
//    (بدلاً من الرسم الوهمي الثابت)، بناءً على حقل created_at بجدول employees
//
//    ⚠️ يُجلب الجدول بالكامل الآن على دفعات (fetchAllRows) بدل طلب واحد، حتى
//    لا يُقتطع صامتاً عند تجاوز حد الـ1000 صف من سوبابيس فيظهر رسم نمو خاطئ.
// =========================================================================
async function loadEmployeeGrowthChart(daysRange) {
    const container = document.getElementById('growthChartContainer');
    if (!container) return;

    try {
        const employees = await fetchAllRows((from, to) =>
            dbClient.from('employees').select('created_at')
                .order('id', { ascending: true })
                .range(from, to)
        );

        // نطاق التاريخ المطلوب: من (اليوم - عدد الأيام + 1) وحتى اليوم، بدقة يوم كامل
        const rangeEnd = startOfDay(new Date());
        const rangeStart = addDays(rangeEnd, -(daysRange - 1));

        // عدد الموظفين الذين انضموا قبل بداية النطاق (نقطة الانطلاق التراكمية)
        let runningTotal = employees.filter(emp => {
            if (!emp.created_at) return false;
            const createdDay = startOfDay(new Date(emp.created_at));
            return createdDay < rangeStart;
        }).length;

        // فهرسة عدد الموظفين الجدد لكل يوم ضمن النطاق (بالتاريخ كسلسلة نصية مفتاحاً)
        const newCountByDayKey = new Map();
        employees.forEach(emp => {
            if (!emp.created_at) return;
            const createdDay = startOfDay(new Date(emp.created_at));
            if (createdDay < rangeStart || createdDay > rangeEnd) return;
            const key = dayKey(createdDay);
            newCountByDayKey.set(key, (newCountByDayKey.get(key) || 0) + 1);
        });

        // بناء السلسلة التراكمية يوماً بيوم عبر كامل النطاق
        const series = [];
        for (let d = new Date(rangeStart); d <= rangeEnd; d = addDays(d, 1)) {
            runningTotal += newCountByDayKey.get(dayKey(d)) || 0;
            series.push({ date: new Date(d), total: runningTotal });
        }

        renderGrowthChart(series);

    } catch (error) {
        console.error('فشل تحميل بيانات نمو الموظفين:', error);
        container.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon" data-icon="chart-down"></span>
                <p>تعذّر تحميل بيانات النمو</p>
            </div>
        `;
        applyIconPlaceholders(container);
    }
}

function startOfDay(d) {
    const copy = new Date(d);
    copy.setHours(0, 0, 0, 0);
    return copy;
}
function addDays(d, amount) {
    const copy = new Date(d);
    copy.setDate(copy.getDate() + amount);
    return copy;
}
function dayKey(d) {
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
function formatShortDate(d) {
    return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

function renderGrowthChart(series) {
    const container = document.getElementById('growthChartContainer');
    if (!container) return;

    if (!series || series.length === 0 || series[series.length - 1].total === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon" data-icon="chart-down"></span>
                <p>لا توجد بيانات لعرضها</p>
            </div>
        `;
        applyIconPlaceholders(container);
        return;
    }

    const CHART_WIDTH = 700;
    const CHART_HEIGHT = 140;
    const TOP_PADDING = 10;

    const values = series.map(p => p.total);
    const maxValue = Math.max(...values);
    const minValue = Math.min(...values);
    const valueRange = maxValue - minValue;

    const points = series.map((point, index) => {
        const x = series.length === 1 ? 0 : (index / (series.length - 1)) * CHART_WIDTH;
        const y = valueRange === 0
            ? CHART_HEIGHT - TOP_PADDING
            : CHART_HEIGHT - TOP_PADDING - ((point.total - minValue) / valueRange) * (CHART_HEIGHT - TOP_PADDING * 2);
        return { x, y };
    });

    const lineCommands = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const areaCommands = `M0,${CHART_HEIGHT} L${points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L')} L${CHART_WIDTH},${CHART_HEIGHT} Z`;

    // نختار حتى 7 نقاط موزّعة بالتساوي لعرضها كتسميات على المحور الأفقي
    const labelCount = Math.min(7, series.length);
    const labelIndexes = Array.from({ length: labelCount }, (_, i) =>
        Math.round((i / (labelCount - 1 || 1)) * (series.length - 1))
    );
    const uniqueLabelIndexes = Array.from(new Set(labelIndexes));

    container.innerHTML = `
        <svg class="growth-svg" viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" preserveAspectRatio="none">
            <defs>
                <linearGradient id="growthAreaGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="rgba(241, 196, 15, 0.35)" />
                    <stop offset="100%" stop-color="rgba(241, 196, 15, 0)" />
                </linearGradient>
            </defs>
            <path d="${areaCommands}" fill="url(#growthAreaGradient)"></path>
            <path d="${lineCommands}" fill="none" stroke="#f1c40f" stroke-width="3" vector-effect="non-scaling-stroke"></path>
        </svg>
        <div class="chart-axis-x">
            ${uniqueLabelIndexes.map(i => `<span>${formatShortDate(series[i].date)}</span>`).join('')}
        </div>
    `;
}

// =========================================================================
// 7. بطاقة "النشاط الأخير" — تدمج أحدث الأحداث من عدة جداول (شركات جديدة،
//    موظفون جدد، عمليات ربط موظفين بشركات، مهام جديدة) في خط زمني واحد مرتّب
//    تنازلياً حسب created_at، بدلاً من حالة "لا توجد بيانات" الثابتة سابقاً.
//    ⚠️ لا يوجد جدول "سجل نشاط" (activity log) مخصص بقاعدة البيانات، لذا يُبنى
//    هذا الخط الزمني ديناميكياً من أحدث الصفوف بكل جدول ذي صلة — نجلب فقط آخر
//    عدد محدود من كل مصدر (limit)، فلا حاجة هنا لآلية fetchAllRows/التقسيم على
//    دفعات المستخدمة بشاشات أخرى.
// =========================================================================
const RECENT_ACTIVITY_PER_SOURCE_LIMIT = 6;
const RECENT_ACTIVITY_DISPLAY_LIMIT = 5;

async function loadRecentActivity() {
    const container = document.getElementById('recentActivityList');
    if (!container) return;

    try {
        const [companiesRes, employeesRes, linksRes, tasksRes] = await Promise.all([
            dbClient.from('companies').select('name, created_at')
                .order('created_at', { ascending: false }).limit(RECENT_ACTIVITY_PER_SOURCE_LIMIT),
            dbClient.from('employees').select('name, created_at')
                .order('created_at', { ascending: false }).limit(RECENT_ACTIVITY_PER_SOURCE_LIMIT),
            dbClient.from('employee_links').select('link_type, created_at, employees(name), companies(name)')
                .order('created_at', { ascending: false }).limit(RECENT_ACTIVITY_PER_SOURCE_LIMIT),
            dbClient.from('tasks').select('title, created_at')
                .order('created_at', { ascending: false }).limit(RECENT_ACTIVITY_PER_SOURCE_LIMIT)
        ]);

        if (companiesRes.error) throw companiesRes.error;
        if (employeesRes.error) throw employeesRes.error;
        if (linksRes.error) throw linksRes.error;
        if (tasksRes.error) throw tasksRes.error;

        const events = [];

        (companiesRes.data || []).forEach(row => {
            if (!row.created_at) return;
            events.push({ icon: 'building', text: `تمت إضافة شركة جديدة: ${row.name || '----'}`, timestamp: row.created_at });
        });

        (employeesRes.data || []).forEach(row => {
            if (!row.created_at) return;
            events.push({ icon: 'person', text: `تمت إضافة موظف جديد: ${row.name || '----'}`, timestamp: row.created_at });
        });

        (linksRes.data || []).forEach(row => {
            if (!row.created_at) return;
            const empName = row.employees ? row.employees.name : null;
            const compName = row.companies ? row.companies.name : null;
            const verb = row.link_type === 'اضافة' ? 'تم ربط' : 'تم تحديث ربط';
            events.push({ icon: 'link', text: `${verb} الموظف ${empName || '----'} بشركة ${compName || '----'}`, timestamp: row.created_at });
        });

        (tasksRes.data || []).forEach(row => {
            if (!row.created_at) return;
            events.push({ icon: 'clipboard', text: `تمت إضافة مهمة جديدة: ${row.title || '----'}`, timestamp: row.created_at });
        });

        events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        renderRecentActivity(events.slice(0, RECENT_ACTIVITY_DISPLAY_LIMIT));

    } catch (error) {
        console.error('فشل تحميل النشاط الأخير:', error);
        container.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon" data-icon="chart-down"></span>
                <p>تعذّر تحميل النشاط الأخير</p>
            </div>
        `;
        applyIconPlaceholders(container);
    }
}

function renderRecentActivity(events) {
    const container = document.getElementById('recentActivityList');
    if (!container) return;

    if (!events || events.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon" data-icon="chart-down"></span>
                <p>لا توجد بيانات لعرضها</p>
            </div>
        `;
        applyIconPlaceholders(container);
        return;
    }

    container.innerHTML = events.map(ev => `
        <div class="activity-row">
            <span class="activity-icon" data-icon="${ev.icon}"></span>
            <div class="activity-info">
                <span class="activity-text">${escapeActivityHtml(ev.text)}</span>
                <span class="activity-time">${formatRelativeTime(ev.timestamp)}</span>
            </div>
        </div>
    `).join('');
    applyIconPlaceholders(container);
}

function escapeActivityHtml(str) {
    return String(str).replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ⏱️ تنسيق فرق الوقت بصيغة نسبية مقروءة بالعربية (منذ لحظات / منذ س ساعة / منذ يوم...)
function formatRelativeTime(timestamp) {
    const now = new Date();
    const then = new Date(timestamp);
    const diffMinutes = Math.floor((now - then) / 60000);

    if (diffMinutes < 1) return 'منذ لحظات';
    if (diffMinutes < 60) return `منذ ${diffMinutes} ${diffMinutes === 1 ? 'دقيقة' : 'دقائق'}`;

    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `منذ ${diffHours} ${diffHours === 1 ? 'ساعة' : 'ساعات'}`;

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `منذ ${diffDays} ${diffDays === 1 ? 'يوم' : 'أيام'}`;

    return then.toLocaleDateString('ar');
}

// =========================================================================
// 8. تحديد نطاق دور المستخدم الحالي، وتبديل عرض اللوحة تبعاً له:
//    - دور "company": تُعرض لوحة تحكم مخصّصة لشركة/شركات هذا المستخدم فقط
//      (companies.user_id = المستخدم الحالي)، بدل لوحة المسؤول العامة.
//    - أي دور آخر (super_admin/admin/employee...): تبقى لوحة المسؤول العامة
//      كما كانت (بلا أي تغيير بالسلوك السابق).
//    نفس نمط تحديد النطاق المستخدم مسبقاً بـ claude/support.js وclaude/tasks.js.
// =========================================================================
let currentUserScope = { role: null, companyIds: null, userId: null, ownedCompanies: [] };

async function loadCurrentUserScopeAndRenderDashboard() {
    try {
        const { data: { session } } = await dbClient.auth.getSession();
        if (!session) {
            // حارس الجلسة الفعلي موجود بدالة checkUserAuthentication/app-core.js؛
            // هنا فقط نتجنّب أي استعلام إضافي بلا جلسة فعلية
            renderAdminDashboardView();
            return;
        }

        const { data: profileRow } = await dbClient
            .from('users')
            .select('role')
            .eq('id', session.user.id)
            .maybeSingle();

        const role = profileRow ? profileRow.role : null;

        if (role === 'company') {
            const { data: ownedCompanies, error: companiesError } = await dbClient
                .from('companies')
                .select('id, name')
                .eq('user_id', session.user.id)
                .order('created_at', { ascending: true });

            if (companiesError) throw companiesError;

            currentUserScope = {
                role,
                companyIds: (ownedCompanies || []).map(c => c.id),
                userId: session.user.id,
                ownedCompanies: ownedCompanies || []
            };
            renderCompanyDashboardView();
        } else if (role === 'employee') {
            // 👤 لوحة تحكم مخصّصة لهذا الموظف فقط: نحتاج أولاً معرّف سجله بجدول
            // employees (employees.id)، وليس معرّف حسابه بجدول users مباشرة —
            // فجدول tasks.assigned_to يشير لـ employees.id، بنفس الربط
            // المستخدم بشاشة "إدارة المهام" (tasks.js).
            const { data: employeeRow, error: employeeError } = await dbClient
                .from('employees')
                .select('id, name')
                .eq('user_id', session.user.id)
                .maybeSingle();

            if (employeeError) throw employeeError;

            currentUserScope = {
                role,
                companyIds: null,
                userId: session.user.id,
                ownedCompanies: [],
                employeeId: employeeRow ? employeeRow.id : null,
                employeeName: employeeRow ? employeeRow.name : null
            };
            renderEmployeeDashboardView();
        } else {
            currentUserScope = { role, companyIds: null, userId: session.user.id, ownedCompanies: [] };
            renderAdminDashboardView();
        }
    } catch (error) {
        console.error('تعذّر تحديد نطاق صلاحيات المستخدم الحالي بلوحة التحكم:', error);
        // احتياط آمن: عند أي خطأ نعرض لوحة المسؤول العامة كما كانت سابقاً
        renderAdminDashboardView();
    }
}

function renderAdminDashboardView() {
    const adminView = document.getElementById('adminDashboardView');
    const companyView = document.getElementById('companyDashboardView');
    const employeeView = document.getElementById('employeeDashboardView');
    if (companyView) companyView.style.display = 'none';
    if (employeeView) employeeView.style.display = 'none';
    if (adminView) adminView.style.display = '';

    fetchAndUpdateCounters();
    loadTopCompaniesByEmployeeCount();
    loadRecentActivity();
    loadEmployeeGrowthChart(getSelectedDaysRange());
}

function renderCompanyDashboardView() {
    const adminView = document.getElementById('adminDashboardView');
    const companyView = document.getElementById('companyDashboardView');
    const employeeView = document.getElementById('employeeDashboardView');
    if (adminView) adminView.style.display = 'none';
    if (employeeView) employeeView.style.display = 'none';
    if (companyView) companyView.style.display = '';

    loadCompanyStats();
    loadCompanyCompaniesList();
    loadCompanyRecentLogins();
}

// -------------------------------------------------------------------------
// 8د. لوحة تحكم الموظف (دور employee فقط) — بطاقات إحصائيات + جدول لمهام هذا
//     الموظف فقط (tasks.assigned_to = employees.id الخاص به)، مقصورة على
//     آخر 14 يوماً فقط (بحسب created_at) بناءً على طلب المستخدم صراحة.
// -------------------------------------------------------------------------
const EMPLOYEE_DASHBOARD_DAYS_RANGE = 14;

const EMPLOYEE_TASK_TYPE_BADGE = {
    'مسندة': 'badge-type-assigned',
    'مستقلة': 'badge-type-standalone',
    'روتينية': 'badge-type-routine'
};
const EMPLOYEE_TASK_STATUS_BADGE = {
    'قيد الانتظار': 'badge-status-pending',
    'قيد التنفيذ': 'badge-status-inprogress',
    'مكتملة': 'badge-status-done'
};

function renderEmployeeDashboardView() {
    const adminView = document.getElementById('adminDashboardView');
    const companyView = document.getElementById('companyDashboardView');
    const employeeView = document.getElementById('employeeDashboardView');
    if (adminView) adminView.style.display = 'none';
    if (companyView) companyView.style.display = 'none';
    if (employeeView) employeeView.style.display = '';

    const subtitleEl = document.getElementById('employeeDashboardSubtitle');
    if (subtitleEl && currentUserScope.employeeName) {
        subtitleEl.textContent = `أهلاً بك ${currentUserScope.employeeName}، إليك مهامك خلال آخر ${EMPLOYEE_DASHBOARD_DAYS_RANGE} يوماً`;
    }

    loadEmployeeTasksAndRender();
}

async function loadEmployeeTasksAndRender() {
    const tableBody = document.getElementById('employeeTasksTableBody');
    const employeeId = currentUserScope.employeeId;

    const statIds = ['empStatCompleted', 'empStatInProgress', 'empStatPending', 'empStatTotal'];

    // حالة نادرة: مستخدم بدور "employee" بلا سجل موظف فعلي مرتبط بحسابه بجدول
    // employees (user_id) — نعرض حالة فارغة واضحة بدل ترك الجدول عالقاً على
    // "جاري التحميل..." للأبد
    if (!employeeId) {
        statIds.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '0'; });
        if (tableBody) {
            tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:30px; color:#94a3b8;">تعذّر العثور على سجل موظف مرتبط بحسابك الحالي.</td></tr>`;
        }
        return;
    }

    try {
        // 📅 مقصورة على آخر 14 يوماً فقط (بحسب created_at) — بطلب صريح من المستخدم
        const rangeStart = new Date();
        rangeStart.setHours(0, 0, 0, 0);
        rangeStart.setDate(rangeStart.getDate() - (EMPLOYEE_DASHBOARD_DAYS_RANGE - 1));

        const tasks = await fetchAllRows((from, to) =>
            dbClient.from('tasks').select('*')
                .eq('assigned_to', employeeId)
                .gte('created_at', rangeStart.toISOString())
                .order('created_at', { ascending: false })
                .order('id', { ascending: false })
                .range(from, to)
        );

        // 🏢 أسماء الشركات المرتبطة بمهام هذا الموظف فقط ضمن آخر 14 يوماً (استعلام
        // واحد مُقيَّد بمعرّفات الشركات الفعلية الظاهرة بمهامه، بدل جلب جدول
        // الشركات كاملاً كما تفعل شاشة "إدارة المهام" العامة)
        const companyIds = Array.from(new Set(tasks.map(t => t.company_id).filter(id => id != null)));
        let companyNameById = new Map();
        if (companyIds.length > 0) {
            const { data: companiesData, error: companiesError } = await dbClient
                .from('companies')
                .select('id, name')
                .in('id', companyIds);
            if (companiesError) throw companiesError;
            companyNameById = new Map((companiesData || []).map(c => [String(c.id), c.name]));
        }

        const completed = tasks.filter(t => t.status === 'مكتملة').length;
        const inProgress = tasks.filter(t => t.status === 'قيد التنفيذ').length;
        const pending = tasks.filter(t => t.status === 'قيد الانتظار').length;

        const completedEl = document.getElementById('empStatCompleted');
        const inProgressEl = document.getElementById('empStatInProgress');
        const pendingEl = document.getElementById('empStatPending');
        const totalEl = document.getElementById('empStatTotal');
        if (completedEl) completedEl.textContent = completed;
        if (inProgressEl) inProgressEl.textContent = inProgress;
        if (pendingEl) pendingEl.textContent = pending;
        if (totalEl) totalEl.textContent = tasks.length;

        renderEmployeeTasksTable(tasks, companyNameById);

    } catch (error) {
        console.error('فشل تحميل مهام الموظف الحالي بلوحة التحكم:', error);
        statIds.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '—'; });
        if (tableBody) {
            tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#ef4444; padding:20px;">تعذّر تحميل المهام: ${error.message}</td></tr>`;
        }
    }
}

function renderEmployeeTasksTable(tasks, companyNameById) {
    const tableBody = document.getElementById('employeeTasksTableBody');
    if (!tableBody) return;

    if (!tasks || tasks.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:30px; color:#94a3b8;">لا توجد مهام مُسندة إليك خلال آخر ${EMPLOYEE_DASHBOARD_DAYS_RANGE} يوماً.</td></tr>`;
        return;
    }

    tableBody.innerHTML = tasks.map(task => {
        const isCompleted = task.status === 'مكتملة';
        const typeBadgeClass = EMPLOYEE_TASK_TYPE_BADGE[task.type] || 'badge-type-standalone';
        const statusBadgeClass = EMPLOYEE_TASK_STATUS_BADGE[task.status] || 'badge-status-pending';
        const companyName = task.company_id != null ? (companyNameById.get(String(task.company_id)) || '—') : '—';

        let dateHtml = '—';
        if (task.start_date && task.due_date) {
            dateHtml = `${task.start_date} → ${task.due_date}`;
        } else if (task.due_date) {
            dateHtml = task.due_date;
        } else if (task.start_date) {
            dateHtml = `${task.start_date} →`;
        }

        return `
            <tr>
                <td><a href="view_task.html?id=${encodeURIComponent(task.id)}" class="task-title-cell task-title-link ${isCompleted ? 'completed' : ''}">${escapeActivityHtml(task.title || '')}</a></td>
                <td><span class="badge-task-type ${typeBadgeClass}">${escapeActivityHtml(task.type || '—')}</span></td>
                <td><span class="task-company-cell">${escapeActivityHtml(companyName)}</span></td>
                <td style="color:#475569;">${dateHtml}</td>
                <td style="text-align:center;"><span class="badge-task-status ${statusBadgeClass}">${escapeActivityHtml(task.status || '—')}</span></td>
            </tr>
        `;
    }).join('');
}

// 📅 تاريخ اليوم بصيغة YYYY-MM-DD (مطابقة لعمود attendance.date النصي)
function todayDateString() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// 🕛 بداية/نهاية اليوم الحالي بصيغة ISO (لمقارنة عمود tasks.created_at الزمني)
function getTodayRangeISO() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { startISO: start.toISOString(), endISO: end.toISOString() };
}

// -------------------------------------------------------------------------
// 8أ. بطاقة الإحصائيات الأربع: إجمالي الموظفين + حضور اليوم + غياب اليوم +
//     المهام الموزعة اليوم — كل ذلك مقصور على شركة/شركات المستخدم الحالي فقط
// -------------------------------------------------------------------------
async function loadCompanyStats() {
    const employeesEl = document.getElementById('companyEmployeesCounter');
    const presentEl = document.getElementById('companyPresentTodayCounter');
    const absentEl = document.getElementById('companyAbsentTodayCounter');
    const tasksEl = document.getElementById('companyTasksTodayCounter');

    const companyIds = currentUserScope.companyIds || [];
    if (companyIds.length === 0) {
        [employeesEl, presentEl, absentEl, tasksEl].forEach(el => { if (el) el.textContent = '0'; });
        return;
    }

    try {
        // 1) إجمالي الموظفين المرتبطين حالياً بشركة/شركات المستخدم (كل صف
        //    نشط بجدول employee_links يمثّل موظفاً واحداً مرتبطاً فعلياً الآن).
        //    ⚠️ روابط نشطة فقط: بعد أن أصبح "إنهاء ربط موظف" يُسجِّل تاريخ
        //    انتهاء بدل حذف السجل فعلياً، تبقى روابط الموظفين المُنهاة محفوظة
        //    بالجدول — بدون هذا الفلتر كان هذا العدد سيشمل موظفين منتهي
        //    ربطهم بالفعل بهذه الشركة/الشركات.
        const linksResult = await dbClient
            .from('employee_links')
            .select('employee_id')
            .in('company_id', companyIds)
            .or(`link_end_date.is.null,link_end_date.gte.${todayDateString()}`);
        if (linksResult.error) throw linksResult.error;

        const linkedEmployeeIds = Array.from(new Set((linksResult.data || []).map(r => r.employee_id).filter(Boolean)));
        if (employeesEl) employeesEl.textContent = linkedEmployeeIds.length;

        // 2) حضور/غياب اليوم لموظفي هذه الشركة/الشركات فقط (جدول attendance
        //    لا يملك عمود company_id مباشر، فالربط عبر قائمة الموظفين أعلاه)
        const today = todayDateString();
        if (linkedEmployeeIds.length > 0) {
            const [presentResult, absentResult] = await Promise.all([
                dbClient.from('attendance').select('*', { count: 'exact', head: true })
                    .eq('date', today).eq('status', 'حاضر').in('employee_id', linkedEmployeeIds),
                dbClient.from('attendance').select('*', { count: 'exact', head: true })
                    .eq('date', today).eq('status', 'غائب').in('employee_id', linkedEmployeeIds)
            ]);
            if (presentResult.error) throw presentResult.error;
            if (absentResult.error) throw absentResult.error;
            if (presentEl) presentEl.textContent = presentResult.count ?? 0;
            if (absentEl) absentEl.textContent = absentResult.count ?? 0;
        } else {
            if (presentEl) presentEl.textContent = '0';
            if (absentEl) absentEl.textContent = '0';
        }

        // 3) المهام الموزعة اليوم على شركة/شركات المستخدم (tasks.company_id مباشر)
        const { startISO, endISO } = getTodayRangeISO();
        const tasksResult = await dbClient
            .from('tasks')
            .select('*', { count: 'exact', head: true })
            .in('company_id', companyIds)
            .gte('created_at', startISO)
            .lt('created_at', endISO);
        if (tasksResult.error) throw tasksResult.error;
        if (tasksEl) tasksEl.textContent = tasksResult.count ?? 0;

    } catch (error) {
        console.error('فشل تحميل إحصائيات لوحة الشركة:', error);
        [employeesEl, presentEl, absentEl, tasksEl].forEach(el => { if (el) el.textContent = '—'; });
    }
}

// -------------------------------------------------------------------------
// 8ب. بطاقة "الشركات التابعة لك" — الشركات المملوكة لحساب المستخدم الحالي
//     (تم جلبها مسبقاً ضمن loadCurrentUserScopeAndRenderDashboard، فلا حاجة
//     لاستعلام إضافي هنا)
// -------------------------------------------------------------------------
function loadCompanyCompaniesList() {
    const container = document.getElementById('companyListContainer');
    if (!container) return;

    const companies = currentUserScope.ownedCompanies || [];

    if (companies.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon" data-icon="building"></span>
                <p>لا توجد شركات مرتبطة بحسابك</p>
            </div>
        `;
        applyIconPlaceholders(container);
        return;
    }

    container.innerHTML = companies.map(c => `
        <div class="activity-row">
            <span class="activity-icon" data-icon="building"></span>
            <div class="activity-info">
                <span class="activity-text">${escapeActivityHtml(c.name || '----')}</span>
            </div>
        </div>
    `).join('');
    applyIconPlaceholders(container);
}

// -------------------------------------------------------------------------
// 8ج. بطاقة "آخر عمليات تسجيل الدخول" — آخر 5 عمليات دخول ناجحة لحساب
//     المستخدم الحالي، من جدول login_logs (يُسجَّل سطر بهذا الجدول تلقائياً
//     عند كل تسجيل دخول ناجح من شاشتي login-companies.html / login-employee.html
//     / login.html — انظر التعليق أعلى دالة تسجيل الدخول بكل من تلك الملفات).
//
//     ⚠️ يتطلب هذا الجدول إنشاءه يدوياً بسوبابيس (SQL Editor) — راجع رسالة
//     الشرح المرفقة مع هذا التحديث؛ ريثما يُنشأ الجدول، تُعرض هذه البطاقة
//     حالة "تعذّر تحميل السجل" بدل توقف الصفحة عن العمل.
//
//     ⚠️ التاريخ/الوقت المعروض هنا فعلي دائماً (وليس نصاً ثابتاً): يجمع بين
//     الوقت النسبي المقروء (formatRelativeTime) والتاريخ/الوقت الكامل الفعلي
//     (logged_in_at بصيغة toLocaleString) لكل عملية دخول حقيقية.
// -------------------------------------------------------------------------
async function loadCompanyRecentLogins() {
    const container = document.getElementById('companyRecentLoginsList');
    if (!container) return;

    try {
        const { data, error } = await dbClient
            .from('login_logs')
            .select('logged_in_at')
            .eq('user_id', currentUserScope.userId)
            .order('logged_in_at', { ascending: false })
            .limit(5);

        if (error) throw error;

        if (!data || data.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <span class="empty-icon" data-icon="clock"></span>
                    <p>لا يوجد سجل دخول بعد</p>
                </div>
            `;
            applyIconPlaceholders(container);
            return;
        }

        container.innerHTML = data.map(row => `
            <div class="activity-row">
                <span class="activity-icon" data-icon="lock"></span>
                <div class="activity-info">
                    <span class="activity-text">تسجيل دخول ناجح</span>
                    <span class="activity-time">${formatRelativeTime(row.logged_in_at)} — ${new Date(row.logged_in_at).toLocaleString('ar')}</span>
                </div>
            </div>
        `).join('');
        applyIconPlaceholders(container);

    } catch (error) {
        console.error('تعذّر تحميل سجل تسجيل الدخول:', error);
        container.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon" data-icon="chart-down"></span>
                <p>تعذّر تحميل سجل تسجيل الدخول. تأكد من إنشاء جدول login_logs بسوبابيس.</p>
            </div>
        `;
        applyIconPlaceholders(container);
    }
}
