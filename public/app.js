const state = {
  token: localStorage.getItem('token') || '',
  mode: 'login',
  notesEditingId: null,
  reminderTimers: []
};

const api = async (url, options = {}) => {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || 'Request failed');
  }
  const contentType = res.headers.get('content-type') || '';
  return contentType.includes('application/json') ? res.json() : res;
};

const el = (id) => document.getElementById(id);
const views = ['homeSection', 'entrySection', 'searchSection', 'notesSection', 'settingsSection'];

function setView(viewId) {
  views.forEach((id) => el(id).classList.toggle('hidden', id !== viewId));
  document.querySelectorAll('.bottom-nav button').forEach((btn) => btn.classList.toggle('active', btn.dataset.view === viewId));
  el('pageTitle').textContent = {
    homeSection: 'Home',
    entrySection: 'Add Entry',
    searchSection: 'Search',
    notesSection: 'Notes',
    settingsSection: 'Settings'
  }[viewId];
}

function showMessage(msg, isError = false) {
  el('authMessage').textContent = msg;
  el('authMessage').style.color = isError ? '#9d2f2f' : '';
}

function setAuthUi() {
  const loggedIn = Boolean(state.token);
  el('authView').classList.toggle('hidden', loggedIn);
  el('appView').classList.toggle('hidden', !loggedIn);
  if (loggedIn) {
    setView('homeSection');
    loadTheme();
    refreshHome();
    loadNotes();
    loadReminders();
  }
}

async function authenticate(e) {
  e.preventDefault();
  try {
    const endpoint = state.mode === 'login' ? '/api/login' : '/api/register';
    const data = await api(endpoint, {
      method: 'POST',
      body: JSON.stringify({ username: el('username').value.trim(), password: el('password').value })
    });
    state.token = data.token;
    localStorage.setItem('token', data.token);
    showMessage('Welcome back!');
    setAuthUi();
  } catch (error) {
    showMessage(error.message, true);
  }
}

async function uploadPhotos(files) {
  if (!files.length) return [];
  const fd = new FormData();
  [...files].forEach((f) => fd.append('photos', f));
  const res = await fetch('/api/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${state.token}` },
    body: fd
  });
  if (!res.ok) throw new Error('Photo upload failed');
  const data = await res.json();
  return data.files;
}

function autoCorrectContent() {
  const rules = {
    teh: 'the',
    recieve: 'receive',
    definately: 'definitely',
    occured: 'occurred',
    seperate: 'separate'
  };
  let html = el('entryContent').innerHTML;
  Object.entries(rules).forEach(([wrong, right]) => {
    html = html.replace(new RegExp(`\\b${wrong}\\b`, 'gi'), right);
  });
  el('entryContent').innerHTML = html;
}

async function saveEntry(e) {
  e.preventDefault();
  try {
    const photos = await uploadPhotos(el('entryPhotos').files);
    await api('/api/entries', {
      method: 'POST',
      body: JSON.stringify({
        entryDate: el('entryDate').value,
        title: el('entryTitle').value,
        contentHtml: el('entryContent').innerHTML,
        photos
      })
    });
    localStorage.removeItem('entryDraft');
    el('draftStatus').textContent = 'Saved!';
    el('entryForm').reset();
    el('entryContent').innerHTML = '';
    refreshHome();
  } catch (error) {
    el('draftStatus').textContent = error.message;
  }
}

async function refreshHome() {
  const entries = await api('/api/entries');
  el('homeSection').innerHTML = `<h3>Recent Entries</h3>${entries.length ? entries.map(renderEntryCard).join('') : '<p class="muted">No entries yet.</p>'}`;
}

function renderEntryCard(entry) {
  const photosHtml = entry.photos.map((src) => `<img src="${src}" alt="Diary photo" loading="lazy" />`).join('');
  return `<article class="entry-card card">
    <h4>${entry.entry_date} · ${entry.title}</h4>
    <div>${entry.content_html}</div>
    ${photosHtml}
  </article>`;
}

async function runSearch() {
  const params = new URLSearchParams({
    keyword: el('searchKeyword').value,
    month: el('searchMonth').value,
    year: el('searchYear').value,
    startDate: el('startDate').value,
    endDate: el('endDate').value
  });
  const entries = await api(`/api/entries?${params.toString()}`);
  el('searchResults').innerHTML = entries.length ? entries.map(renderEntryCard).join('') : '<p class="muted">No matches found.</p>';
}

async function saveNote(e) {
  e.preventDefault();
  const payload = {
    category: el('noteCategory').value,
    title: el('noteTitle').value,
    content: el('noteContent').value
  };
  if (state.notesEditingId) {
    await api(`/api/notes/${state.notesEditingId}`, { method: 'PUT', body: JSON.stringify(payload) });
    state.notesEditingId = null;
  } else {
    await api('/api/notes', { method: 'POST', body: JSON.stringify(payload) });
  }
  el('noteForm').reset();
  loadNotes();
}

async function loadNotes() {
  const keyword = el('noteSearch').value || '';
  const notes = await api(`/api/notes?keyword=${encodeURIComponent(keyword)}`);
  el('noteResults').innerHTML = notes.length ? notes.map((n) => `
    <article class="card">
      <strong>[${n.category}] ${n.title}</strong>
      <p>${n.content.replace(/\n/g, '<br/>')}</p>
      <button onclick='editNote(${JSON.stringify(n)})'>Edit</button>
    </article>`).join('') : '<p class="muted">No notes yet.</p>';
}

window.editNote = (note) => {
  state.notesEditingId = note.id;
  el('noteCategory').value = note.category;
  el('noteTitle').value = note.title;
  el('noteContent').value = note.content;
  setView('notesSection');
};

async function saveReminder(e) {
  e.preventDefault();
  await api('/api/reminders', {
    method: 'POST',
    body: JSON.stringify({
      title: el('reminderTitle').value,
      reminderType: el('reminderType').value,
      remindAt: new Date(el('reminderTime').value).toISOString()
    })
  });
  el('reminderForm').reset();
  loadReminders();
}

async function loadReminders() {
  state.reminderTimers.forEach(clearTimeout);
  state.reminderTimers = [];

  const reminders = await api('/api/reminders');
  el('reminderList').innerHTML = reminders.length ? reminders.map((r) =>
    `<article class="card"><strong>${r.title}</strong><p>${new Date(r.remind_at).toLocaleString()} · ${r.reminder_type}</p></article>`).join('') : '<p class="muted">No reminders.</p>';

  if (Notification.permission === 'default') Notification.requestPermission();
  reminders.filter((r) => !r.done).forEach((r) => {
    const delay = new Date(r.remind_at).getTime() - Date.now();
    if (delay > 0 && delay < 2147483647) {
      const timer = setTimeout(() => {
        if (Notification.permission === 'granted') {
          new Notification('Diary Reminder', { body: r.title });
        } else {
          alert(`Reminder: ${r.title}`);
        }
      }, delay);
      state.reminderTimers.push(timer);
    }
  });
}

async function loadTheme() {
  const { theme } = await api('/api/settings');
  document.body.className = theme === 'dark' ? 'theme-dark' : 'theme-light';
}

async function toggleTheme() {
  const next = document.body.classList.contains('theme-dark') ? 'light' : 'dark';
  await api('/api/settings/theme', { method: 'PUT', body: JSON.stringify({ theme: next }) });
  document.body.className = next === 'dark' ? 'theme-dark' : 'theme-light';
}

async function changePassword(e) {
  e.preventDefault();
  try {
    await api('/api/change-password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: el('currentPassword').value,
        newPassword: el('newPassword').value
      })
    });
    alert('Password changed successfully');
    e.target.reset();
  } catch (error) {
    alert(error.message);
  }
}

async function exportText() {
  const res = await fetch('/api/export/text', {
    headers: { Authorization: `Bearer ${state.token}` }
  });
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'diary-export.txt';
  a.click();
}

async function downloadBackup() {
  const data = await api('/api/backup');
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'diary-backup.json';
  a.click();
}

async function restoreBackup(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  await api('/api/restore', { method: 'POST', body: JSON.stringify(data) });
  alert('Backup restored');
  refreshHome();
  loadNotes();
  loadReminders();
}

function setupDraftAutosave() {
  const loadDraft = () => {
    const draft = JSON.parse(localStorage.getItem('entryDraft') || '{}');
    if (draft.entryDate) el('entryDate').value = draft.entryDate;
    if (draft.title) el('entryTitle').value = draft.title;
    if (draft.contentHtml) el('entryContent').innerHTML = draft.contentHtml;
  };
  const saveDraft = () => {
    const draft = {
      entryDate: el('entryDate').value,
      title: el('entryTitle').value,
      contentHtml: el('entryContent').innerHTML
    };
    localStorage.setItem('entryDraft', JSON.stringify(draft));
    el('draftStatus').textContent = `Draft auto-saved at ${new Date().toLocaleTimeString()}`;
  };

  loadDraft();
  ['input', 'keyup'].forEach((evt) => {
    el('entryTitle').addEventListener(evt, saveDraft);
    el('entryContent').addEventListener(evt, saveDraft);
    el('entryDate').addEventListener(evt, saveDraft);
  });
}

function bindEvents() {
  el('authForm').addEventListener('submit', authenticate);
  el('showLogin').addEventListener('click', () => {
    state.mode = 'login';
    el('showLogin').classList.add('active');
    el('showRegister').classList.remove('active');
  });
  el('showRegister').addEventListener('click', () => {
    state.mode = 'register';
    el('showRegister').classList.add('active');
    el('showLogin').classList.remove('active');
  });

  el('logoutBtn').addEventListener('click', () => {
    state.token = '';
    localStorage.removeItem('token');
    setAuthUi();
  });

  document.querySelectorAll('.bottom-nav button').forEach((btn) => btn.addEventListener('click', () => setView(btn.dataset.view)));
  document.querySelectorAll('.toolbar button[data-cmd]').forEach((btn) => btn.addEventListener('click', () => document.execCommand(btn.dataset.cmd, false)));
  el('spellFixBtn').addEventListener('click', autoCorrectContent);
  el('entryForm').addEventListener('submit', saveEntry);
  el('runSearch').addEventListener('click', runSearch);
  el('noteForm').addEventListener('submit', saveNote);
  el('noteSearch').addEventListener('input', loadNotes);
  el('reminderForm').addEventListener('submit', saveReminder);
  el('toggleTheme').addEventListener('click', toggleTheme);
  el('exportText').addEventListener('click', exportText);
  el('printPdf').addEventListener('click', () => window.print());
  el('downloadBackup').addEventListener('click', downloadBackup);
  el('restoreBackup').addEventListener('change', (e) => e.target.files[0] && restoreBackup(e.target.files[0]));
  el('passwordForm').addEventListener('submit', changePassword);
}

window.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  el('entryDate').valueAsDate = new Date();
  setupDraftAutosave();
  setAuthUi();
});
