/* =========================================================================
 * routes/routes.js — خريطة الصفحات المركزية
 *
 * كل صفحة لها اسم (مثل 'dashboard') ومسارها من جذر الموقع. بدل كتابة مسار نسبي
 * يدوياً في كل ملف، استخدم:
 *   Routes.url('employees')                     -> الرابط الكامل للصفحة
 *   Routes.url('view_employee', { id: 5 })      -> ...view_employee.html?id=5
 *   Routes.go('dashboard')                      -> انتقال (location.href)
 *   Routes.replace('login')                     -> انتقال بدون حفظه في السجل
 * إذا نقلت صفحة لمكان آخر، عدّل سطرها هنا فقط.
 * ========================================================================= */
(function () {
    var ROOT = new URL('../', document.currentScript.src).href;

    var ROUTES = {
        "aboutus": "aboutus.html",
        "add_attendance": "app/pages/add_attendance.html",
        "add_company": "app/pages/add_company.html",
        "add_employee": "app/pages/add_employee.html",
        "add_invoice": "app/pages/add_invoice.html",
        "add_job": "app/pages/add_job.html",
        "add_task": "app/pages/add_task.html",
        "add_ticket": "app/pages/add_ticket.html",
        "add_user": "app/pages/add_user.html",
        "attendance-report": "app/pages/attendance-report.html",
        "attendance": "app/pages/attendance.html",
        "attendance_bulk": "app/pages/attendance_bulk.html",
        "blacklist": "app/pages/blacklist.html",
        "change-password": "app/pages/change-password.html",
        "collection_types": "app/pages/collection_types.html",
        "collections-report": "app/pages/collections-report.html",
        "collections": "app/pages/collections.html",
        "companies-collections-report": "app/pages/companies-collections-report.html",
        "companies-links-report": "app/pages/companies-links-report.html",
        "companies-report": "app/pages/companies-report.html",
        "companies": "app/pages/companies.html",
        "dashboard": "app/pages/dashboard.html",
        "edit_attendance": "app/pages/edit_attendance.html",
        "edit_company": "app/pages/edit_company.html",
        "edit_employee": "app/pages/edit_employee.html",
        "edit_employee_link": "app/pages/edit_employee_link.html",
        "edit_job": "app/pages/edit_job.html",
        "employee-collection-details": "app/pages/employee-collection-details.html",
        "employee-report": "app/pages/employee-report.html",
        "employee_links": "app/pages/employee_links.html",
        "employee_signup_requests": "app/pages/employee_signup_requests.html",
        "employees": "app/pages/employees.html",
        "end_employee_link": "app/pages/end_employee_link.html",
        "invoices": "app/pages/invoices.html",
        "job-titles": "app/pages/job-titles.html",
        "job_tasks": "app/pages/job_tasks.html",
        "link_employee": "app/pages/link_employee.html",
        "notifications": "app/pages/notifications.html",
        "profile": "app/pages/profile.html",
        "roles": "app/pages/roles.html",
        "settings": "app/pages/settings.html",
        "support": "app/pages/support.html",
        "tasks-report": "app/pages/tasks-report.html",
        "tasks": "app/pages/tasks.html",
        "tasks_bulk": "app/pages/tasks_bulk.html",
        "users": "app/pages/users.html",
        "view_company": "app/pages/view_company.html",
        "view_employee": "app/pages/view_employee.html",
        "view_employee_link": "app/pages/view_employee_link.html",
        "view_invoice": "app/pages/view_invoice.html",
        "view_report": "app/pages/view_report.html",
        "view_task": "app/pages/view_task.html",
        "contact-us": "contact-us.html",
        "forgot-password": "forgot-password.html",
        "index": "index.html",
        "login-companies": "login-companies.html",
        "login-employee": "login-employee.html",
        "login": "login.html",
        "privacy-policy": "privacy-policy.html",
        "register-companies": "register-companies.html",
        "register-employee": "register-employee.html",
        "reset-password": "reset-password.html",
        "terms": "terms.html"
    };

    function url(name, params) {
        if (!Object.prototype.hasOwnProperty.call(ROUTES, name)) {
            throw new Error('Unknown route: ' + name);
        }
        var u = ROOT + ROUTES[name];
        if (params) {
            var q = new URLSearchParams(params).toString();
            if (q) u += '?' + q;
        }
        return u;
    }

    window.Routes = {
        ROOT: ROOT,
        map: ROUTES,
        url: url,
        go: function (name, params) { window.location.href = url(name, params); },
        replace: function (name, params) { window.location.replace(url(name, params)); }
    };
})();
