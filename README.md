# Mobile-First Personal Diary Web App

A calm, private diary app optimized for smartphones. This revision is **self-contained** and works without installing npm packages.

## Why this fix
The previous build depended on external npm packages that could not be installed in restricted environments. This version removes that blocker and runs with plain Node.js.

## Tech Stack
- Frontend: HTML/CSS/Vanilla JS (mobile-first)
- Runtime server: Node.js built-in `http` static server
- Storage: Browser `localStorage` (encrypted diary payload)
- Crypto: Browser Web Crypto API (`PBKDF2 + AES-GCM`)

## Features
- Register/login with password
- Password change
- Private diary entries (date/title/rich text/multiple photos)
- Photo compression in-browser for mobile performance
- Auto-save draft
- Spell-fix helper + browser spellcheck
- Search/filter by keyword/month/year/date-range
- Notes section with categories and editing
- Reminder notifications (browser notification fallback to alert)
- Light/dark theme
- Export text + Print to PDF
- Backup and restore JSON
- Bottom mobile navigation and calm diary-style design

## Data model
- Local encrypted object stored in browser:
  - `entries[]`
  - `notes[]`
  - `reminders[]`
  - `settings`

A relational SQL schema is still included in `schema.sql` as an optional cloud/backend upgrade target.

## Run
```bash
npm start
```
Then open:
- `http://localhost:3000`

For phone access on same Wi‑Fi:
- `http://<your-computer-ip>:3000`

## Security notes
- Password-gated access with encrypted diary payload at rest in browser storage.
- This is local-first privacy, not enterprise-grade server-side security.
- For multi-device sync/cloud, migrate to backend DB (see `schema.sql`).
