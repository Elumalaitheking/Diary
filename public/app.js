const STORE_KEY = 'diaryStoreV1';
const SESSION_KEY = 'diarySessionV1';

const state = {
  mode: 'login',
  unlockedKey: null,
  data: null,
  reminderTimers: [],
  notesEditingId: null
};

const el = (id) => document.getElementById(id);
const views = ['homeSection', 'entrySection', 'searchSection', 'notesSection', 'settingsSection'];

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const nowIso = () => new Date().toISOString();

function getStore() {
  return JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
}

function setStore(v) {
  localStorage.setItem(STORE_KEY, JSON.stringify(v));
}

async function sha256(input) {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)));
}

async function deriveKey(password, saltB64) {
  const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
  const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 120000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptJson(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = new TextEncoder().encode(JSON.stringify(obj));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, pt);
  return {
    iv: btoa(String.fromCharCode(...iv)),
    cipher: btoa(String.fromCharCode(...new Uint8Array(ct)))
  };
}

async function decryptJson(key, payload) {
  const iv = Uint8Array.from(atob(payload.iv), c => c.charCodeAt(0));
  const ct = Uint8Array.from(atob(payload.cipher), c => c.charCodeAt(0));
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return JSON.parse(new TextDecoder().decode(pt));
}

function setView(viewId) {
  views.forEach(id => el(id).classList.toggle('hidden', id !== viewId));
  document.querySelectorAll('.bottom-nav button').forEach(btn => btn.classList.toggle('active', btn.dataset.view === viewId));
  el('pageTitle').textContent = {
    homeSection: 'Home', entrySection: 'Add Entry', searchSection: 'Search', notesSection: 'Notes', settingsSection: 'Settings'
  }[viewId];
}

function showAuthMessage(msg, bad = false) {
  el('authMessage').textContent = msg;
  el('authMessage').style.color = bad ? '#9d2f2f' : '';
}

async function persistData() {
  const store = getStore();
  if (!store || !state.unlockedKey || !state.data) return;
  store.encrypted = await encryptJson(state.unlockedKey, state.data);
  setStore(store);
}

function applyTheme() {
  document.body.className = state.data?.settings?.theme === 'dark' ? 'theme-dark' : 'theme-light';
}

function setAuthUi() {
  const loggedIn = !!state.unlockedKey;
  el('authView').classList.toggle('hidden', loggedIn);
  el('appView').classList.toggle('hidden', !loggedIn);
  if (loggedIn) {
    applyTheme();
    setView('homeSection');
    refreshHome();
    loadNotes();
    loadReminders();
  }
}

async function registerOrLogin(e) {
  e.preventDefault();
  const username = el('username').value.trim();
  const password = el('password').value;
  if (!username || password.length < 8) {
    showAuthMessage('Username and password (8+ chars) required.', true);
    return;
  }

  const store = getStore();
  if (state.mode === 'register') {
    if (store) return showAuthMessage('Diary already initialized. Please login.', true);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const saltB64 = btoa(String.fromCharCode(...salt));
    const passwordHash = await sha256(`${username}:${password}`);
    const key = await deriveKey(password, saltB64);
    const baseData = { entries: [], notes: [], reminders: [], settings: { theme: 'light' } };
    const encrypted = await encryptJson(key, baseData);
    setStore({ username, passwordHash, salt: saltB64, encrypted });
    localStorage.setItem(SESSION_KEY, username);
    state.unlockedKey = key;
    state.data = baseData;
    setAuthUi();
    showAuthMessage('Diary created successfully.');
    return;
  }

  if (!store) return showAuthMessage('No diary found yet. Please register first.', true);
  const passwordHash = await sha256(`${username}:${password}`);
  if (store.username !== username || store.passwordHash !== passwordHash) {
    return showAuthMessage('Invalid credentials.', true);
  }

  try {
    const key = await deriveKey(password, store.salt);
    const data = await decryptJson(key, store.encrypted);
    state.unlockedKey = key;
    state.data = data;
    localStorage.setItem(SESSION_KEY, username);
    showAuthMessage('Welcome back.');
    setAuthUi();
  } catch {
    showAuthMessage('Unable to decrypt diary (wrong password/data corruption).', true);
  }
}

function renderEntryCard(entry) {
  const photos = (entry.photos || []).map(p => `<img src="${p}" alt="Diary photo" loading="lazy"/>`).join('');
  return `<article class="entry-card card"><h4>${entry.entryDate} · ${entry.title}</h4><div>${entry.contentHtml}</div>${photos}</article>`;
}

function refreshHome() {
  const entries = [...state.data.entries].sort((a, b) => b.entryDate.localeCompare(a.entryDate));
  el('homeSection').innerHTML = `<h3>Recent Entries</h3>${entries.length ? entries.map(renderEntryCard).join('') : '<p class="muted">No entries yet.</p>'}`;
}

function autoCorrectContent() {
  const fixes = { teh: 'the', recieve: 'receive', definately: 'definitely', occured: 'occurred', seperate: 'separate' };
  let html = el('entryContent').innerHTML;
  Object.entries(fixes).forEach(([w, r]) => html = html.replace(new RegExp(`\\b${w}\\b`, 'gi'), r));
  el('entryContent').innerHTML = html;
}

async function compressToDataUrl(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  const maxW = 1280;
  const scale = Math.min(1, maxW / bitmap.width);
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.75);
}

async function saveEntry(e) {
  e.preventDefault();
  const files = [...el('entryPhotos').files];
  const photos = [];
  for (const f of files) photos.push(await compressToDataUrl(f));
  state.data.entries.push({
    id: uid(),
    entryDate: el('entryDate').value,
    title: el('entryTitle').value,
    contentHtml: el('entryContent').innerHTML,
    photos,
    createdAt: nowIso()
  });
  await persistData();
  localStorage.removeItem('entryDraft');
  el('entryForm').reset();
  el('entryDate').valueAsDate = new Date();
  el('entryContent').innerHTML = '';
  el('draftStatus').textContent = 'Saved!';
  refreshHome();
}

function runSearch() {
  const keyword = el('searchKeyword').value.toLowerCase();
  const month = el('searchMonth').value.padStart(2, '0');
  const year = el('searchYear').value;
  const start = el('startDate').value;
  const end = el('endDate').value;
  const out = state.data.entries.filter(x => {
    if (keyword && !(x.title.toLowerCase().includes(keyword) || x.contentHtml.toLowerCase().includes(keyword))) return false;
    if (month && x.entryDate.slice(5, 7) !== month) return false;
    if (year && x.entryDate.slice(0, 4) !== year) return false;
    if (start && x.entryDate < start) return false;
    if (end && x.entryDate > end) return false;
    return true;
  }).sort((a,b)=>b.entryDate.localeCompare(a.entryDate));
  el('searchResults').innerHTML = out.length ? out.map(renderEntryCard).join('') : '<p class="muted">No matches found.</p>';
}

async function saveNote(e) {
  e.preventDefault();
  if (state.notesEditingId) {
    const n = state.data.notes.find(x => x.id === state.notesEditingId);
    Object.assign(n, { category: el('noteCategory').value, title: el('noteTitle').value, content: el('noteContent').value, updatedAt: nowIso() });
    state.notesEditingId = null;
  } else {
    state.data.notes.push({ id: uid(), category: el('noteCategory').value, title: el('noteTitle').value, content: el('noteContent').value, updatedAt: nowIso() });
  }
  await persistData();
  el('noteForm').reset();
  loadNotes();
}

function loadNotes() {
  const q = el('noteSearch').value.toLowerCase();
  const notes = [...state.data.notes].filter(n => !q || n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q));
  el('noteResults').innerHTML = notes.length ? notes.map(n => `<article class="card"><strong>[${n.category}] ${n.title}</strong><p>${n.content.replace(/\n/g, '<br/>')}</p><button onclick="editNote('${n.id}')">Edit</button></article>`).join('') : '<p class="muted">No notes yet.</p>';
}

window.editNote = (id) => {
  const n = state.data.notes.find(x => x.id === id);
  if (!n) return;
  state.notesEditingId = id;
  el('noteCategory').value = n.category;
  el('noteTitle').value = n.title;
  el('noteContent').value = n.content;
  setView('notesSection');
};

async function saveReminder(e) {
  e.preventDefault();
  state.data.reminders.push({ id: uid(), title: el('reminderTitle').value, reminderType: el('reminderType').value, remindAt: new Date(el('reminderTime').value).toISOString(), done: false });
  await persistData();
  e.target.reset();
  loadReminders();
}

function loadReminders() {
  state.reminderTimers.forEach(clearTimeout);
  state.reminderTimers = [];
  const items = [...state.data.reminders].sort((a,b)=>a.remindAt.localeCompare(b.remindAt));
  el('reminderList').innerHTML = items.length ? items.map(r => `<article class="card"><strong>${r.title}</strong><p>${new Date(r.remindAt).toLocaleString()} · ${r.reminderType}</p></article>`).join('') : '<p class="muted">No reminders.</p>';
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  items.filter(r => !r.done).forEach(r => {
    const delay = new Date(r.remindAt).getTime() - Date.now();
    if (delay > 0 && delay < 2147483647) {
      state.reminderTimers.push(setTimeout(() => {
        if ('Notification' in window && Notification.permission === 'granted') new Notification('Diary Reminder', { body: r.title });
        else alert(`Reminder: ${r.title}`);
      }, delay));
    }
  });
}

async function toggleTheme() {
  state.data.settings.theme = state.data.settings.theme === 'dark' ? 'light' : 'dark';
  applyTheme();
  await persistData();
}

async function changePassword(e) {
  e.preventDefault();
  const current = el('currentPassword').value;
  const next = el('newPassword').value;
  const store = getStore();
  const username = store.username;
  if (await sha256(`${username}:${current}`) !== store.passwordHash) return alert('Current password is incorrect');
  if (!next || next.length < 8) return alert('New password must be at least 8 characters');
  store.passwordHash = await sha256(`${username}:${next}`);
  state.unlockedKey = await deriveKey(next, store.salt);
  store.encrypted = await encryptJson(state.unlockedKey, state.data);
  setStore(store);
  e.target.reset();
  alert('Password changed');
}

function exportText() {
  const lines = ['Personal Diary Export', `Generated: ${new Date().toISOString()}`, '', '=== Entries ==='];
  state.data.entries.forEach(e => lines.push(`${e.entryDate} - ${e.title}\n${e.contentHtml.replace(/<[^>]*>/g, '')}\n`));
  lines.push('=== Notes ===');
  state.data.notes.forEach(n => lines.push(`[${n.category}] ${n.title}\n${n.content}\n`));
  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'diary-export.txt';
  a.click();
}

function backupJson() {
  const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'diary-backup.json';
  a.click();
}

async function restoreBackup(file) {
  const data = JSON.parse(await file.text());
  if (!data.entries || !data.notes || !data.reminders || !data.settings) return alert('Invalid backup format');
  state.data = data;
  await persistData();
  refreshHome();
  loadNotes();
  loadReminders();
  applyTheme();
  alert('Backup restored');
}

function setupDraftAutosave() {
  const load = () => {
    const d = JSON.parse(localStorage.getItem('entryDraft') || '{}');
    if (d.entryDate) el('entryDate').value = d.entryDate;
    if (d.title) el('entryTitle').value = d.title;
    if (d.contentHtml) el('entryContent').innerHTML = d.contentHtml;
  };
  const save = () => {
    localStorage.setItem('entryDraft', JSON.stringify({ entryDate: el('entryDate').value, title: el('entryTitle').value, contentHtml: el('entryContent').innerHTML }));
    el('draftStatus').textContent = `Draft auto-saved at ${new Date().toLocaleTimeString()}`;
  };
  load();
  ['input', 'keyup'].forEach(evt => {
    el('entryDate').addEventListener(evt, save);
    el('entryTitle').addEventListener(evt, save);
    el('entryContent').addEventListener(evt, save);
  });
}

function bindEvents() {
  el('authForm').addEventListener('submit', registerOrLogin);
  el('showLogin').addEventListener('click', () => { state.mode = 'login'; el('showLogin').classList.add('active'); el('showRegister').classList.remove('active'); });
  el('showRegister').addEventListener('click', () => { state.mode = 'register'; el('showRegister').classList.add('active'); el('showLogin').classList.remove('active'); });
  el('logoutBtn').addEventListener('click', () => { state.unlockedKey = null; state.data = null; localStorage.removeItem(SESSION_KEY); setAuthUi(); });
  document.querySelectorAll('.bottom-nav button').forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.view)));
  document.querySelectorAll('.toolbar button[data-cmd]').forEach(btn => btn.addEventListener('click', () => document.execCommand(btn.dataset.cmd, false)));
  el('spellFixBtn').addEventListener('click', autoCorrectContent);
  el('entryForm').addEventListener('submit', saveEntry);
  el('runSearch').addEventListener('click', runSearch);
  el('noteForm').addEventListener('submit', saveNote);
  el('noteSearch').addEventListener('input', loadNotes);
  el('reminderForm').addEventListener('submit', saveReminder);
  el('toggleTheme').addEventListener('click', toggleTheme);
  el('exportText').addEventListener('click', exportText);
  el('printPdf').addEventListener('click', () => window.print());
  el('downloadBackup').addEventListener('click', backupJson);
  el('restoreBackup').addEventListener('change', (e) => e.target.files[0] && restoreBackup(e.target.files[0]));
  el('passwordForm').addEventListener('submit', changePassword);
}

window.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  el('entryDate').valueAsDate = new Date();
  setupDraftAutosave();
  setAuthUi();
});
