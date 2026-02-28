const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ─── DATABASE SETUP ────────────────────────────────────────────────────────
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'familylist.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    family_id TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS families (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL,
    owner_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    family_id TEXT NOT NULL,
    name TEXT NOT NULL,
    who TEXT NOT NULL,
    user_id TEXT NOT NULL,
    category TEXT NOT NULL,
    urgency TEXT NOT NULL DEFAULT 'normal',
    note TEXT NOT NULL DEFAULT '',
    done INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
`);

// ─── MIGRATION: remove password_hash from families if it exists ─────────────
try {
  const cols = db.prepare('PRAGMA table_info(families)').all();
  const hasPasswordHash = cols.some(c => c.name === 'password_hash');
  if (hasPasswordHash) {
    console.log('Migrating families table — removing password_hash...');
    db.exec(`
      CREATE TABLE families_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        code TEXT UNIQUE NOT NULL,
        owner_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO families_new (id, name, code, owner_id, created_at)
        SELECT id, name, code, owner_id, created_at FROM families;
      DROP TABLE families;
      ALTER TABLE families_new RENAME TO families;
    `);
    console.log('Migration complete.');
  }
} catch(e) {
  console.error('Migration error:', e.message);
}

// ─── HELPERS ───────────────────────────────────────────────────────────────
function makeCode() {
  // Short memorable family invite code e.g. "BLUE-7492"
  const words = ['RED','BLUE','GREEN','GOLD','STAR','MOON','SUN','SKY','OAK','ROSE'];
  return words[Math.floor(Math.random()*words.length)] + '-' + Math.floor(1000+Math.random()*9000);
}

function requireUser(req, res) {
  const userId = req.headers['x-user-id'];
  if (!userId) { res.status(401).json({ error: 'Not authenticated' }); return null; }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) { res.status(401).json({ error: 'User not found' }); return null; }
  return user;
}

// ─── REAL-TIME (Server-Sent Events) ────────────────────────────────────────
const sseClients = new Map();
function sseAdd(familyId, res) {
  if (!sseClients.has(familyId)) sseClients.set(familyId, new Set());
  sseClients.get(familyId).add(res);
}
function sseRemove(familyId, res) {
  sseClients.get(familyId)?.delete(res);
}
function sseBroadcast(familyId, event, data) {
  const clients = sseClients.get(familyId);
  if (!clients || clients.size === 0) return;
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach(res => { try { res.write(msg); } catch {} });
}

app.get('/api/events', (req, res) => {
  const userId = req.headers['x-user-id'] || req.query.userId;
  if (!userId) return res.status(401).end();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user || !user.family_id) return res.status(403).end();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { clearInterval(heartbeat); }
  }, 25000);

  sseAdd(user.family_id, res);
  req.on('close', () => {
    clearInterval(heartbeat);
    sseRemove(user.family_id, res);
  });
});

// ─── AUTH ROUTES ───────────────────────────────────────────────────────────

// Sign up
app.post('/api/auth/signup', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email, password required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) return res.status(409).json({ error: 'Email already in use' });

  const hash = await bcrypt.hash(password, 10);
  const id = uuidv4();
  db.prepare('INSERT INTO users (id, name, email, password_hash, family_id, created_at) VALUES (?,?,?,?,NULL,?)')
    .run(id, name.trim(), email.toLowerCase(), hash, new Date().toISOString());

  const user = db.prepare('SELECT id, name, email, family_id FROM users WHERE id = ?').get(id);
  res.status(201).json({ user });
});

// Log in
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user) return res.status(401).json({ error: 'Wrong email or password' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Wrong email or password' });

  // Fetch family info if they have one
  let family = null;
  if (user.family_id) {
    family = db.prepare('SELECT id, name, code FROM families WHERE id = ?').get(user.family_id);
  }

  res.json({ user: { id: user.id, name: user.name, email: user.email, family_id: user.family_id }, family });
});

// Get current user + family
app.get('/api/auth/me', (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  let family = null;
  if (user.family_id) {
    family = db.prepare('SELECT id, name, code FROM families WHERE id = ?').get(user.family_id);
  }
  res.json({ user: { id: user.id, name: user.name, email: user.email, family_id: user.family_id }, family });
});

// ─── FAMILY ROUTES ─────────────────────────────────────────────────────────

// Create a family
app.post('/api/family/create', (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  if (user.family_id) return res.status(400).json({ error: 'You are already in a family. Leave it first.' });

  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Family name required' });

  const id = uuidv4();
  let code = makeCode();
  while (db.prepare('SELECT id FROM families WHERE code = ?').get(code)) code = makeCode();

  db.prepare('INSERT INTO families (id, name, code, owner_id, created_at) VALUES (?,?,?,?,?)')
    .run(id, name.trim(), code, user.id, new Date().toISOString());
  db.prepare('UPDATE users SET family_id = ? WHERE id = ?').run(id, user.id);

  res.status(201).json({ family: { id, name: name.trim(), code } });
});

// Join a family
app.post('/api/family/join', (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  if (user.family_id) return res.status(400).json({ error: 'You are already in a family. Leave it first.' });

  const { code, name } = req.body;
  if (!code || !name) return res.status(400).json({ error: 'Invite code and family name required' });

  const family = db.prepare('SELECT * FROM families WHERE code = ?').get(code.toUpperCase().trim());
  if (!family) return res.status(404).json({ error: 'Family not found. Check the invite code.' });

  // Check name matches (case insensitive)
  if (family.name.toLowerCase() !== name.trim().toLowerCase()) {
    return res.status(401).json({ error: 'Family name does not match. Check with your family member.' });
  }

  db.prepare('UPDATE users SET family_id = ? WHERE id = ?').run(family.id, user.id);
  res.json({ family: { id: family.id, name: family.name, code: family.code } });
});

// Leave a family
app.post('/api/family/leave', (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  if (!user.family_id) return res.status(400).json({ error: 'You are not in a family' });
  db.prepare('UPDATE users SET family_id = NULL WHERE id = ?').run(user.id);
  res.json({ ok: true });
});

// Get family members
app.get('/api/family/members', (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  if (!user.family_id) return res.status(400).json({ error: 'Not in a family' });
  const members = db.prepare('SELECT id, name, email FROM users WHERE family_id = ?').all(user.family_id);
  res.json(members);
});

// ─── ITEMS ROUTES ──────────────────────────────────────────────────────────

app.get('/api/items', (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  if (!user.family_id) return res.json([]);
  const items = db.prepare('SELECT * FROM items WHERE family_id = ? ORDER BY created_at DESC').all(user.family_id);
  res.json(items.map(i => ({ ...i, done: i.done === 1, createdAt: i.created_at })));
});

app.post('/api/items', (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  if (!user.family_id) return res.status(400).json({ error: 'Join a family first' });

  const { name, category, urgency, note } = req.body;
  if (!name || !category) return res.status(400).json({ error: 'name and category required' });

  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO items (id, family_id, name, who, user_id, category, urgency, note, done, created_at) VALUES (?,?,?,?,?,?,?,?,0,?)')
    .run(id, user.family_id, name, user.name, user.id, category, urgency || 'normal', note || '', now);

  res.status(201).json({ id, family_id: user.family_id, name, who: user.name, user_id: user.id, category, urgency: urgency || 'normal', note: note || '', done: false, createdAt: now });
  sseBroadcast(user.family_id, 'refresh', { action: 'add' });
});

app.patch('/api/items/:id', (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (item.family_id !== user.family_id) return res.status(403).json({ error: 'Forbidden' });

  const { name, note, category, urgency, done } = req.body;
  const updated = {
    name: name ?? item.name,
    note: note ?? item.note,
    category: category ?? item.category,
    urgency: urgency ?? item.urgency,
    done: done !== undefined ? (done ? 1 : 0) : item.done
  };
  db.prepare('UPDATE items SET name=?,note=?,category=?,urgency=?,done=? WHERE id=?')
    .run(updated.name, updated.note, updated.category, updated.urgency, updated.done, item.id);

  res.json({ ...item, ...updated, done: updated.done === 1, createdAt: item.created_at });
  sseBroadcast(user.family_id, 'refresh', { action: 'update' });
});

app.delete('/api/items/done/all', (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  if (!user.family_id) return res.json({ ok: true });
  db.prepare('DELETE FROM items WHERE family_id = ? AND done = 1').run(user.family_id);
  res.json({ ok: true });
  sseBroadcast(user.family_id, 'refresh', { action: 'clearDone' });
});

app.delete('/api/items/:id', (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (item.family_id !== user.family_id) return res.status(403).json({ error: 'Forbidden' });
  db.prepare('DELETE FROM items WHERE id = ?').run(item.id);
  res.json({ ok: true });
  sseBroadcast(user.family_id, 'refresh', { action: 'delete' });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Family List on http://localhost:${PORT}`));