const pinsEl = document.getElementById('pins');
const groupsEl = document.getElementById('groups');
const statusEl = document.getElementById('status');

const GROUP_COLOR_HEX = {
  grey: '#9e9e9e',
  blue: '#1a73e8',
  red: '#d93025',
  yellow: '#fbbc04',
  green: '#1e8e3e',
  pink: '#e8457c',
  purple: '#9334e6',
  cyan: '#00bcd4',
  orange: '#f57c00',
};

function send(msg) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (resp) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(resp || { ok: false });
        }
      });
    } catch (e) {
      resolve({ ok: false, error: String(e) });
    }
  });
}

function faviconUrl(pageUrl) {
  try {
    const f = new URL(chrome.runtime.getURL('/_favicon/'));
    f.searchParams.set('pageUrl', pageUrl);
    f.searchParams.set('size', '16');
    return f.href;
  } catch {
    return '';
  }
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

function createPinRow(url) {
  const li = document.createElement('li');

  const icon = document.createElement('img');
  icon.className = 'favicon';
  icon.src = faviconUrl(url);
  icon.alt = '';
  icon.addEventListener('error', () => { icon.style.visibility = 'hidden'; });

  const text = document.createElement('div');
  text.className = 'text';

  const host = document.createElement('div');
  host.className = 'host';
  host.textContent = hostOf(url);

  const full = document.createElement('div');
  full.className = 'url';
  full.textContent = url;
  full.title = url;

  text.appendChild(host);
  text.appendChild(full);

  const btn = document.createElement('button');
  btn.className = 'remove';
  btn.type = 'button';
  btn.title = 'Remove from sync';
  btn.textContent = '\u00D7';
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    await send({ type: 'removePin', url });
    await render();
  });

  li.appendChild(icon);
  li.appendChild(text);
  li.appendChild(btn);
  return li;
}

function createGroupRow(group) {
  const li = document.createElement('li');

  const dot = document.createElement('span');
  dot.className = 'dot';
  dot.style.background = GROUP_COLOR_HEX[group.color] || '#9e9e9e';

  const text = document.createElement('div');
  text.className = 'text';

  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = group.title;
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = group.collapsed ? 'collapsed' : 'expanded';
  title.appendChild(badge);

  const sub = document.createElement('div');
  sub.className = 'subtitle';
  const n = group.urls.length;
  sub.textContent = `${n} ${n === 1 ? 'tab' : 'tabs'}`;

  text.appendChild(title);
  text.appendChild(sub);

  const btn = document.createElement('button');
  btn.className = 'remove';
  btn.type = 'button';
  btn.title = 'Remove group from sync';
  btn.textContent = '\u00D7';
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    await send({ type: 'removeGroup', title: group.title });
    await render();
  });

  li.appendChild(dot);
  li.appendChild(text);
  li.appendChild(btn);
  return li;
}

function renderEmpty(listEl, text) {
  const li = document.createElement('li');
  li.className = 'empty';
  li.textContent = text;
  listEl.appendChild(li);
}

async function render() {
  const state = await send({ type: 'getState' });
  if (!state || !state.ok) {
    statusEl.textContent = 'Could not load state.';
    return;
  }
  const pins = state.pins || [];
  const groups = state.groups || [];
  const localPinnedCount = state.localPinnedCount || 0;
  const localGroupCount = state.localGroupCount || 0;

  statusEl.textContent =
    `${pins.length} pins / ${groups.length} groups synced \u00B7 ` +
    `${localPinnedCount} pins / ${localGroupCount} groups here`;

  pinsEl.innerHTML = '';
  groupsEl.innerHTML = '';

  if (!pins.length) {
    renderEmpty(pinsEl, 'Pin a tab to start syncing.');
  } else {
    for (const url of pins) pinsEl.appendChild(createPinRow(url));
  }

  if (!groups.length) {
    renderEmpty(groupsEl, 'Name a tab group to sync it.');
  } else {
    for (const g of groups) groupsEl.appendChild(createGroupRow(g));
  }
}

async function runButton(btn, msg) {
  btn.disabled = true;
  try {
    await send(msg);
    await render();
  } finally {
    btn.disabled = false;
  }
}

document.getElementById('sync').addEventListener('click', (ev) => {
  runButton(ev.currentTarget, { type: 'syncNow' });
});

document.getElementById('restore').addEventListener('click', (ev) => {
  runButton(ev.currentTarget, { type: 'restoreNow' });
});

document.getElementById('clear').addEventListener('click', (ev) => {
  if (!confirm('Remove every synced pin and group? They will be unpinned and ungrouped on every device that syncs.')) return;
  runButton(ev.currentTarget, { type: 'clearAll' });
});

render();
