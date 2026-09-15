# Study Tracker

A calm, minimal timer for tracking study and revision time — built for iPad, works everywhere.

## Features

- Timer with Start / Pause / Resume / Finish, accurate across app switches, lock screen, and refreshes (timestamp-based, not interval-based)
- Manual session add / edit / delete
- Custom subjects with colours used consistently across the app
- Dashboard with today / week / month totals, weekly target progress, subject donut chart, Study vs Revision comparison, and a 7/30-day bar chart
- History grouped by day
- Stats: lifetime total, daily average, most-studied subject, session count, average session length, Study vs Revision split
- Local-only storage (`localStorage`) — no account, no server, no database
- Export / Import JSON backup with validation
- Installable as a Home Screen app (PWA), works offline, light & dark mode

## Deploying to Netlify

This is a static site — no build step required.

1. Push this repository to GitHub (or your Git provider of choice).
2. In Netlify: **Add new site → Import an existing project**, pick this repo.
3. Build settings: leave the build command empty, set publish directory to `.` (already configured in `netlify.toml`).
4. Deploy.

Or, for a quick manual deploy, drag the project folder onto [app.netlify.com/drop](https://app.netlify.com/drop).

## Installing on iPad

1. Open the deployed site in Safari.
2. Tap the Share icon → **Add to Home Screen**.
3. Launch it from the Home Screen — it runs full-screen, standalone, like a native app.

## Local development

No build tools needed. Serve the folder with any static file server, e.g.:

```
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Data & backups

All data lives in your browser's `localStorage` on this device only. Use **Settings → Export data** regularly to keep a JSON backup, and **Import data** to restore it (on this device or a new one).
