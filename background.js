'use strict';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'GET_TABS':
      chrome.tabs.query({}).then(tabs => {
        sendResponse({ tabs });
      });
      return true;

    case 'CLOSE_TABS':
      chrome.tabs.remove(msg.tabIds).then(() => {
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

// Broadcast tab count updates to all content scripts
function broadcastTabCount() {
  chrome.tabs.query({}).then(tabs => {
    chrome.tabs.query({ active: true }).then(activeTabs => {
      activeTabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          type: 'TAB_COUNT_UPDATE',
          count: tabs.length
        }).catch(() => {});
      });
    });
  });
}

chrome.tabs.onCreated.addListener(broadcastTabCount);
chrome.tabs.onRemoved.addListener(broadcastTabCount);
