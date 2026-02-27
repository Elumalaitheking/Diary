const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const sharp = require('sharp');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';
const db = new Database(path.join(__dirname, 'diary.db'));

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      entry_date TEXT NOT NULL,
      title TEXT NOT NULL,
      content_html TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS entry_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      category TEXT CHECK(category IN ('personal','learning','ideas')) NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      reminder_type TEXT CHECK(reminder_type IN ('event','learning','task')) NOT NULL,
      remind_at TEXT NOT NULL,
      done INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      theme TEXT DEFAULT 'light',
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_entries_user_date ON entries(user_id, entry_date);
    CREATE INDEX IF NOT EXISTS idx_notes_user_category ON notes(user_id, category);
    CREATE INDEX IF NOT EXISTS idx_reminders_user_time ON reminders(user_id, remind_at);
  `);
}

initDb();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 8 }
});

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'Missing authorization header' });

  const token = header.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Invalid authorization header' });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
}

app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password || password.length < 8) {
    return res.status(400).json({ error: 'Username and password (8+ chars) are required' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return res.status(409).json({ error: 'Username already exists' });

  const hash = bcrypt.hashSync(password, 12);
  const result = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hash);
  db.prepare('INSERT INTO app_settings (user_id, theme) VALUES (?, ?)').run(result.lastInsertRowid, 'light');
  const user = { id: result.lastInsertRowid, username };
  res.status(201).json({ token: signToken(user), user });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  res.json({ token: signToken(user), user: { id: user.id, username: user.username } });
});

app.post('/api/change-password', auth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  const hash = bcrypt.hashSync(newPassword, 12);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
  res.json({ message: 'Password changed successfully' });
});

app.post('/api/upload', auth, upload.array('photos', 8), async (req, res) => {
  try {
    const savedPaths = [];
    for (const file of req.files || []) {
      const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      const outputPath = path.join(__dirname, 'uploads', safeName);
      await sharp(file.buffer)
        .rotate()
        .resize({ width: 1600, withoutEnlargement: true })
        .jpeg({ quality: 75 })
        .toFile(outputPath);
      savedPaths.push(`/uploads/${safeName}`);
    }
    res.json({ files: savedPaths });
  } catch (error) {
    res.status(500).json({ error: 'Unable to process images', details: error.message });
  }
});

app.post('/api/entries', auth, (req, res) => {
  const { entryDate, title, contentHtml, photos = [] } = req.body;
  if (!entryDate || !title || !contentHtml) return res.status(400).json({ error: 'entryDate, title and contentHtml are required' });

  const tx = db.transaction(() => {
    const entry = db.prepare(
      'INSERT INTO entries (user_id, entry_date, title, content_html) VALUES (?, ?, ?, ?)'
    ).run(req.user.id, entryDate, title, contentHtml);

    for (const photo of photos) {
      db.prepare('INSERT INTO entry_photos (entry_id, file_path) VALUES (?, ?)').run(entry.lastInsertRowid, photo);
    }

    return entry.lastInsertRowid;
  });

  const id = tx();
  res.status(201).json({ id });
});

app.get('/api/entries', auth, (req, res) => {
  const { keyword = '', startDate, endDate, month, year } = req.query;
  let sql = `
    SELECT e.*, GROUP_CONCAT(p.file_path) AS photos
    FROM entries e
    LEFT JOIN entry_photos p ON p.entry_id = e.id
    WHERE e.user_id = ?
  `;
  const params = [req.user.id];

  if (keyword) {
    sql += ' AND (e.title LIKE ? OR e.content_html LIKE ?)';
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  if (startDate) {
    sql += ' AND e.entry_date >= ?';
    params.push(startDate);
  }
  if (endDate) {
    sql += ' AND e.entry_date <= ?';
    params.push(endDate);
  }
  if (month) {
    sql += ' AND strftime("%m", e.entry_date) = ?';
    params.push(String(month).padStart(2, '0'));
  }
  if (year) {
    sql += ' AND strftime("%Y", e.entry_date) = ?';
    params.push(String(year));
  }

  sql += ' GROUP BY e.id ORDER BY e.entry_date DESC, e.created_at DESC';
  const entries = db.prepare(sql).all(...params).map((entry) => ({
    ...entry,
    photos: entry.photos ? entry.photos.split(',') : []
  }));

  res.json(entries);
});

app.get('/api/notes', auth, (req, res) => {
  const { keyword = '', category = '' } = req.query;
  let sql = 'SELECT * FROM notes WHERE user_id = ?';
  const params = [req.user.id];

  if (keyword) {
    sql += ' AND (title LIKE ? OR content LIKE ?)';
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }

  sql += ' ORDER BY updated_at DESC';
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/notes', auth, (req, res) => {
  const { category, title, content } = req.body;
  if (!category || !title || !content) return res.status(400).json({ error: 'category, title, content are required' });
  const result = db.prepare('INSERT INTO notes (user_id, category, title, content) VALUES (?, ?, ?, ?)')
    .run(req.user.id, category, title, content);
  res.status(201).json({ id: result.lastInsertRowid });
});

app.put('/api/notes/:id', auth, (req, res) => {
  const { category, title, content } = req.body;
  db.prepare('UPDATE notes SET category=?, title=?, content=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?')
    .run(category, title, content, req.params.id, req.user.id);
  res.json({ message: 'Updated' });
});

app.get('/api/reminders', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM reminders WHERE user_id = ? ORDER BY remind_at ASC').all(req.user.id));
});

app.post('/api/reminders', auth, (req, res) => {
  const { title, reminderType, remindAt } = req.body;
  if (!title || !reminderType || !remindAt) return res.status(400).json({ error: 'title, reminderType, remindAt required' });
  const result = db.prepare('INSERT INTO reminders (user_id, title, reminder_type, remind_at) VALUES (?, ?, ?, ?)')
    .run(req.user.id, title, reminderType, remindAt);
  res.status(201).json({ id: result.lastInsertRowid });
});

app.put('/api/reminders/:id/done', auth, (req, res) => {
  db.prepare('UPDATE reminders SET done = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ message: 'Reminder marked done' });
});

app.get('/api/settings', auth, (req, res) => {
  const settings = db.prepare('SELECT theme FROM app_settings WHERE user_id = ?').get(req.user.id) || { theme: 'light' };
  res.json(settings);
});

app.put('/api/settings/theme', auth, (req, res) => {
  const { theme } = req.body;
  db.prepare('INSERT INTO app_settings (user_id, theme) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET theme=excluded.theme, updated_at=CURRENT_TIMESTAMP')
    .run(req.user.id, theme === 'dark' ? 'dark' : 'light');
  res.json({ message: 'Theme updated' });
});

app.get('/api/export/text', auth, (req, res) => {
  const entries = db.prepare('SELECT entry_date, title, content_html FROM entries WHERE user_id = ? ORDER BY entry_date DESC').all(req.user.id);
  const notes = db.prepare('SELECT category, title, content FROM notes WHERE user_id = ? ORDER BY updated_at DESC').all(req.user.id);

  const text = [
    'Personal Diary Export',
    `Generated: ${new Date().toISOString()}`,
    '',
    '=== Entries ===',
    ...entries.map((e) => `${e.entry_date} - ${e.title}\n${e.content_html.replace(/<[^>]*>/g, '')}`),
    '',
    '=== Notes ===',
    ...notes.map((n) => `[${n.category}] ${n.title}\n${n.content}`)
  ].join('\n\n');

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', 'attachment; filename="diary-export.txt"');
  res.send(text);
});

app.get('/api/backup', auth, (req, res) => {
  const backup = {
    entries: db.prepare('SELECT * FROM entries WHERE user_id = ?').all(req.user.id),
    photos: db.prepare('SELECT p.* FROM entry_photos p JOIN entries e ON e.id=p.entry_id WHERE e.user_id=?').all(req.user.id),
    notes: db.prepare('SELECT * FROM notes WHERE user_id = ?').all(req.user.id),
    reminders: db.prepare('SELECT * FROM reminders WHERE user_id = ?').all(req.user.id)
  };
  res.json(backup);
});

app.post('/api/restore', auth, (req, res) => {
  const { entries = [], photos = [], notes = [], reminders = [] } = req.body;
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM entry_photos WHERE entry_id IN (SELECT id FROM entries WHERE user_id = ?)').run(req.user.id);
    db.prepare('DELETE FROM entries WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM notes WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM reminders WHERE user_id = ?').run(req.user.id);

    const entryMap = new Map();
    for (const e of entries) {
      const result = db.prepare('INSERT INTO entries (user_id, entry_date, title, content_html, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(req.user.id, e.entry_date, e.title, e.content_html, e.created_at || new Date().toISOString(), e.updated_at || new Date().toISOString());
      entryMap.set(e.id, result.lastInsertRowid);
    }
    for (const p of photos) {
      const newEntryId = entryMap.get(p.entry_id);
      if (newEntryId) db.prepare('INSERT INTO entry_photos (entry_id, file_path, created_at) VALUES (?, ?, ?)').run(newEntryId, p.file_path, p.created_at || new Date().toISOString());
    }
    for (const n of notes) {
      db.prepare('INSERT INTO notes (user_id, category, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(req.user.id, n.category, n.title, n.content, n.created_at || new Date().toISOString(), n.updated_at || new Date().toISOString());
    }
    for (const r of reminders) {
      db.prepare('INSERT INTO reminders (user_id, title, reminder_type, remind_at, done, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(req.user.id, r.title, r.reminder_type, r.remind_at, r.done ? 1 : 0, r.created_at || new Date().toISOString());
    }
  });

  tx();
  res.json({ message: 'Backup restored' });
});

app.get('*', (_, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Diary app running at http://localhost:${PORT}`);
});
