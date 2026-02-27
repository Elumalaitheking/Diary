# Mobile-First Personal Diary Web App

A calm, private diary application designed for smartphone browsers. It supports secure authentication, diary entries with photos, searchable notes, reminders, theme switching, and backup/export.

## Tech Stack
- **Frontend:** Vanilla HTML/CSS/JS (mobile-first responsive)
- **Backend:** Node.js + Express
- **Database:** SQLite via better-sqlite3
- **Image processing:** sharp (auto compression / resize)
- **Auth:** JWT + bcrypt password hashing

## Features Implemented
1. Secure user registration/login with hashed password and JWT authentication.
2. Password change workflow.
3. Diary entries with date, title, rich text (contenteditable), and multi-photo upload.
4. Photo compression on upload for mobile performance.
5. Autosave drafts in localStorage.
6. Auto-correction helper for common spelling mistakes plus browser spellcheck/autocapitalize.
7. Search/filter entries by keyword, month, year, start/end date.
8. Notes section with categories (personal, learning, ideas), editing, and search.
9. Reminder system with browser notifications fallback to alert.
10. Bottom navigation optimized for phone use.
11. Theme toggle (light/dark) saved per user.
12. Export entries/notes as text and PDF through print dialog.
13. Backup/restore JSON for data portability.

## Project Structure
- `server.js` - API server and SQLite initialization
- `schema.sql` - database schema reference
- `public/index.html` - app UI
- `public/styles.css` - mobile-first diary styling
- `public/app.js` - frontend behavior and API integration
- `uploads/` - compressed uploaded images
- `diary.db` - generated SQLite database

## Setup Instructions
1. Install dependencies:
   ```bash
   npm install
   ```
2. Start server:
   ```bash
   npm start
   ```
3. Open in browser:
   - Local: `http://localhost:3000`
   - On same Wi-Fi phone: `http://<your-computer-ip>:3000`

## Mobile Use Tips
- Add the site to your phone home screen for app-like use.
- Allow notifications to receive reminder alerts.
- Use camera/gallery upload directly from the entry form.

## Security Notes
- Passwords are hashed using bcrypt.
- Protected API routes require valid JWT.
- Helmet is enabled for baseline HTTP security headers.
- Set a strong secret in production:
  ```bash
  JWT_SECRET="very-strong-secret" npm start
  ```

## Cloud Upgrade Path
Current storage is local SQLite + filesystem. To move to cloud:
- Replace SQLite with PostgreSQL/MySQL managed DB.
- Move uploads to object storage (S3/R2/GCS).
- Keep API contract similar so frontend changes are minimal.
