# Ago — "how long has it been?"

**Live: <https://ago-4iw.pages.dev>** — open on your phone and Add to Home Screen.

One-tap tracker for everything you do **sometimes**: water the plants, change the
sheets, swap the water filter, clean the litter box, call Mom, back up your phone.

## The wedge

- **Daily problem:** irregular recurring chores have no natural reminder. You don't
  forget *to* do them — you forget *when you last did* them.
- **Under-served niche:** every tracker on the market is a streak/daily-habit app.
  The "elapsed-since-last" use case is almost never served cleanly, and never
  monetized — it's usually a note in someone's phone.
- **Form factor:** offline-first PWA. Installs on iPhone *and* Android from the
  browser ("Add to Home Screen"), no app-store fee, no account, no backend,
  data never leaves the device.

## Features (v1.0)

- One-tap **"Did it ✓"** resets the timer; live elapsed display (`3d 4h ago`)
- Optional threshold per item → card turns **amber at 75%**, **red when overdue**;
  overdue items sort to the top
- Tap a card for full history with gaps between events
- Undo toast, edit/delete, emoji icons, 6 one-tap starter suggestions
- Export / import JSON backup
- Dark/light theme (follows system), safe-area aware, installable, offline via
  service worker (stale-while-revalidate)

## Run locally

```sh
cd ago
python -m http.server 8123
# open http://localhost:8123
```

## Deploy (free)

Any static host. Cloudflare Pages (already in the stack for truetaxstrategies):

```sh
npx wrangler pages deploy . --project-name ago
```

PWA install requires HTTPS — any Pages/Netlify/GH-Pages URL qualifies.

## Monetization path (later, keep v1 free)

1. Free forever core (it's a wedge, not the business).
2. **Pro one-time $2.99** (Gumroad license key pasted into the app — no backend):
   home-screen widget via shortcut, notification when an item goes red
   (Push API), unlimited items (free tier caps at ~10), themes.
3. App-store wrapper later only if traction (Capacitor, same codebase).

## Files

| file | purpose |
|---|---|
| `index.html` | entire app — UI, logic, storage (no dependencies, no build step) |
| `sw.js` | offline cache |
| `manifest.webmanifest` | install metadata |
| `icons/` | 192/512 PNG, generated |
