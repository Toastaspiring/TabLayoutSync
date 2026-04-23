# Pinned Tab Sync

A small Chrome extension that syncs your pinned tabs across devices using `chrome.storage.sync`.

Chrome's built-in sync does not persist pinned tabs. This extension keeps a list of pinned URLs in synced storage, and reconciles local tabs to match.

## Features

- Pinning a tab adds it to the synced list.
- Unpinning removes it.
- On startup (and when the synced list changes on another device), any missing URL is opened and pinned; any locally pinned tab not in the synced list is unpinned.
- Popup UI lists every synced URL with favicon, host, and a remove button.
- `Sync now`, `Restore missing`, and `Clear all` buttons for manual control.

## Install (unpacked)

1. Open `chrome://extensions`.
2. Enable *Developer mode* (top right).
3. Click *Load unpacked* and pick this folder.
4. Repeat on every device. Chrome sync must be enabled and signed into the same Google account on each.

Unpacked extensions are not auto-installed across devices. To get that, publish to the Chrome Web Store (Unlisted is enough).

## Files

| File            | Role                                                        |
| --------------- | ----------------------------------------------------------- |
| `manifest.json` | MV3 manifest, permissions: `tabs`, `storage`, `favicon`.    |
| `background.js` | Service worker. Watches tab events, writes/reads sync list. |
| `popup.html`    | Toolbar popup markup.                                       |
| `popup.css`     | Popup styles, light and dark.                               |
| `popup.js`      | Popup logic, talks to the service worker via messages.      |

## Storage format

One key under `chrome.storage.sync`:

```json
{ "pinnedTabs": ["https://example.com/", "https://other.site/page"] }
```

## Limits

- `chrome.storage.sync` caps a single value at 8 KB. Roughly 40 to 80 URLs depending on length. Plenty for normal use.
- Schemes other than `http(s)` are skipped (`chrome://`, `file://`, `about:`, extension URLs).
- Restored tabs open in the currently focused normal window.
- If a URL already exists as an unpinned tab, it is pinned in place instead of opening a duplicate.

## Permissions

- `tabs`: read tab URLs and update pin state.
- `storage`: read and write `chrome.storage.sync`.
- `favicon`: show favicons in the popup list.

No network access, no tracking, no content scripts.

## Development

Edit files and click the reload icon on the extension card in `chrome://extensions`. The service worker logs to its own devtools (Inspect views: service worker).
