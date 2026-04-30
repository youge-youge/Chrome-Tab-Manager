(() => {
  'use strict';

  let allTabs = [];
  let selectedTabIds = new Set();
  let searchQuery = '';
  let currentWindowId = null;

  const $ = id => document.getElementById(id);

  function getDomain(tab) {
    try {
      if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
        return '__chrome__';
      }
      if (tab.url.startsWith('about:')) return '__about__';
      const url = new URL(tab.url);
      return url.hostname || '__unknown__';
    } catch {
      return '__unknown__';
    }
  }

  function getFaviconUrl(tab) {
    if (tab.favIconUrl && !tab.favIconUrl.startsWith('chrome://')) {
      return tab.favIconUrl;
    }
    try {
      const url = new URL(tab.url);
      return `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=32`;
    } catch {
      return null;
    }
  }

  function getDomainLabel(domain) {
    const labels = {
      '__chrome__': '🔧 Chrome 内置页面',
      '__about__': '📄 关于页面',
      '__unknown__': '🌐 其他',
    };
    return labels[domain] || domain;
  }

  function groupTabs(tabs) {
    const groups = new Map();
    for (const tab of tabs) {
      const domain = getDomain(tab);
      if (!groups.has(domain)) groups.set(domain, []);
      groups.get(domain).push(tab);
    }
    // Sort: non-special domains first, then by count desc
    return new Map(
      [...groups.entries()].sort(([a, aTabs], [b, bTabs]) => {
        const aSpecial = a.startsWith('__');
        const bSpecial = b.startsWith('__');
        if (aSpecial !== bSpecial) return aSpecial ? 1 : -1;
        return bTabs.length - aTabs.length;
      })
    );
  }

  function filterTabs(tabs, query) {
    if (!query) return tabs;
    const q = query.toLowerCase();
    return tabs.filter(tab =>
      (tab.title || '').toLowerCase().includes(q) ||
      (tab.url || '').toLowerCase().includes(q)
    );
  }

  function highlight(text, query) {
    if (!query) return escapeHtml(text);
    const escaped = escapeHtml(text);
    const escapedQuery = escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return escaped.replace(new RegExp(escapedQuery, 'gi'), m => `<span class="highlight">${m}</span>`);
  }

  function escapeHtml(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderGroups(tabs) {
    const container = $('groupsContainer');
    $('loading').style.display = 'none';

    const filtered = filterTabs(tabs, searchQuery);

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="icon">🎉</div>
          <div>${searchQuery ? '没有匹配的标签页' : '没有其他标签页'}</div>
        </div>`;
      return;
    }

    const groups = groupTabs(filtered);
    container.innerHTML = '';

    for (const [domain, domainTabs] of groups) {
      const groupEl = buildGroup(domain, domainTabs);
      container.appendChild(groupEl);
    }

    updateFooter(filtered.length);
  }

  function buildGroup(domain, tabs) {
    const group = document.createElement('div');
    group.className = 'group';
    group.dataset.domain = domain;

    const firstTab = tabs[0];
    const faviconUrl = getFaviconUrl(firstTab);
    const faviconHtml = faviconUrl
      ? `<img class="group-favicon" src="${escapeHtml(faviconUrl)}" onerror="this.style.display='none'" alt="">`
      : `<span class="group-favicon" style="font-size:14px">🌐</span>`;

    const allSelected = tabs.every(t => selectedTabIds.has(t.id));

    const header = document.createElement('div');
    header.className = 'group-header';
    header.innerHTML = `
      ${faviconHtml}
      <span class="group-domain">${escapeHtml(getDomainLabel(domain))}</span>
      <span class="group-badge">${tabs.length}</span>
      <span class="group-select-all">${allSelected ? '取消全选' : '全选本组'}</span>
      <button class="btn-close-group">关闭本组</button>
      <span class="group-chevron">▾</span>
    `;

    const grid = document.createElement('div');
    grid.className = 'cards-grid';

    for (let i = 0; i < tabs.length; i++) {
      const card = buildCard(tabs[i]);
      grid.appendChild(card);
    }

    group.appendChild(header);
    group.appendChild(grid);

    // Toggle collapse
    header.querySelector('.group-chevron').addEventListener('click', e => {
      e.stopPropagation();
      group.classList.toggle('collapsed');
    });

    // Select all in group
    header.querySelector('.group-select-all').addEventListener('click', e => {
      e.stopPropagation();
      const allSel = tabs.every(t => selectedTabIds.has(t.id));
      tabs.forEach(t => allSel ? selectedTabIds.delete(t.id) : selectedTabIds.add(t.id));
      updateSelectionUI();
    });

    // Close group
    header.querySelector('.btn-close-group').addEventListener('click', e => {
      e.stopPropagation();
      const tabIds = tabs.map(t => t.id);
      closeTabsWithAnimation(grid.querySelectorAll('.card'), tabIds, () => {
        group.classList.add('removing');
        group.addEventListener('animationend', () => group.remove(), { once: true });
        tabIds.forEach(id => selectedTabIds.delete(id));
        allTabs = allTabs.filter(t => !tabIds.includes(t.id));
        updateSelectionUI();
        updateTotalCount();
      });
    });

    return group;
  }

  function buildCard(tab) {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.tabId = tab.id;
    if (selectedTabIds.has(tab.id)) card.classList.add('selected');

    const faviconUrl = getFaviconUrl(tab);
    const faviconHtml = faviconUrl
      ? `<img class="card-favicon" src="${escapeHtml(faviconUrl)}" onerror="this.style.display='none'" alt="">`
      : '';

    const title = tab.title || tab.url || 'Untitled';

    card.innerHTML = `
      <div class="card-check"></div>
      ${faviconHtml}
      <div class="card-title">${highlight(title, searchQuery)}</div>
      <button class="card-close" title="关闭此标签页">×</button>
    `;

    // Click card = toggle select
    card.addEventListener('click', e => {
      if (e.target.classList.contains('card-close')) return;
      if (selectedTabIds.has(tab.id)) {
        selectedTabIds.delete(tab.id);
        card.classList.remove('selected');
      } else {
        selectedTabIds.add(tab.id);
        card.classList.add('selected');
      }
      updateSelectionUI();
      // Update group select-all label
      const group = card.closest('.group');
      if (group) refreshGroupSelectLabel(group);
    });

    // Close single card
    card.querySelector('.card-close').addEventListener('click', e => {
      e.stopPropagation();
      selectedTabIds.delete(tab.id);
      closeSingleCard(card, tab.id);
    });

    return card;
  }

  function refreshGroupSelectLabel(groupEl) {
    const domain = groupEl.dataset.domain;
    const tabs = allTabs.filter(t => getDomain(t) === domain);
    const allSel = tabs.length > 0 && tabs.every(t => selectedTabIds.has(t.id));
    const label = groupEl.querySelector('.group-select-all');
    if (label) label.textContent = allSel ? '取消全选' : '全选本组';
  }

  function closeSingleCard(cardEl, tabId) {
    cardEl.classList.add('closing');
    cardEl.addEventListener('animationend', () => {
      chrome.tabs.remove(tabId).catch(() => {});
      allTabs = allTabs.filter(t => t.id !== tabId);
      cardEl.remove();
      updateTotalCount();
      updateFooter(allTabs.length);
      // Remove empty group
      const grid = cardEl.closest('.cards-grid');
      if (grid && grid.children.length === 0) {
        const group = grid.closest('.group');
        if (group) {
          group.classList.add('removing');
          group.addEventListener('animationend', () => group.remove(), { once: true });
        }
      }
    }, { once: true });
  }

  function closeTabsWithAnimation(cardEls, tabIds, onComplete) {
    const cards = Array.from(cardEls);
    if (cards.length === 0) {
      onComplete();
      return;
    }
    let completed = 0;
    cards.forEach((card, i) => {
      setTimeout(() => {
        card.classList.add('closing');
        card.addEventListener('animationend', () => {
          completed++;
          if (completed === cards.length) {
            chrome.tabs.remove(tabIds).catch(() => {});
            onComplete();
          }
        }, { once: true });
      }, i * 50); // 50ms stagger for wave effect
    });
  }

  function updateSelectionUI() {
    const count = selectedTabIds.size;
    $('selectedCount').textContent = count;
    $('closeSelected').disabled = count === 0;

    // Update all card selected states
    document.querySelectorAll('.card').forEach(card => {
      const tabId = parseInt(card.dataset.tabId);
      card.classList.toggle('selected', selectedTabIds.has(tabId));
    });

    // Update select all button
    const allSelected = allTabs.length > 0 && allTabs.every(t => selectedTabIds.has(t.id));
    $('selectAll').textContent = allSelected ? '取消全选' : '全选';
  }

  function updateTotalCount() {
    $('totalCount').textContent = `${allTabs.length} 个标签`;
  }

  function updateFooter(count) {
    const footer = $('footer');
    if (count > 0) {
      footer.style.display = 'flex';
      $('footerInfo').textContent = `共 ${count} 个标签页`;
    } else {
      footer.style.display = 'none';
    }
  }

  async function init() {
    const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentWindowId = currentTab?.windowId;

    const tabs = await chrome.tabs.query({});
    // Exclude the current popup's tab (newtab or extension page)
    allTabs = tabs.filter(t => t.id !== currentTab?.id);

    $('totalCount').textContent = `${allTabs.length} 个标签`;
    renderGroups(allTabs);

    // Select all
    $('selectAll').addEventListener('click', () => {
      const allSelected = allTabs.every(t => selectedTabIds.has(t.id));
      if (allSelected) {
        selectedTabIds.clear();
      } else {
        allTabs.forEach(t => selectedTabIds.add(t.id));
      }
      updateSelectionUI();
    });

    // Close selected
    $('closeSelected').addEventListener('click', () => {
      if (selectedTabIds.size === 0) return;
      const tabIds = [...selectedTabIds];
      const cards = [...document.querySelectorAll('.card')].filter(c =>
        selectedTabIds.has(parseInt(c.dataset.tabId))
      );
      closeTabsWithAnimation(cards, tabIds, () => {
        allTabs = allTabs.filter(t => !selectedTabIds.has(t.id));
        selectedTabIds.clear();
        // Clean up empty groups
        document.querySelectorAll('.cards-grid').forEach(grid => {
          if (grid.children.length === 0) {
            const group = grid.closest('.group');
            if (group) {
              group.classList.add('removing');
              group.addEventListener('animationend', () => group.remove(), { once: true });
            }
          }
        });
        updateSelectionUI();
        updateTotalCount();
        updateFooter(allTabs.length);
      });
    });

    // Close all
    $('closeAllBtn').addEventListener('click', () => {
      allTabs.forEach(t => selectedTabIds.add(t.id));
      $('closeSelected').click();
    });

    // Search
    $('searchInput').addEventListener('input', e => {
      searchQuery = e.target.value.trim();
      renderGroups(allTabs);
    });
  }

  init().catch(console.error);
})();
