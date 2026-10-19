// =========================================================================
// row-actions.js — مكوّن مشترك لعمود "الإجراءات" بالجداول:
//   • زر أيقونة العين لعرض البيانات (RowActions.viewBtnHtml)
//   • زر الثلاث نقاط ⋮ تفتح قائمة عائمة بباقي الخيارات (RowActions.moreBtnHtml / openMenu)
//   • صف الجدول بالكامل قابل للنقر (RowActions.makeRowClickable)
// القائمة عائمة (position: fixed) ومُلحقة بـ body حتى لا تُقصّ داخل حاوية الجدول.
// الأنماط تُحقن من هنا، فلا تعتمد على أي ملف CSS مشترك.
// كل عنصر بالقائمة يحمل data-perm الخاص به ويُطبَّق عليه Permissions.applyButtonGating.
// =========================================================================
(function () {
    const MORE_ICON_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>';

    let menuEl = null;
    let anchorBtn = null;
    let handlersBound = false;

    function injectStyles() {
        if (document.getElementById('rowActionsStyles')) return;
        const style = document.createElement('style');
        style.id = 'rowActionsStyles';
        style.textContent = `
            tr.ra-row-clickable { cursor: pointer; transition: background-color 0.12s ease; }
            tr.ra-row-clickable:hover { background-color: #f8fafc; }

            .ra-actions-cell { display: inline-flex; align-items: center; justify-content: center; gap: 8px; }

            .ra-view-btn, .ra-more-btn {
                display: inline-flex; align-items: center; justify-content: center;
                width: 32px; height: 32px; padding: 0; border-radius: 6px; cursor: pointer;
                font-family: inherit; transition: background-color 0.15s ease, border-color 0.15s ease;
            }
            .ra-view-btn { background-color: #fff7ed; color: #c2410c; border: 1px solid #fed7aa; }
            .ra-view-btn:hover { background-color: #ffedd5; }
            .ra-view-btn svg { width: 17px; height: 17px; flex-shrink: 0; }

            .ra-more-btn { background: #ffffff; color: #475569; border: 1px solid #e2e8f0; }
            .ra-more-btn:hover, .ra-more-btn.open { background-color: #f1f5f9; border-color: #cbd5e1; }
            .ra-more-btn svg { width: 18px; height: 18px; }

            #raRowMenu {
                position: fixed; z-index: 3000; min-width: 190px;
                background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px;
                box-shadow: 0 10px 28px rgba(15, 23, 42, 0.16);
                padding: 6px; display: none; direction: rtl;
            }
            #raRowMenu.open { display: block; }
            #raRowMenu .ra-menu-item {
                display: flex; align-items: center; gap: 10px; width: 100%;
                background: none; border: none; border-radius: 6px;
                padding: 9px 12px; font-size: 13.5px; font-weight: 600;
                font-family: inherit; color: #334155; cursor: pointer; text-align: start;
            }
            #raRowMenu .ra-menu-item:hover { background-color: #f1f5f9; }
            #raRowMenu .ra-menu-item svg { width: 16px; height: 16px; flex-shrink: 0; }
            #raRowMenu .ra-menu-item.danger { color: #dc2626; }
            #raRowMenu .ra-menu-item.danger:hover { background-color: #fef2f2; }
            #raRowMenu .ra-menu-divider { height: 1px; background: #f1f5f9; margin: 4px 0; }
        `;
        document.head.appendChild(style);
    }

    function closeMenu() {
        if (!menuEl) return;
        menuEl.classList.remove('open');
        if (anchorBtn) anchorBtn.classList.remove('open');
        anchorBtn = null;
    }

    function getMenu() {
        if (menuEl) return menuEl;
        injectStyles();
        menuEl = document.createElement('div');
        menuEl.id = 'raRowMenu';
        menuEl.setAttribute('role', 'menu');
        document.body.appendChild(menuEl);

        if (!handlersBound) {
            handlersBound = true;
            document.addEventListener('click', (e) => {
                if (!menuEl.classList.contains('open')) return;
                if (menuEl.contains(e.target)) return;
                if (anchorBtn && anchorBtn.contains(e.target)) return;
                closeMenu();
            });
            document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
            window.addEventListener('resize', closeMenu);
            window.addEventListener('scroll', closeMenu, true);
        }
        return menuEl;
    }

    // items: [{ perm, icon, label, danger, run }, { divider: true, perm }]
    function openMenu(btn, items) {
        const menu = getMenu();

        // الضغط على نفس الزر مرة ثانية يغلق القائمة
        if (menu.classList.contains('open') && anchorBtn === btn) {
            closeMenu();
            return;
        }
        closeMenu();

        menu.innerHTML = '';
        items.forEach(item => {
            if (item.divider) {
                const div = document.createElement('div');
                div.className = 'ra-menu-divider';
                if (item.perm) div.setAttribute('data-perm', item.perm);
                menu.appendChild(div);
                return;
            }
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'ra-menu-item' + (item.danger ? ' danger' : '');
            b.setAttribute('role', 'menuitem');
            if (item.perm) b.setAttribute('data-perm', item.perm);
            b.innerHTML = `${item.icon || ''}<span>${item.label}</span>`;
            b.addEventListener('click', (e) => {
                e.stopPropagation();
                closeMenu();
                item.run();
            });
            menu.appendChild(b);
        });

        if (window.Permissions && Permissions.applyButtonGating) Permissions.applyButtonGating(menu);

        // قياس القائمة ثم وضعها بجانب الزر مع إبقائها داخل الشاشة
        menu.style.visibility = 'hidden';
        menu.classList.add('open');
        const btnRect = btn.getBoundingClientRect();
        const menuRect = menu.getBoundingClientRect();

        let left = btnRect.left;
        if (left + menuRect.width > window.innerWidth - 8) left = window.innerWidth - menuRect.width - 8;
        if (left < 8) left = 8;

        let top = btnRect.bottom + 4;
        if (top + menuRect.height > window.innerHeight - 8) top = btnRect.top - menuRect.height - 4;
        if (top < 8) top = 8;

        menu.style.left = left + 'px';
        menu.style.top = top + 'px';
        menu.style.visibility = 'visible';

        btn.classList.add('open');
        anchorBtn = btn;
    }

    function viewBtnHtml(perm, title) {
        const icon = (window.ICONS && ICONS.eye) ? ICONS.eye : '👁';
        return `<button type="button" class="ra-view-btn" ${perm ? `data-perm="${perm}"` : ''} title="${title}" aria-label="${title}">${icon}</button>`;
    }

    function moreBtnHtml(perm) {
        return `<button type="button" class="ra-more-btn" ${perm ? `data-perm="${perm}"` : ''} title="المزيد من الخيارات" aria-haspopup="menu" aria-label="المزيد من الخيارات">${MORE_ICON_SVG}</button>`;
    }

    // يربط أزرار الصف (view/more) ويجعل الصف كله قابلاً للنقر
    function bindRow(tr, { onView, getMenuItems, rowTitle }) {
        injectStyles();
        const viewBtn = tr.querySelector('.ra-view-btn');
        if (viewBtn && onView) {
            viewBtn.addEventListener('click', (e) => { e.stopPropagation(); closeMenu(); onView(); });
        }
        const moreBtn = tr.querySelector('.ra-more-btn');
        if (moreBtn && getMenuItems) {
            moreBtn.addEventListener('click', (e) => { e.stopPropagation(); openMenu(moreBtn, getMenuItems()); });
        }
        if (onView) {
            tr.classList.add('ra-row-clickable');
            if (rowTitle) tr.title = rowTitle;
            tr.addEventListener('click', (e) => {
                if (e.target.closest('button, a, input, select, textarea')) return;
                onView();
            });
        }
    }

    window.RowActions = {
        injectStyles,
        closeMenu,
        openMenu,
        viewBtnHtml,
        moreBtnHtml,
        bindRow,
        MORE_ICON_SVG
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectStyles);
    else injectStyles();
})();
