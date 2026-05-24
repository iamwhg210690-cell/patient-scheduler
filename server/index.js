// server/index.js
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 4000;
const SECRET = process.env.JWT_SECRET || 'dev-secret';

// DB file
const DB_FILE = path.join(__dirname, 'data.db');
const db = new sqlite3.Database(DB_FILE);

// Helper: run SQL with Promise
function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}
function allAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}
function getAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

// Initialize DB and perform safe migrations
async function initDb() {
  // Ensure DB file exists (sqlite will create automatically)
  // Create therapists table if not exists
  await runAsync(`CREATE TABLE IF NOT EXISTS therapists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    name TEXT
  )`);

  // Create appointments table if not exists with new schema
  // Use a safe approach: if table doesn't exist, create with full schema.
  // If exists, ensure columns therapistId and patientType exist; if not, add them.
  await runAsync(`CREATE TABLE IF NOT EXISTS appointments (
    id TEXT PRIMARY KEY,
    patient TEXT,
    day INTEGER,
    slotIndex INTEGER,
    start TEXT,
    duration INTEGER,
    therapistId INTEGER DEFAULT 1,
    patientType TEXT DEFAULT 'outpatient'
  )`);

  // Ensure users table exists (for auth)
  await runAsync(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT UNIQUE,
    password TEXT,
    name TEXT
  )`);

  // If appointments table existed previously without the new columns, add them if missing
  const cols = await allAsync(`PRAGMA table_info(appointments)`);
  const colNames = cols.map(c => c.name);
  if (!colNames.includes('therapistId')) {
    try {
      await runAsync(`ALTER TABLE appointments ADD COLUMN therapistId INTEGER DEFAULT 1`);
    } catch (e) {
      console.warn('ALTER TABLE therapistId failed (may be older sqlite).', e.message);
    }
  }
  if (!colNames.includes('patientType')) {
    try {
      await runAsync(`ALTER TABLE appointments ADD COLUMN patientType TEXT DEFAULT 'outpatient'`);
    } catch (e) {
      console.warn('ALTER TABLE patientType failed (may be older sqlite).', e.message);
    }
  }

  // Create a demo therapist if none exists
  const t = await getAsync(`SELECT * FROM therapists LIMIT 1`);
  if (!t) {
    await runAsync(`INSERT INTO therapists (username, name) VALUES (?, ?)`, ['therapist1', '治療師 一']);
    await runAsync(`INSERT INTO therapists (username, name) VALUES (?, ?)`, ['therapist2', '治療師 二']);
  }

  // Create a demo user if not exists
  const user = await getAsync("SELECT * FROM users WHERE username = ?", ['admin']);
  if (!user) {
    const pw = bcrypt.hashSync('password', 10);
    await runAsync("INSERT INTO users (username, password, name) VALUES (?, ?, ?)", ['admin', pw, '治療師 管理員']);
    console.log('Created demo user: admin / password');
  }
}

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Auth endpoints
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ message: '缺少帳號或密碼' });
  try {
    const user = await getAsync("SELECT * FROM users WHERE username = ?", [username]);
    if (!user) return res.status(401).json({ message: '帳號或密碼錯誤' });
    const ok = bcrypt.compareSync(password, user.password);
    if (!ok) return res.status(401).json({ message: '帳號或密碼錯誤' });
    const token = jwt.sign({ id: user.id, username: user.username }, SECRET, { expiresIn: '8h' });
    res.json({ token });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ message: '未授權' });
  const token = auth.split(' ')[1];
  try {
    const payload = jwt.verify(token, SECRET);
    req.user = payload;
    next();
  } catch (e) {
    res.status(401).json({ message: 'Token 無效' });
  }
}

// Therapists endpoints
app.get('/api/therapists', authMiddleware, async (req, res) => {
  try {
    const rows = await allAsync("SELECT id, username, name FROM therapists ORDER BY id");
    res.json(rows);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

app.post('/api/therapists', authMiddleware, async (req, res) => {
  const { username, name } = req.body || {};
  if (!username || !name) return res.status(400).json({ message: '缺少 username 或 name' });
  try {
    await runAsync("INSERT INTO therapists (username, name) VALUES (?, ?)", [username, name]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Appointments CRUD with therapistId & patientType support
// GET /api/appointments?therapistId=1
// GET /api/appointments?therapistIds=1,2
app.get('/api/appointments', authMiddleware, async (req, res) => {
  try {
    const { therapistId, therapistIds } = req.query;
    let rows;
    if (therapistIds) {
      // therapistIds = "1,2,3"
      const ids = therapistIds.split(',').map(i => Number(i)).filter(Boolean);
      if (ids.length === 0) {
        rows = await allAsync("SELECT * FROM appointments");
      } else {
        const placeholders = ids.map(() => '?').join(',');
        rows = await allAsync(`SELECT * FROM appointments WHERE therapistId IN (${placeholders})`, ids);
      }
    } else if (therapistId) {
      rows = await allAsync("SELECT * FROM appointments WHERE therapistId = ?", [Number(therapistId)]);
    } else {
      rows = await allAsync("SELECT * FROM appointments");
    }
    res.json(rows || []);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

app.post('/api/appointments', authMiddleware, async (req, res) => {
  const ap = req.body || {};
  // required fields: id, patient, day, slotIndex, start, duration, therapistId, patientType
  if (!ap.id || !ap.patient || ap.day === undefined || ap.slotIndex === undefined || !ap.start || !ap.duration) {
    return res.status(400).json({ message: '缺少預約必要欄位' });
  }
  // default therapistId and patientType if missing
  const therapistId = ap.therapistId !== undefined ? ap.therapistId : 1;
  const patientType = ap.patientType || 'outpatient';
  try {
    await runAsync(
      "INSERT INTO appointments (id, patient, day, slotIndex, start, duration, therapistId, patientType) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [ap.id, ap.patient, ap.day, ap.slotIndex, ap.start, ap.duration, therapistId, patientType]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

app.put('/api/appointments/:id', authMiddleware, async (req, res) => {
  const id = req.params.id;
  const ap = req.body || {};
  try {
    // allow updating therapistId and patientType
    await runAsync(
      "UPDATE appointments SET patient=?, day=?, slotIndex=?, start=?, duration=?, therapistId=?, patientType=? WHERE id=?",
      [ap.patient, ap.day, ap.slotIndex, ap.start, ap.duration, ap.therapistId || 1, ap.patientType || 'outpatient', id]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

app.delete('/api/appointments/:id', authMiddleware, async (req, res) => {
  const id = req.params.id;
  try {
    await runAsync("DELETE FROM appointments WHERE id=?", [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Optional: endpoint to export appointments for printing (simple JSON)
app.get('/api/appointments/export', authMiddleware, async (req, res) => {
  try {
    const { therapistIds } = req.query;
    let rows;
    if (therapistIds) {
      const ids = therapistIds.split(',').map(i => Number(i)).filter(Boolean);
      if (ids.length === 0) rows = await allAsync("SELECT * FROM appointments");
      else {
        const placeholders = ids.map(() => '?').join(',');
        rows = await allAsync(`SELECT * FROM appointments WHERE therapistId IN (${placeholders}) ORDER BY therapistId, day, slotIndex`, ids);
      }
    } else {
      rows = await allAsync("SELECT * FROM appointments ORDER BY therapistId, day, slotIndex");
    }
    res.json(rows || []);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Serve frontend in production (optional)
app.use(express.static(path.join(__dirname, '../frontend/dist')));
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, '../frontend/dist/index.html');
  if (fs.existsSync(indexPath)) res.sendFile(indexPath);
  else res.status(404).send('Not found');
});

// Start server after DB init
initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('DB init failed', err);
  process.exit(1);
});
