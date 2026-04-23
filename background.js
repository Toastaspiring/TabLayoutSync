const STORAGE_KEY = 'pinnedTabs';
const SAVE_DEBOUNCE_MS = 800;
const STARTUP_DELAY_MS = 1500;

let isReconciling = false;
let saveTimer = null;

function isSyncableUrl(url) {
  if (!url) return false;
  if (url === 'about:blank') return false;
  if (url.startsWith('chrome://')) return false;
  if (url.startsWith('chrome-extension://')) return false;
  if (url.startsWith('edge://')) return false;
  if (url.startsWith('about:')) return false;
  if (url.startsWith('file://')) return false;
  return true;
}

async function getRemote() {
  const r = await chrome.storage.sync.get(STORAGE_KEY);
  const v = r[STORAGE_KEY];
  return Array.isArray(v) ? v : [];
}

async function setRemote(list) {
  await chrome.storage.sync.set({ [STORAGE_KEY]: list });
}

async function getCurrentPinnedUrls() {
  const tabs = await chrome.tabs.query({ pinned: true });
  const seen = new Set();
  const urls = [];
  for (const t of tabs) {
    if (!isSyncableUrl(t.url)) continue;
    if (seen.has(t.url)) continue;
    seen.add(t.url);
    urls.push(t.url);
  }
  return urls;
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function saveCurrentPinned() {
  if (isReconciling) return;
  const local = await getCurrentPinnedUrls();
  const remote = await getRemote();
  if (arraysEqual(local, remote)) return;
  await setRemote(local);
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveCurrentPinned().catch((e) => console.warn('[PinnedTabSync] save failed', e));
  }, SAVE_DEBOUNCE_MS);
}

async function pickTargetWindowId() {
  const wins = await chrome.windows.getAll({ windowTypes: ['normal'] });
  if (!wins.length) return null;
  const focused = wins.find((w) => w.focused);
  return (focused || wins[0]).id;
}

async function reconcileToRemote() {
  if (isReconciling) return;
  isReconciling = true;
  try {
    const remote = await getRemote();
    const remoteSet = new Set(remote);
    const allTabs = await chrome.tabs.query({});

    for (const t of allTabs) {
      if (t.pinned && isSyncableUrl(t.url) && !remoteSet.has(t.url)) {
        try { await chrome.tabs.update(t.id, { pinned: false }); } catch (_) {}
      }
    }

    const openByUrl = new Map();
    for (const t of allTabs) {
      if (!openByUrl.has(t.url)) openByUrl.set(t.url, t);
    }

    let targetWindowId = null;

    for (const url of remote) {
      const existing = openByUrl.get(url);
      if (existing) {
        if (!existing.pinned) {
          try { await chrome.tabs.update(existing.id, { pinned: true }); } catch (_) {}
        }
        continue;
      }
      if (targetWindowId == null) {
        targetWindowId = await pickTargetWindowId();
      }
      if (targetWindowId == null) continue;
      try {
        await chrome.tabs.create({
          url,
          pinned: true,
          active: false,
          windowId: targetWindowId,
        });
      } catch (e) {
        console.warn('[PinnedTabSync] could not create tab for', url, e);
      }
    }
  } finally {
    isReconciling = false;
  }
}

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if ('pinned' in changeInfo) {
    scheduleSave();
    return;
  }
  if ('url' in changeInfo && tab.pinned) {
    scheduleSave();
  }
});

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.pinned) scheduleSave();
});

chrome.tabs.onRemoved.addListener(() => {
  scheduleSave();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (!changes[STORAGE_KEY]) return;
  if (isReconciling) return;
  reconcileToRemote().catch((e) => console.warn('[PinnedTabSync] reconcile failed', e));
});

chrome.runtime.onStartup.addListener(() => {
  // Delay so Chrome's session restore finishes before we read the tab set,
  // otherwise a partial snapshot can overwrite the synced list.
  setTimeout(async () => {
    try {
      await reconcileToRemote();
      await saveCurrentPinned();
    } catch (e) {
      console.warn('[PinnedTabSync] startup failed', e);
    }
  }, STARTUP_DELAY_MS);
});

chrome.runtime.onInstalled.addListener(async () => {
  try {
    const local = await getCurrentPinnedUrls();
    const remote = await getRemote();
    const merged = [];
    const seen = new Set();
    for (const u of [...remote, ...local]) {
      if (seen.has(u)) continue;
      seen.add(u);
      merged.push(u);
    }
    if (!arraysEqual(merged, remote)) {
      await setRemote(merged);
    }
    await reconcileToRemote();
  } catch (e) {
    console.warn('[PinnedTabSync] install init failed', e);
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg && msg.type) {
        case 'getState': {
          const synced = await getRemote();
          const localPinned = await chrome.tabs.query({ pinned: true });
          sendResponse({
            ok: true,
            synced,
            localPinnedCount: localPinned.length,
          });
          return;
        }
        case 'remove': {
          const remote = await getRemote();
          const updated = remote.filter((u) => u !== msg.url);
          if (!arraysEqual(updated, remote)) await setRemote(updated);
          sendResponse({ ok: true });
          return;
        }
        case 'syncNow': {
          await saveCurrentPinned();
          sendResponse({ ok: true });
          return;
        }
        case 'restoreNow': {
          await reconcileToRemote();
          sendResponse({ ok: true });
          return;
        }
        case 'clearAll': {
          await setRemote([]);
          sendResponse({ ok: true });
          return;
        }
        default:
          sendResponse({ ok: false, error: 'unknown message type' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e && e.message || e) });
    }
  })();
  return true;
});
