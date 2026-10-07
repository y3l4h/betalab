# BetaLab – bouldering log

A free, private bouldering tracker that runs as a home-screen web app on iPhone.

- **Train**: your plans (tap to start, long-press or ⋯ to edit), a session pop-up you can swipe down to minimise, tick off sets and individual climbs per round, rest timer, notes
- **Climbs**: log climbs with photos, gym colour, project / sent / flash, attempts and beta notes
- **Settings**: accent colour, grade colours, backup and restore
- **Progress**: session history, sends by colour, sends per week, hardest send, open projects

All data stays on the phone (IndexedDB). There are no accounts and no server.

## Run locally

```
node serve.js
```

Then open http://localhost:5180.

## Publish free on GitHub Pages

1. Create a new **public** repo on GitHub, `betalab`.
2. Upload every file in this folder (drag and drop on the repo page works).
3. Repo **Settings → Pages → Source: Deploy from a branch → main / (root)** → Save.
4. After a minute it's live at `https://y3l4h.github.io/betalab/`.

## Install on iPhone

Open the link in **Safari** → Share → **Add to Home Screen**. Send the same link to friends; everyone gets their own private data.

## Shipping updates

Change the files, then bump `CACHE` in `sw.js` (e.g. `betalab-v2`) so phones pick up the new version. Phones update the next time the app is opened online. It can take two opens before the new version shows.

## Good to know

- Use **Progress → Back up data** now and then and save the file to iCloud Drive. If the app is deleted from the home screen, its data goes with it.
- The rest timer beeps only while the app is open on screen. It keeps the screen awake while it runs, and the beep follows the silent switch.
