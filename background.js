const PINS_KEY = 'pinnedTabs';
const GROUPS_KEY = 'tabGroups';
const SAVE_DEBOUNCE_MS = 800;
const STARTUP_DELAY_MS = 1500;

let isReconciling = false;
let pinsSaveTimer = null;
let groupsSaveTimer = null;

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

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ---------- Pinned tabs ----------

async function getRemotePins() {
  const r = await chrome.storage.sync.get(PINS_KEY);
  const v = r[PINS_KEY];
  return Array.isArray(v) ? v : [];
}

async function setRemotePins(list) {
  await chrome.storage.sync.set({ [PINS_KEY]: list });
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

async function saveCurrentPinned() {
  if (isReconciling) return;
  const local = await getCurrentPinnedUrls();
  const remote = await getRemotePins();
  if (arraysEqual(local, remote)) return;
  await setRemotePins(local);
}

function scheduleSavePins() {
  clearTimeout(pinsSaveTimer);
  pinsSaveTimer = setTimeout(() => {
    saveCurrentPinned().catch((e) => console.warn('[TabLayoutSync] pins save failed', e));
  }, SAVE_DEBOUNCE_MS);
}

async function pickTargetWindowId() {
  const wins = await chrome.windows.getAll({ windowTypes: ['normal'] });
  if (!wins.length) return null;
  const focused = wins.find((w) => w.focused);
  return (focused || wins[0]).id;
}

async function reconcilePinsToRemote() {
  const remote = await getRemotePins();
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
    if (targetWindowId == null) targetWindowId = await pickTargetWindowId();
    if (targetWindowId == null) continue;
    try {
      await chrome.tabs.create({
        url,
        pinned: true,
        active: false,
        windowId: targetWindowId,
      });
    } catch (e) {
      console.warn('[TabLayoutSync] could not create pinned tab for', url, e);
    }
  }
}

// ---------- Tab groups ----------

async function getRemoteGroups() {
  const r = await chrome.storage.sync.get(GROUPS_KEY);
  const v = r[GROUPS_KEY];
  return Array.isArray(v) ? v : [];
}

async function setRemoteGroups(list) {
  await chrome.storage.sync.set({ [GROUPS_KEY]: list });
}

async function getCurrentGroups() {
  const groups = await chrome.tabGroups.query({});
  const result = [];
  for (const g of groups) {
    if (!g.title) continue;
    const tabs = await chrome.tabs.query({ groupId: g.id });
    tabs.sort((a, b) => a.index - b.index);
    const urls = [];
    const seen = new Set();
    for (const t of tabs) {
      if (!isSyncableUrl(t.url)) continue;
      if (seen.has(t.url)) continue;
      seen.add(t.url);
      urls.push(t.url);
    }
    if (!urls.length) continue;
    result.push({
      title: g.title,
      color: g.color,
      collapsed: !!g.collapsed,
      urls,
    });
  }
  return result;
}

function groupsEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (x.title !== y.title) return false;
    if (x.color !== y.color) return false;
    if (!!x.collapsed !== !!y.collapsed) return false;
    if (!arraysEqual(x.urls, y.urls)) return false;
  }
  return true;
}

async function saveCurrentGroups() {
  if (isReconciling) return;
  const local = await getCurrentGroups();
  const remote = await getRemoteGroups();
  if (groupsEqual(local, remote)) return;
  await setRemoteGroups(local);
}

function scheduleSaveGroups() {
  clearTimeout(groupsSaveTimer);
  groupsSaveTimer = setTimeout(() => {
    saveCurrentGroups().catch((e) => console.warn('[TabLayoutSync] groups save failed', e));
  }, SAVE_DEBOUNCE_MS);
}

async function reconcileGroupsToRemote() {
  const remoteGroups = await getRemoteGroups();
  if (!remoteGroups.length) return;

  const localGroups = await chrome.tabGroups.query({});
  const byTitle = new Map();
  for (const g of localGroups) {
    if (g.title && !byTitle.has(g.title)) byTitle.set(g.title, g);
  }

  for (const rg of remoteGroups) {
    const existing = byTitle.get(rg.title);

    if (existing) {
      const updates = {};
      if (existing.color !== rg.color) updates.color = rg.color;
      if (!!existing.collapsed !== !!rg.collapsed) updates.collapsed = rg.collapsed;
      if (Object.keys(updates).length) {
        try { await chrome.tabGroups.update(existing.id, updates); } catch (_) {}
      }

      const currentTabs = await chrome.tabs.query({ groupId: existing.id });
      const currentUrls = new Set(currentTabs.map((t) => t.url));
      for (const url of rg.urls) {
        if (currentUrls.has(url)) continue;
        try {
          const newTab = await chrome.tabs.create({
            url,
            active: false,
            windowId: existing.windowId,
          });
          await chrome.tabs.group({ tabIds: [newTab.id], groupId: existing.id });
        } catch (e) {
          console.warn('[TabLayoutSync] add to group failed', e);
        }
      }
      continue;
    }

    const targetWindowId = await pickTargetWindowId();
    if (targetWindowId == null) continue;

    const tabIds = [];
    for (const url of rg.urls) {
      try {
        const t = await chrome.tabs.create({
          url,
          active: false,
          windowId: targetWindowId,
        });
        tabIds.push(t.id);
      } catch (_) {}
    }
    if (!tabIds.length) continue;

    try {
      const newGroupId = await chrome.tabs.group({
        tabIds,
        createProperties: { windowId: targetWindowId },
      });
      await chrome.tabGroups.update(newGroupId, {
        title: rg.title,
        color: rg.color,
        collapsed: !!rg.collapsed,
      });
    } catch (e) {
      console.warn('[TabLayoutSync] create group failed', e);
    }
  }
}

// ---------- Combined reconcile ----------

async function reconcileAll() {
  if (isReconciling) return;
  isReconciling = true;
  try {
    await reconcilePinsToRemote();
    await reconcileGroupsToRemote();
  } finally {
    isReconciling = false;
  }
}

// ---------- Tab + group events ----------

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if ('pinned' in changeInfo) {
    scheduleSavePins();
  } else if ('url' in changeInfo && tab.pinned) {
    scheduleSavePins();
  }
  if ('groupId' in changeInfo) {
    scheduleSaveGroups();
  } else if ('url' in changeInfo && tab.groupId !== undefined && tab.groupId !== -1) {
    scheduleSaveGroups();
  }
});

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.pinned) scheduleSavePins();
  if (tab.groupId !== undefined && tab.groupId !== -1) scheduleSaveGroups();
});

chrome.tabs.onRemoved.addListener(() => {
  scheduleSavePins();
  scheduleSaveGroups();
});

if (chrome.tabGroups) {
  chrome.tabGroups.onCreated.addListener(() => scheduleSaveGroups());
  chrome.tabGroups.onUpdated.addListener(() => scheduleSaveGroups());
  chrome.tabGroups.onRemoved.addListener(() => scheduleSaveGroups());
}

// ---------- Remote changes ----------

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (isReconciling) return;
  if (changes[PINS_KEY] || changes[GROUPS_KEY]) {
    reconcileAll().catch((e) => console.warn('[TabLayoutSync] reconcile failed', e));
  }
});

// ---------- Startup / install ----------

chrome.runtime.onStartup.addListener(() => {
  // Delay so Chrome's session restore finishes before we read the tab set,
  // otherwise a partial snapshot can overwrite the synced list.
  setTimeout(async () => {
    try {
      await reconcileAll();
      await saveCurrentPinned();
      await saveCurrentGroups();
    } catch (e) {
      console.warn('[TabLayoutSync] startup failed', e);
    }
  }, STARTUP_DELAY_MS);
});

chrome.runtime.onInstalled.addListener(async () => {
  try {
    const [localPins, remotePins] = [await getCurrentPinnedUrls(), await getRemotePins()];
    const mergedPins = [];
    const seenPin = new Set();
    for (const u of [...remotePins, ...localPins]) {
      if (seenPin.has(u)) continue;
      seenPin.add(u);
      mergedPins.push(u);
    }
    if (!arraysEqual(mergedPins, remotePins)) {
      await setRemotePins(mergedPins);
    }

    const [localGroups, remoteGroups] = [await getCurrentGroups(), await getRemoteGroups()];
    const mergedGroups = [];
    const seenGroup = new Set();
    for (const g of [...remoteGroups, ...localGroups]) {
      if (seenGroup.has(g.title)) continue;
      seenGroup.add(g.title);
      mergedGroups.push(g);
    }
    if (!groupsEqual(mergedGroups, remoteGroups)) {
      await setRemoteGroups(mergedGroups);
    }

    await reconcileAll();
  } catch (e) {
    console.warn('[TabLayoutSync] install init failed', e);
  }
});

// ---------- Popup messaging ----------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg && msg.type) {
        case 'getState': {
          const pins = await getRemotePins();
          const groups = await getRemoteGroups();
          const localPinned = await chrome.tabs.query({ pinned: true });
          const localGroupCount = chrome.tabGroups
            ? (await chrome.tabGroups.query({})).length
            : 0;
          sendResponse({
            ok: true,
            pins,
            groups,
            localPinnedCount: localPinned.length,
            localGroupCount,
          });
          return;
        }
        case 'removePin': {
          const pins = await getRemotePins();
          const updated = pins.filter((u) => u !== msg.url);
          if (!arraysEqual(updated, pins)) await setRemotePins(updated);
          sendResponse({ ok: true });
          return;
        }
        case 'removeGroup': {
          const groups = await getRemoteGroups();
          const updated = groups.filter((g) => g.title !== msg.title);
          if (!groupsEqual(updated, groups)) await setRemoteGroups(updated);
          sendResponse({ ok: true });
          return;
        }
        case 'syncNow': {
          await saveCurrentPinned();
          await saveCurrentGroups();
          sendResponse({ ok: true });
          return;
        }
        case 'restoreNow': {
          await reconcileAll();
          sendResponse({ ok: true });
          return;
        }
        case 'clearAll': {
          await setRemotePins([]);
          await setRemoteGroups([]);
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
