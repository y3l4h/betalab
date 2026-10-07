# BetaLab – bouldering log

A free, private bouldering tracker that runs as a home-screen web app on iPhone and Android.

- **Train**: your plans (tap to start, long-press or ⋯ to edit), a session pop-up you can swipe down to minimise, tick off sets and individual climbs per round, rest timer, notes
- **Climbs**: log climbs with photos, gym colour, project / sent / flash, attempts and beta notes
- **Progress**: session history, sends by colour, sends per week, hardest send, open projects
- **Settings**: accent colour, grade colours, backup and restore

No accounts and no server: all your data stays on your phone (details below).

## Add it to your home screen

Open **https://y3l4h.github.io/betalab/** on your phone, then:

**iPhone (Safari)**
1. Open the link in **Safari**. Other browsers on iPhone can't install it properly.
2. Tap the **Share** button (the square with an arrow pointing up).
3. Scroll down and tap **Add to Home Screen**, then **Add**.
4. Open BetaLab from the new icon on your home screen. Use the icon from now on, not the Safari tab.

**Android (Chrome)**
1. Open the link in **Chrome**.
2. Tap the **⋮** menu (top right).
3. Tap **Install app** or **Add to Home screen**, then **Install**. Chrome may also show an install banner by itself.
4. Open BetaLab from the new icon on your home screen or in your app drawer.

Once installed, it opens full-screen like a normal app and works offline at the gym. Send the same link to friends; everyone gets their own empty, private copy.

## How your data is stored

BetaLab is a static website: GitHub Pages only serves the app's files (HTML, CSS, JavaScript and icons). The app never sends your data anywhere. There's no backend, no analytics and no fetch calls apart from loading its own files. Like any web host, GitHub sees normal request details (such as your IP address) when your phone downloads those files, but never your climbing data.

Once it's on your phone, data lives in your browser's storage for the `y3l4h.github.io` origin. The browser locks that storage to this site, so other websites and apps can't read it.

| What | Where | Details |
|---|---|---|
| Plans, sessions, climbs, settings | **IndexedDB** database `betalab` | Object stores `plans`, `sessions`, `climbs`, `meta`. Plain JSON-like records, saved as you go. |
| Photos | IndexedDB store `photos` | When you add a photo, it's drawn onto a canvas, shrunk so the long edge is at most 1600 px, and re-encoded as JPEG (quality 0.82, usually 0.2–0.5 MB). The JPEG is stored as a binary `Blob`. Your original photo is never touched or copied anywhere else. |
| Rest timer, unsaved plan edits | **localStorage** keys `betalab.timer`, `betalab.planDraft` | Small JSON values, so a running timer or a half-edited plan survives the app being closed. |
| The app itself, for offline use | **Cache Storage** (`betalab-vN`), via a service worker | Only the app's own files; no personal data. |

On launch, the app asks the browser to mark its storage as **persistent** (`navigator.storage.persist()`), so the browser doesn't evict it when space runs low.

**iPhone:** a home-screen web app gets its own WebKit storage container, separate from Safari's. Data in a Safari tab and data in the installed app are two different copies. In a Safari tab, WebKit's tracking prevention can delete script-written storage after 7 days without a visit. Installed home-screen apps are exempt, which is why you should install it. Deleting the home-screen icon deletes its storage.

**Android:** the installed app (a WebAPK) uses Chrome's storage for the site, so the Chrome tab and the installed app share the same data. Clearing Chrome's site data for `y3l4h.github.io` deletes it.

**Backups:** Settings → **Back up data** writes one JSON file containing every record, with photos embedded as base64 `data:` URLs. **Restore from backup** wipes the stores and loads that file back in. It's the only way to move your data to a new phone, so do it now and then and keep the file in iCloud Drive, Google Drive or Files.

## Run locally

```
node serve.js
```

Then open http://localhost:5180.

## Shipping updates

Change the files, then bump `CACHE` in `sw.js` (e.g. `betalab-v6`) so phones pick up the new version. Phones update the next time the app is opened online. It can take two opens before the new version shows.

## Good to know

- The rest timer only beeps while the app is open on screen. It keeps the screen awake while it runs. On iPhone the beep follows the silent switch, and vibration only works on Android.
- On Android, the back gesture closes the top pop-up, then minimises a running session or an unsaved plan edit.
