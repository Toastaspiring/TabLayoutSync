# Pinned Tab Sync

A small Chrome extension that syncs your pinned tabs and tab groups across devices using `chrome.storage.sync`.

Chrome's built-in sync does not persist pinned tabs, and it does not persist tab-group collapsed state. This extension keeps both in synced storage and reconciles local tabs to match.

## Features

### Pinned tabs
- Pinning a tab adds it to the synced list.
- Unpinning removes it.
- On startup or when another device changes the list, missing URLs are opened and pinned; locally pinned tabs not in the list are unpinned.

### Tab groups
- Only groups with a name are synced (title is the identity key, so keep names unique).
- Syncs title, color, collapsed/expanded state, and member URLs in order.
- On another device, missing groups are recreated in the focused window; existing same-titled groups have their color, collapsed state, and missing member URLs reconciled.
- Add-only for member tabs: removing a tab from a local group will not delete it from other devices (use the popup `x` button to delete a group everywhere).

### UI
- Popup has two sections: pinned tabs and tab groups.
- Each row has a remove button.
- `Sync now`, `Restore missing`, and `Clear all` at the bottom.

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

Two keys under `chrome.storage.sync`:

```json
{
  "pinnedTabs": ["https://example.com/", "https://other.site/page"],
  "tabGroups": [
    {
      "title": "Work",
      "color": "blue",
      "collapsed": false,
      "urls": ["https://docs.example.com/", "https://mail.example.com/"]
    }
  ]
}
```

## Limits

- `chrome.storage.sync` caps a single value at 8 KB. Fine for a normal pin set and a handful of named groups.
- Schemes other than `http(s)` are skipped (`chrome://`, `file://`, `about:`, extension URLs).
- Restored tabs and groups are created in the currently focused normal window.
- If a URL already exists as an unpinned tab, it is pinned in place instead of opening a duplicate.
- Group identity is the title: renaming a group on one device looks like "old group removed, new group added" to the others.

## Permissions

- `tabs`: read tab URLs and update pin state.
- `tabGroups`: read and write tab group title, color, and collapsed state.
- `storage`: read and write `chrome.storage.sync`.
- `favicon`: show favicons in the popup list.

No network access, no tracking, no content scripts.

## Development

Edit files and click the reload icon on the extension card in `chrome://extensions`. The service worker logs to its own devtools (Inspect views: service worker).
