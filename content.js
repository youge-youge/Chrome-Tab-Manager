(() => {
  'use strict';

  if (document.getElementById('__tm_host__')) return;

  /* ── Shadow DOM setup ─────────────────────────────────────────── */
  const host = document.createElement('div');
  host.id = '__tm_host__';
  host.style.cssText = 'all:initial!important;position:fixed!important;z-index:2147483646!important;';
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  const styleLink = document.createElement('link');
  styleLink.rel = 'stylesheet';
  styleLink.href = chrome.runtime.getURL('content.css');
  shadow.appendChild(styleLink);

  /* ── State ────────────────────────────────────────────────────── */
  let allTabs     = [];
  let selectedIds = new Set();
  let query       = '';
  let panelOpen   = false;
  let pending     = null;   // { timer, tick, toastEl }

  /* ── Tiny helpers ─────────────────────────────────────────────── */
  const mk  = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
  const esc = s => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const $   = id => shadow.getElementById(id);

  function hl(text, q) {
    if (!q) return esc(text);
    const re = new RegExp(esc(q).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'gi');
    return esc(text).replace(re, m => `<span class="hl">${m}</span>`);
  }

  /* ── Tab helpers ──────────────────────────────────────────────── */
  function domain(tab) {
    try {
      const u = tab.url || '';
      if (!u || u === 'chrome://newtab/') return '__blank__';
      if (u.startsWith('chrome://') || u.startsWith('chrome-extension://')) return '__chrome__';
      if (u.startsWith('about:') || u.startsWith('edge://')) return '__browser__';
      return new URL(u).hostname || '__unknown__';
    } catch { return '__unknown__'; }
  }
  function domainLabel(d) {
    return { '__blank__': '空白页 / New Tab', '__chrome__': 'Chrome 内置页', '__browser__': '浏览器内置页', '__unknown__': '其他' }[d] || d;
  }
  function fav(tab) {
    if (tab.favIconUrl && tab.favIconUrl.startsWith('http')) return tab.favIconUrl;
    try { const h = new URL(tab.url).hostname; return h ? `https://www.google.com/s2/favicons?domain=${h}&sz=32` : ''; } catch { return ''; }
  }
  function groupBy(tabs) {
    const m = new Map();
    for (const t of tabs) {
      const d = domain(t);
      if (!m.has(d)) m.set(d, []);
      m.get(d).push(t);
    }
    return new Map([...m.entries()].sort(([a,at],[b,bt]) => {
      const as = a.startsWith('__'), bs = b.startsWith('__');
      if (as !== bs) return as ? 1 : -1;
      return bt.length - at.length;
    }));
  }

  /* ── FAB ──────────────────────────────────────────────────────── */
  const fab = mk('button', 'fab');
  fab.title = 'Tab Manager';
  fab.innerHTML = `<span class="fab-icon">⚡</span><span class="fab-badge" id="fab-badge">0</span>`;

  // Drag
  let drag = false, dox = 0, doy = 0, dMoved = false;
  const savedPos = (() => { try { return JSON.parse(localStorage.getItem('__tm_p__') || 'null'); } catch { return null; } })();
  if (savedPos) { fab.style.cssText = `right:auto;bottom:auto;left:${savedPos.x}px;top:${savedPos.y}px;`; }

  fab.addEventListener('mousedown', e => {
    drag = true; dMoved = false;
    const r = fab.getBoundingClientRect();
    dox = e.clientX - r.left; doy = e.clientY - r.top;
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!drag) return;
    dMoved = true;
    const x = Math.max(0, Math.min(innerWidth  - 44, e.clientX - dox));  // Updated for 44px FAB size
    const y = Math.max(0, Math.min(innerHeight - 44, e.clientY - doy));  // Updated for 44px FAB size
    fab.style.left = x + 'px'; fab.style.top = y + 'px';
    fab.style.right = 'auto'; fab.style.bottom = 'auto';
    placePanelNearFab(x, y);
  });
  document.addEventListener('mouseup', () => {
    if (drag) { try { const r = fab.getBoundingClientRect(); localStorage.setItem('__tm_p__', JSON.stringify({ x: r.left, y: r.top })); } catch {} }
    drag = false;
  });
  fab.addEventListener('click', () => { if (dMoved) { dMoved = false; return; } togglePanel(); });

  function setBadge(n) {
    const b = $('fab-badge');
    if (!b) return;
    if (+b.textContent !== n) { b.textContent = n; b.classList.remove('pulse'); requestAnimationFrame(() => b.classList.add('pulse')); }
  }

  /* ── Panel ────────────────────────────────────────────────────── */
  const panel = mk('div', 'panel hidden');
  panel.innerHTML = `
    <div class="ph">
      <div class="ph-top">
        <div class="ph-title"><span class="ph-title-icon">⚡</span><h2>Tab Manager</h2></div>
        <button class="ph-close" id="ph-close">✕</button>
      </div>
      <div class="ph-stats" id="ph-stats">加载中…</div>
      <div class="toolbar">
        <button class="btn" id="btn-all">全选</button>
        <button class="btn btn-red" id="btn-sel" disabled>关闭选中&nbsp;<span id="sel-n"></span></button>
        <button class="btn btn-red" id="btn-cls-all">关闭全部</button>
      </div>
    </div>
    <div class="search-wrap"><input class="search" id="search" type="text" placeholder="搜索标题或网址…" autocomplete="off" spellcheck="false"></div>
    <div class="groups" id="groups"><div class="empty"><div class="spinner"></div></div></div>
  `;

  shadow.appendChild(fab);
  shadow.appendChild(panel);

  /* ── Panel positioning ────────────────────────────────────────── */
  function placePanelNearFab(fx, fy) {
    if (!panelOpen) return;
    const PW = 480;  // Updated to match new panel width
    let left = fx - PW - 12;
    if (left < 6) left = fx + 54;  // Updated for smaller FAB (44px)
    if (left + PW > innerWidth - 6) left = innerWidth - PW - 6;
    const panH = panel.getBoundingClientRect().height || 380;
    let top = fy + 44 - panH;  // Updated for smaller FAB
    if (top < 6) top = 6;
    if (top + panH > innerHeight - 6) top = innerHeight - panH - 6;
    panel.style.cssText = `right:auto;bottom:auto;left:${left}px;top:${top}px;`;
  }

  function snapPanel() {
    const r = fab.getBoundingClientRect();
    placePanelNearFab(r.left, r.top);
  }

  /* ── Open / close ─────────────────────────────────────────────── */
  function togglePanel() { panelOpen ? closePanel() : openPanel(); }

  async function openPanel() {
    panelOpen = true;
    fab.classList.add('open');
    snapPanel();
    panel.classList.remove('hidden');
    requestAnimationFrame(() => panel.classList.add('visible'));
    await loadTabs();
    $('search')?.focus();
  }

  function closePanel() {
    panelOpen = false;
    fab.classList.remove('open');
    panel.classList.remove('visible');
    panel.classList.add('hidden');
  }

  document.addEventListener('click', e => {
    if (!panelOpen || host.contains(e.target)) return;
    closePanel();
  }, true);

  /* ── Load tabs ────────────────────────────────────────────────── */
  async function loadTabs() {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'GET_TABS' });
      allTabs = (res.tabs || []).filter(t => t.url !== location.href);
      setBadge(allTabs.length);
      renderAll();
    } catch { renderAll(); }
  }

  /* ── Render ───────────────────────────────────────────────────── */
  function renderAll() {
    const container = $('groups');
    if (!container) return;
    const filtered = query
      ? allTabs.filter(t => (t.title || '').toLowerCase().includes(query) || (t.url || '').toLowerCase().includes(query))
      : allTabs;
    updateStats(filtered.length);
    if (!filtered.length) {
      container.innerHTML = `<div class="empty"><div class="ei">${query ? '🔍' : '🎉'}</div><span style="font-size:12px;font-family:inherit">${query ? '无匹配标签页' : '没有其他标签页'}</span></div>`;
      return;
    }
    container.innerHTML = '';
    for (const [d, tabs] of groupBy(filtered)) container.appendChild(buildGroup(d, tabs));
  }

  function updateStats(total) {
    const s = $('ph-stats'); if (!s) return;
    const n = selectedIds.size;
    s.innerHTML = `共 <span class="acc">${total}</span> 个标签页${n ? ` · 已选 <span class="acc">${n}</span> 个` : ''}`;
    const btn = $('btn-sel'); if (btn) btn.disabled = !n;
    const sn  = $('sel-n');   if (sn)  sn.textContent = n || '';
    const ba  = $('btn-all'); if (ba)  ba.textContent = (allTabs.length && allTabs.every(t => selectedIds.has(t.id))) ? '取消全选' : '全选';
  }

  /* ── Group ────────────────────────────────────────────────────── */
  function buildGroup(d, tabs) {
    const g = mk('div', 'group');
    g.dataset.domain = d;

    const f = fav(tabs[0]);
    const allSel = tabs.every(t => selectedIds.has(t.id));
    const hd = mk('div', 'group-hd');
    hd.innerHTML = `
      ${f ? `<img class="gfav" src="${esc(f)}" onerror="this.style.display='none'" alt="">` : '<span style="font-size:13px;flex-shrink:0">🌐</span>'}
      <span class="gname">${esc(domainLabel(d))}</span>
      <span class="gcnt">${tabs.length}</span>
      <div class="gactions">
        <button class="gbtn gbtn-sel">${allSel ? '取消' : '全选'}</button>
        <button class="gbtn gbtn-del">关闭</button>
      </div>
      <span class="chevron">▾</span>
    `;

    const grid = mk('div', 'cards');
    tabs.forEach(t => grid.appendChild(buildCard(t)));
    g.appendChild(hd); g.appendChild(grid);

    hd.querySelector('.chevron').addEventListener('click', e => { e.stopPropagation(); g.classList.toggle('collapsed'); });

    hd.querySelector('.gbtn-sel').addEventListener('click', e => {
      e.stopPropagation();
      const all = tabs.every(t => selectedIds.has(t.id));
      tabs.forEach(t => all ? selectedIds.delete(t.id) : selectedIds.add(t.id));
      syncSelUI();
    });

    hd.querySelector('.gbtn-del').addEventListener('click', e => {
      e.stopPropagation();
      const ids = tabs.map(t => t.id);
      showToast(ids, () => {
        const cards = Array.from(grid.querySelectorAll('.card'));
        fireAndRemove(cards, ids, () => {
          allTabs = allTabs.filter(t => !ids.includes(t.id));
          ids.forEach(id => selectedIds.delete(id));
          g.classList.add('removing');
          g.addEventListener('animationend', () => g.remove(), { once: true });
          updateStats(allTabs.length); setBadge(allTabs.length); maybeCheer();
        });
      });
    });

    return g;
  }

  /* ── Card ─────────────────────────────────────────────────────── */
  function buildCard(tab) {
    const c = mk('div', 'card');
    c.dataset.id = tab.id;
    if (selectedIds.has(tab.id)) c.classList.add('selected');
    const f = fav(tab);
    const title = tab.title || tab.url || 'Untitled';
    c.innerHTML = `
      <div class="ck"></div>
      ${f ? `<img class="cfav" src="${esc(f)}" onerror="this.style.display='none'" alt="">` : ''}
      <div class="ctitle">${hl(title, query)}</div>
      <button class="cx" title="关闭">✕</button>
    `;
    c.addEventListener('click', e => {
      if (e.target.classList.contains('cx')) return;
      if (selectedIds.has(tab.id)) { selectedIds.delete(tab.id); c.classList.remove('selected'); }
      else                         { selectedIds.add(tab.id);    c.classList.add('selected'); }
      updateStats(allTabs.length); syncGroupSelLabels();
    });
    c.querySelector('.cx').addEventListener('click', e => {
      e.stopPropagation();
      selectedIds.delete(tab.id);
      fireAndRemove([c], [tab.id], () => {
        allTabs = allTabs.filter(t => t.id !== tab.id);
        updateStats(allTabs.length); setBadge(allTabs.length);
        // clean empty group
        shadow.querySelectorAll('.group').forEach(g => {
          if (!g.querySelector('.card')) {
            g.classList.add('removing');
            g.addEventListener('animationend', () => g.remove(), { once: true });
          }
        });
      });
    });
    return c;
  }

  function syncSelUI() {
    shadow.querySelectorAll('.card').forEach(c => {
      c.classList.toggle('selected', selectedIds.has(+c.dataset.id));
    });
    updateStats(allTabs.length); syncGroupSelLabels();
  }

  function syncGroupSelLabels() {
    shadow.querySelectorAll('.group').forEach(g => {
      const tabs = allTabs.filter(t => domain(t) === g.dataset.domain);
      const all  = tabs.length && tabs.every(t => selectedIds.has(t.id));
      const btn  = g.querySelector('.gbtn-sel');
      if (btn) btn.textContent = all ? '取消' : '全选';
    });
  }

  /* ── FIREWORKS ────────────────────────────────────────────────── */
  const COLORS = ['#5c8ff0','#7b68f5','#ef5454','#34d399','#fbbf24','#f472b6','#38bdf8','#a78bfa'];

  function spawnFirework(cx, cy) {
    const COUNT   = 22;   // round particles
    const SPARKS  = 14;   // thin sparks
    const layer   = document.documentElement; // attach to real DOM so fixed pos works

    // Round particles
    for (let i = 0; i < COUNT; i++) {
      const angle  = (i / COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const speed  = 55 + Math.random() * 90;
      const el     = document.createElement('div');
      el.style.cssText = `
        position:fixed;
        left:${cx}px; top:${cy}px;
        width:${4 + Math.random() * 5}px;
        height:${4 + Math.random() * 5}px;
        border-radius:50%;
        background:${COLORS[Math.floor(Math.random() * COLORS.length)]};
        pointer-events:none;
        z-index:2147483647;
        --fw-x:${(Math.cos(angle)*speed).toFixed(1)}px;
        --fw-y:${(Math.sin(angle)*speed - 30).toFixed(1)}px;
        --fw-dur:${0.5 + Math.random()*0.35}s;
        --fw-delay:${Math.random()*0.08}s;
        animation:fw-fly var(--fw-dur) var(--fw-delay) cubic-bezier(0.16,1,0.3,1) forwards;
        box-shadow:0 0 4px currentColor;
      `;
      // inject animation via shadow stylesheet wasn't available for document-level el
      // use a <style> trick or inline keyframes via Web Animations API
      el.animate([
        { transform: 'translate(0,0) scale(1)',    opacity: 1 },
        { transform: `translate(${(Math.cos(angle)*speed).toFixed(1)}px,${(Math.sin(angle)*speed*1.2 - 40).toFixed(1)}px) scale(0)`, opacity: 0 }
      ], {
        duration: 500 + Math.random() * 350,
        delay:    Math.random() * 80,
        easing:   'cubic-bezier(0.16,1,0.3,1)',
        fill:     'forwards'
      });
      // Remove after animation
      const dur = 600 + Math.random() * 350;
      setTimeout(() => el.remove(), dur + 200);
      layer.appendChild(el);
    }

    // Spark streaks
    for (let i = 0; i < SPARKS; i++) {
      const angle  = Math.random() * Math.PI * 2;
      const speed  = 30 + Math.random() * 65;
      const len    = 12 + Math.random() * 18;
      const el     = document.createElement('div');
      const color  = COLORS[Math.floor(Math.random() * COLORS.length)];
      el.style.cssText = `
        position:fixed;
        left:${cx}px; top:${cy}px;
        width:${len}px; height:2px;
        background:${color};
        pointer-events:none;
        z-index:2147483647;
        transform-origin:left center;
        border-radius:2px;
      `;
      el.animate([
        { transform: `rotate(${angle}rad) translateX(0) scaleX(1)`,                      opacity: 1 },
        { transform: `rotate(${angle}rad) translateX(${speed}px) scaleX(0.2)`, opacity: 0 }
      ], {
        duration: 380 + Math.random() * 250,
        delay:    Math.random() * 60,
        easing:   'ease-out',
        fill:     'forwards'
      });
      setTimeout(() => el.remove(), 700);
      layer.appendChild(el);
    }
  }

  function getCardCenter(cardEl) {
    const r = cardEl.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  /* ── Animate batch cards out with fireworks ───────────────────── */
  function fireAndRemove(cards, tabIds, onDone) {
    if (!cards.length) {
      chrome.runtime.sendMessage({ type: 'CLOSE_TABS', tabIds }).catch(() => {});
      onDone();
      return;
    }

    // Stagger from center outward
    const mid   = Math.floor(cards.length / 2);
    let   fired = 0;

    cards.forEach((card, i) => {
      const dist  = Math.abs(i - mid);
      const delay = dist * 55;
      setTimeout(() => {
        const { x, y } = getCardCenter(card);
        // 1. shoot particles from card center
        spawnFirework(x, y);
        // 2. shrink + fade card
        card.animate([
          { transform: 'scale(1)',    opacity: 1, filter: 'brightness(1.4)' },
          { transform: 'scale(1.1)', opacity: 0.8, filter: 'brightness(2)',  offset: 0.15 },
          { transform: 'scale(0)',   opacity: 0, filter: 'brightness(0.5)' }
        ], { duration: 360, easing: 'cubic-bezier(0.4,0,0.8,1)', fill: 'forwards' });

        setTimeout(() => {
          card.style.visibility = 'hidden';
          fired++;
          if (fired === cards.length) {
            chrome.runtime.sendMessage({ type: 'CLOSE_TABS', tabIds }).catch(() => {});
            onDone();
          }
        }, 380);
      }, delay);
    });
  }

  /* ── Toast ────────────────────────────────────────────────────── */
  const DELAY = 3000;

  function showToast(tabIds, onConfirm) {
    if (pending) { clearTimeout(pending.timer); clearInterval(pending.tick); pending.toastEl?.remove(); pending = null; }

    const toast = mk('div', 'toast');
    toast.innerHTML = `
      <div class="toast-row1">
        <div class="toast-label">🗑️ 即将关闭</div>
        <div class="toast-num">${tabIds.length}</div>
      </div>
      <div class="toast-sub">个标签页</div>
      <div class="toast-bar-wrap"><div class="toast-bar" id="tbar"></div></div>
      <div class="toast-foot">
        <span class="toast-timer" id="ttimer">3 秒后关闭</span>
        <button class="toast-undo" id="tundo">↩ 撤销</button>
      </div>
    `;
    shadow.appendChild(toast);

    // Reposition toast near FAB (toast is 268px wide, position above/left of FAB)
    const fr = fab.getBoundingClientRect();
    toast.style.cssText = `right:auto;bottom:auto;left:${Math.max(6, fr.left - 268 - 8)}px;top:${Math.max(6, fr.top - 130)}px;`;

    requestAnimationFrame(() => {
      const bar = $('tbar');
      if (bar) { bar.style.transition = `width ${DELAY}ms linear`; bar.style.width = '0%'; }
    });

    let rem = DELAY;
    const tick  = setInterval(() => { rem -= 100; const s = $('ttimer'); if (s) s.textContent = `${Math.ceil(rem/1000)} 秒后关闭`; }, 100);
    const timer = setTimeout(() => {
      clearInterval(tick);
      dismissToast(toast, () => { onConfirm(); pending = null; });
    }, DELAY);

    $('tundo')?.addEventListener('click', () => {
      clearTimeout(timer); clearInterval(tick);
      dismissToast(toast); pending = null;
    });

    pending = { timer, tick, toastEl: toast };
  }

  function dismissToast(el, cb) {
    if (!el) { cb?.(); return; }
    el.classList.add('out');
    // Fast dismissal without animation delay
    const timer = setTimeout(() => { el.remove(); cb?.(); }, 150);
    el.addEventListener('animationend', () => { clearTimeout(timer); el.remove(); cb?.(); }, { once: true });
  }

  /* ── All-done celebration ─────────────────────────────────────── */
  function maybeCheer() {
    if (allTabs.length > 0) return;
    // Burst from panel center
    const pr = panel.getBoundingClientRect();
    for (let k = 0; k < 3; k++) {
      setTimeout(() => spawnFirework(
        pr.left + pr.width  * (0.25 + Math.random() * 0.5),
        pr.top  + pr.height * (0.3  + Math.random() * 0.4)
      ), k * 160);
    }
    const overlay = mk('div', 'done-overlay');
    overlay.innerHTML = `<div class="done-emoji">✨</div><div class="done-text">全部清理完毕！</div><div class="done-sub">所有标签页已关闭</div>`;
    panel.style.position = 'relative';
    panel.appendChild(overlay);
    setTimeout(() => { overlay.style.transition = 'opacity 0.4s'; overlay.style.opacity = '0'; setTimeout(() => overlay.remove(), 400); }, 2400);
  }

  /* ── Wire up static buttons ───────────────────────────────────── */
  // Bind immediately after DOM is built; CSS load irrelevant for JS
  function bindButtons() {
    $('ph-close')?.addEventListener('click', () => {
      // Quick close without delay
      closePanel();
    });

    $('btn-all')?.addEventListener('click', () => {
      const all = allTabs.every(t => selectedIds.has(t.id));
      all ? selectedIds.clear() : allTabs.forEach(t => selectedIds.add(t.id));
      syncSelUI();
    });

    $('btn-sel')?.addEventListener('click', () => {
      if (!selectedIds.size) return;
      const ids   = [...selectedIds];
      showToast(ids, () => {
        const cards = [...shadow.querySelectorAll('.card')].filter(c => selectedIds.has(+c.dataset.id));
        fireAndRemove(cards, ids, () => {
          allTabs = allTabs.filter(t => !ids.includes(t.id));
          ids.forEach(id => selectedIds.delete(id));
          shadow.querySelectorAll('.group').forEach(g => {
            if (!g.querySelector('.card')) {
              g.classList.add('removing');
              g.addEventListener('animationend', () => g.remove(), { once: true });
            }
          });
          updateStats(allTabs.length); setBadge(allTabs.length); maybeCheer();
        });
      });
    });

    $('btn-cls-all')?.addEventListener('click', () => {
      allTabs.forEach(t => selectedIds.add(t.id));
      $('btn-sel')?.click();
    });

    $('search')?.addEventListener('input', e => {
      query = e.target.value.trim().toLowerCase();
      renderAll();
    });
  }

  // Wire buttons once panel HTML is in shadow DOM (synchronous after appendChild)
  bindButtons();

  /* ── Background messages ──────────────────────────────────────── */
  chrome.runtime.onMessage.addListener(msg => {
    if (msg.type === 'TAB_COUNT_UPDATE') setBadge(msg.count);
  });

  chrome.runtime.sendMessage({ type: 'GET_TAB_COUNT' })
    .then(r => setBadge(r?.count ?? 0))
    .catch(() => {});

})();
