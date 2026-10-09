# BetaLab – bouldering log

A private bouldering tracker that runs as a home-screen web app on iPhone and Android.

No accounts and no server: all your data stays on your phone. No ads.

**Open BetaLab: https://y3l4h.github.io/betalab/**

## Add it to your home screen

Open the link above on your phone, then:

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

Once installed, it opens full-screen like a normal app and works offline at the gym. Send the same link to friends; everyone gets their own empty, private copy. When there's an update, BetaLab shows a short "What's new" note the next time you open it.

## About

BetaLab is a hobby project, made by a climber for a climber (myself), but I wanted to share it.

- **Train at your own risk.** BetaLab isn't a coach. Any plans, exercises or tips you add or get from others aren't professional advice. Warm up properly, listen to your body, and be especially careful with finger training like hangboarding. If something hurts, stop and seek a professional.
- **No warranty.** It's a personal project, provided as-is. Bugs can happen, and your data lives only on your phone, so use **Back up data** now and then.
- **Feedback and bugs.** Found a bug or have an idea? [Open an issue](https://github.com/y3l4h/betalab/issues) (needs a free GitHub account).

## Features

### Train
- **Plans:** build your own training sessions from exercises. Each exercise has a section (Warm-up, Main, Strength, Antagonist, Cool-down), sets, reps or detail, rest time and a how-to tip.
- **Training types:** tag each plan as Endurance, Power endurance, Strength & power, Conditioning, Body tension, Technique, Projecting, Mobility or Fun, each with its own icon.
- **Start a session:** tap a plan card, then confirm. **Empty session** starts one without a plan, and you add exercises as you go.
- **Plan menu:** long-press a plan card, or tap **⋯**, to edit, rename, duplicate or delete it.
- **Unsaved edits are kept:** closing the plan editor (swipe down, ✕ or back) minimises it to a bar instead of losing your changes. Only **Discard** throws them away, and the draft survives closing the app.
- **Quick rest timer** with 1–5 minute presets.
- **Recent sessions:** your last three sessions, with **See all** for the rest.

### During a session
- **Session pop-up** with a frozen header: **Finish**, a live session clock, and **⏱ Rest** for a quick rest of 0:30–4:00.
- **Tick off sets** by tapping the numbered dots. Use **+** to add a set.
- **Automatic rest timer** after each set, with −15 / +15 / stop buttons, 3-2-1 beeps, and the screen kept awake while it runs.
- **Track individual climbs:** add the actual problems to an exercise (e.g. the 4 in a circuit). Each one gets its own dot per round, a round completes when every climb in it is ticked, and **+ Round** adds another round.
- **How-to tips** shown on each exercise, cut to two lines; tap to read the whole tip.
- **Notes** on each exercise and on the whole session.
- **Add climb** straight from the session.
- **Minimise:** swipe down to shrink the session to a bar above the tabs and keep using the app. Tap or swipe up to bring it back.
- **"Still climbing?"** If a session has been left running for 2 hours without activity, BetaLab asks whether you're still going and can finish it at the time of your last set.
- **Discard session** if you started one by mistake.

### Climbs
- **Log a climb** with its gym, grade, name or wall, status (**Project / Sent / Flash**), number of attempts, date and beta notes.
- **Photos:** take one or pick from your gallery. Photos are shrunk to save space.
- **Videos:** pick a video and BetaLab saves a still frame from it as the photo. The video itself stays in your gallery.
- **Gyms:** switch between your gyms at the top of the page. Each gym shows its own climbs and grades.
- **Filter** by All / Projects / Sent and by grade.

### Progress
- **Sessions:** full history of finished sessions; tap one for its sets, notes and climbs.
- **Edit session time:** fix a session's date, start time and length (handy if you forgot to tap Finish, or are logging one afterwards). Edited sessions are marked "edited".
- **Stats:** sessions this month, total sends, hardest send and open projects.
- **Sends by grade:** a grade pyramid for the selected gym, with flashes marked ⚡.
- **Sends per week** for the last 8 weeks.

### Settings
- **Accent colour:** 8 presets or any custom colour.
- **Gyms:** keep a separate grading for each gym you climb at. Urban Climb and 9 Degrees colours are built in. Add your own gym with its colours (rename, recolour and reorder them) or the V-scale (VB–V10+).
- **Backups:** **Back up data** saves everything, photos included, to one file, and Settings shows when you last backed up. **Restore from backup** loads a file back in.
- **Backup reminders:** after a session, a nudge to back up if it's been longer than 3 days, a week, 2 weeks or a month (or turn it off).
- **What's new**, **About**, and **How your data is stored**.

### Works like an app
- **Install** to your home screen on iPhone and Android, opening full-screen.
- **Works offline** at the gym.
- **Update notices:** a banner when a new version is ready, and a "What's new" note after updating.
- **Gestures:** swipe pop-ups down to close them, long-press plan cards.
- **Android back button:** closes the top pop-up, then minimises a session or plan edit.
- **Light and dark mode** follow your phone's setting.

## Good to know

- The rest timer only beeps while the app is open on screen. It keeps the screen awake while it runs. On iPhone the beep follows the silent switch, and vibration only works on Android.
- On Android, the back gesture closes the top pop-up, then minimises a running session or an unsaved plan edit.

## How your data is stored

BetaLab is a static website: GitHub Pages only serves the app's files (HTML, CSS, JavaScript and icons). The app never sends your data anywhere. There's no backend, no analytics and no fetch calls apart from loading its own files. Like any web host, GitHub sees normal request details (such as your IP address) when your phone downloads those files, but never your climbing data.

Once it's on your phone, data lives in your browser's storage for the `y3l4h.github.io` origin. The browser locks that storage to this site, so other websites and apps can't read it.

| What | Where | Details |
|---|---|---|
| Plans, sessions, climbs, settings and gyms | **IndexedDB** database `betalab` | Object stores `plans`, `sessions`, `climbs`, `meta`. Plain JSON-like records, saved as you go. |
| Photos | IndexedDB store `photos` | When you add a photo (or pick a video), it's drawn onto a canvas, shrunk so the long edge is at most 1600 px, and re-encoded as JPEG (quality 0.82, usually 0.2–0.5 MB). The JPEG is stored as a binary `Blob`. Your original photo or video is never touched or copied anywhere else. |
| Rest timer, unsaved plan edits, last version seen | **localStorage** keys `betalab.timer`, `betalab.planDraft`, `betalab.seenVersion` | Small values, so a running timer or a half-edited plan survives the app being closed, and "What's new" only shows changes you haven't seen. |
| The app itself, for offline use | **Cache Storage** (`betalab-vN`), via a service worker | Only the app's own files; no personal data. |

On launch, the app asks the browser to mark its storage as **persistent** (`navigator.storage.persist()`), so the browser doesn't evict it when space runs low.

**iPhone:** a home-screen web app gets its own WebKit storage container, separate from Safari's. Data in a Safari tab and data in the installed app are two different copies. In a Safari tab, WebKit's tracking prevention can delete script-written storage after 7 days without a visit. Installed home-screen apps are exempt, which is why you should install it. Deleting the home-screen icon deletes its storage.

**Android:** the installed app (a WebAPK) uses Chrome's storage for the site, so the Chrome tab and the installed app share the same data. Clearing Chrome's site data for `y3l4h.github.io` deletes it.

**Backups:** after you finish a session, BetaLab reminds you to back up if your last backup is older than the interval you pick in Settings (default: a week). Settings → **Back up data** writes one JSON file containing every record, with photos embedded as base64 `data:` URLs. **Restore from backup** wipes the stores and loads that file back in. It's the only way to move your data to a new phone, so do it now and then and keep the file in iCloud Drive, Google Drive or Files.

## For developers

Plain HTML, CSS and JavaScript: no framework, no build step, no dependencies.

**Run locally**

```
node serve.js
```

Then open http://localhost:5180.

**Shipping an update**

1. Bump `CACHE` in `sw.js` (e.g. `betalab-v13`) so phones download the new files.
2. Bump `APP_VERSION` in `changelog.js` and add a plain-English entry at the top of `CHANGES`. That's what people see in "What's new".
3. If you add a new JavaScript file, also add it to `ASSETS` in `sw.js` so it works offline.

Phones pick up the update in the background and show an **Update** banner, or get it the next time the app is opened.
