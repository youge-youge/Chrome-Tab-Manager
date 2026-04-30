# Tab Manager — Chrome Extension

A floating tab manager that lives on every page. Group, search, and bulk-close your browser tabs without touching Chrome's homepage or New Tab settings.

![version](https://img.shields.io/badge/version-2.1.0-blue) ![manifest](https://img.shields.io/badge/manifest-v3-green) ![license](https://img.shields.io/badge/license-MIT-lightgrey)

---

## Features

| Feature | Description |
|---|---|
| **Floating Action Button** | A ⚡ button pinned to every page — drag it anywhere, position is saved |
| **Domain grouping** | All open tabs are automatically grouped by hostname |
| **Multi-select & batch close** | Click cards to select, then close them all at once |
| **3-second undo** | A countdown toast appears before tabs are actually closed — cancel any time |
| **Firework animation** | Each closed tab bursts into particles; closing everything triggers a 3-wave celebration |
| **Live badge** | The FAB badge always shows the current total tab count |
| **Real-time search** | Filter tabs by title or URL with instant highlighting |
| **Shadow DOM isolation** | The UI is fully encapsulated — no style conflicts with host pages |
| **Does NOT modify New Tab or homepage** | Your browser settings are never touched |

---

## Installation

> No build step required. Load the folder directly in Chrome.

### Step 1 — Download the source

```bash
git clone https://github.com/youge-youge/Chrome-Tab-Manager.git
```

Or download the ZIP from GitHub → **Code → Download ZIP**, then unzip it.

### Step 2 — Open Chrome Extensions

Navigate to:
```
chrome://extensions
```

### Step 3 — Enable Developer Mode

Toggle **Developer mode** on (top-right corner of the extensions page).

### Step 4 — Load the extension

Click **Load unpacked** and select the `tab-manager-extension` folder (the one containing `manifest.json`).

### Step 5 — Done

The ⚡ badge appears in the Chrome toolbar. A floating button is now injected on every page.

> **After updating the code**, click the ↺ refresh icon on `chrome://extensions` and reload any open tabs.

---

## How to Use

### Open the panel
Click the ⚡ floating button on any page. The panel slides open beside it.

### Select tabs
Click a card to select it (blue border = selected). Click again to deselect.  
Use **Select All** in the toolbar or **Select** in a group header to select an entire group.

### Close tabs
| Action | How |
|---|---|
| Close one tab | Hover the card → click **✕** (bottom-right of card) |
| Close selected | Select cards → click **Close Selected** in the toolbar |
| Close a group | Click **Close** in the group header |
| Close everything | Click **Close All** in the toolbar |

All multi-close actions show a **3-second undo toast** — click **↩ Undo** to cancel.

### Search
Type in the search box to filter by title or URL. Matches are highlighted in real time.

### Move the FAB
Click and drag ⚡ to reposition it anywhere on screen. The position is remembered across pages.

---

## File Structure

```
tab-manager-extension/
├── manifest.json      Chrome extension config (Manifest V3)
├── background.js      Service worker — tabs API proxy, badge updates
├── content.js         Injected on every page — FAB + panel UI, firework animations
├── content.css        Shadow DOM styles — panel, cards, animations
├── popup.html         Toolbar icon popup (lightweight fallback)
├── popup.js           Popup logic
├── popup.css          Popup styles
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Architecture

```
┌─────────────────────────────────┐
│  Every page (content.js)        │
│  Shadow DOM host                │
│  ├── FAB button (draggable)     │
│  └── Panel                      │
│      ├── Header + toolbar       │
│      ├── Search                 │
│      └── Domain groups          │
│          └── Tab cards          │
└───────────┬─────────────────────┘
            │ chrome.runtime.sendMessage
            ▼
┌─────────────────────────────────┐
│  background.js (service worker) │
│  chrome.tabs API                │
│  ├── GET_TABS                   │
│  ├── CLOSE_TABS                 │
│  ├── GET_TAB_COUNT              │
│  └── TAB_COUNT_UPDATE broadcast │
└─────────────────────────────────┘
```

Content scripts cannot call `chrome.tabs` directly (no `tabs` permission in content context), so all tab operations are proxied through the background service worker via message passing.

---

## Permissions

| Permission | Why |
|---|---|
| `tabs` | Read tab titles, URLs, favicons; close tabs |
| `host_permissions: <all_urls>` | Inject the floating button on every page |

---

## Browser Compatibility

Chrome 88+ (Manifest V3, Shadow DOM v1, Web Animations API).

---

## License

MIT
