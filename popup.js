const listEl = document.getElementById('list');
const statusEl = document.getElementById('status');

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

function createRow(url) {
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
  btn.title = 'Remove from sync (also unpins on other devices)';
  btn.textContent = '\u00D7';
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    await send({ type: 'remove', url });
    await render();
  });

  li.appendChild(icon);
  li.appendChild(text);
  li.appendChild(btn);
  return li;
}

async function render() {
  const state = await send({ type: 'getState' });
  if (!state || !state.ok) {
    statusEl.textContent = 'Could not load state.';
    return;
  }
  const synced = state.synced || [];
  const localPinnedCount = state.localPinnedCount || 0;
  statusEl.textContent =
    `${synced.length} synced across devices \u00B7 ${localPinnedCount} pinned here`;

  listEl.innerHTML = '';

  if (!synced.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Pin a tab to start syncing.';
    listEl.appendChild(li);
    return;
  }

  for (const url of synced) {
    listEl.appendChild(createRow(url));
  }
}

document.getElementById('sync').addEventListener('click', async (ev) => {
  const btn = ev.currentTarget;
  btn.disabled = true;
  try {
    await send({ type: 'syncNow' });
    await render();
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('restore').addEventListener('click', async (ev) => {
  const btn = ev.currentTarget;
  btn.disabled = true;
  try {
    await send({ type: 'restoreNow' });
    await render();
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('clear').addEventListener('click', async (ev) => {
  if (!confirm('Remove every synced pinned tab? This will unpin them on all devices that sync.')) return;
  const btn = ev.currentTarget;
  btn.disabled = true;
  try {
    await send({ type: 'clearAll' });
    await render();
  } finally {
    btn.disabled = false;
  }
});

render();
