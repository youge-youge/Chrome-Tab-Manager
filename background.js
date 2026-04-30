'use strict';

// 实时更新 badge 显示标签页数
function updateBadge() {
  chrome.tabs.query({}).then(tabs => {
    const count = tabs.length;
    chrome.action.setBadgeText({ text: count > 0 ? count.toString() : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#ef5454' });
    broadcastTabCount(count, tabs);
  });
}

// Broadcast tab count to all content scripts — reuses the tab list already fetched
function broadcastTabCount(count, tabs) {
  tabs.forEach(tab => {
    chrome.tabs.sendMessage(tab.id, { type: 'TAB_COUNT_UPDATE', count }).catch(() => {});
  });
}

// 消息监听器
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'GET_TABS':
      chrome.tabs.query({}).then(tabs => {
        sendResponse({ tabs });
      });
      return true;

    case 'CLOSE_TABS':
      chrome.tabs.remove(msg.tabIds).then(() => {
        // 立即更新 badge 和广播
        updateBadge();
        sendResponse({ ok: true });
      }).catch(err => {
        sendResponse({ ok: false, error: err.message });
      });
      return true;

    case 'SWITCH_TAB':
      chrome.tabs.update(msg.tabId, { active: true }).then(tab => {
        chrome.windows.update(tab.windowId, { focused: true });
        sendResponse({ ok: true });
      }).catch(() => sendResponse({ ok: false }));
      return true;

    case 'GET_TAB_COUNT':
      chrome.tabs.query({}).then(tabs => {
        sendResponse({ count: tabs.length });
      });
      return true;
  }
});

// 监听标签页事件 - 实时更新
chrome.tabs.onCreated.addListener(() => {
  // 立即更新 badge 显示
  updateBadge();
});

chrome.tabs.onRemoved.addListener(() => {
  // 立即更新 badge 显示
  updateBadge();
});


// 初始化 - 扩展启动时更新 badge
updateBadge();
