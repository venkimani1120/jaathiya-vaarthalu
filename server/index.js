const path = require('path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { execFile } = require('child_process');
const db = require('./db/client');
const { slugify, cleanHtml, toDbTime } = require('./util');
const scheduler = require('./jobs/schedulePublisher');
const { enquiryAlert } = require('./notify');
const whatsapp = require('./whatsapp');
const whatsappFeed = require('./jobs/whatsappFeed');

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  console.error('Set SESSION_SECRET in production');
  process.exit(1);
}
const app = express();
app.set('trust proxy', 1); // behind Nginx: needed for secure cookies and correct client IPs
app.use(helmet());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false, limit: '20kb' })); // public HTML forms (newsletter, enquiries)
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-only-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 3600e3 },
  })
);
// Nginx should serve /uploads in production
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
app.use(express.static(path.join(__dirname, '..', 'public'), { index: false }));
app.get('/api/site', (_req, res) => res.sendFile(path.join(__dirname, '..', 'config', 'site.json')));
// Server-rendered pages, sitemap, RSS and robots.txt (see server/render.js)
const { notFound } = require('./render').register(app, db);

// ---------- helpers ----------
// Re-reads the user on every request so role changes and deletions apply immediately
const requireRole = (...roles) => (req, res, next) => {
  const s = req.session.user;
  if (!s) return res.status(401).json({ error: 'Login required' });
  const u = db.prepare('SELECT id, name, role FROM users WHERE id = ?').get(s.id);
  if (!u) return req.session.destroy(() => res.status(401).json({ error: 'Login required' }));
  req.session.user = { id: u.id, name: u.name, role: u.role };
  if (!roles.includes(u.role)) return res.status(403).json({ error: 'Not allowed' });
  next();
};
const audit = (req, action, entity, id) =>
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id) VALUES (?,?,?,?)')
    .run(req.session.user?.id ?? null, action, entity, id);

const LIST_COLS = `a.id, a.title, a.slug, a.summary, a.image_path, a.published_at, COALESCE(c.name_en, c.name_te) AS category`;

// ---------- public API ----------
app.get('/api/articles', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 20, offset = (page - 1) * limit;
  const { category, q } = req.query;

  let sql, params;
  if (q) {
    if (q.length < 3) return res.status(400).json({ error: 'Search needs at least 3 characters' });
    sql = `SELECT ${LIST_COLS} FROM articles_fts f
           JOIN articles a ON a.id = f.rowid
           LEFT JOIN categories c ON c.id = a.category_id
           WHERE articles_fts MATCH ? AND a.status = 'published'
           ORDER BY a.published_at DESC LIMIT ? OFFSET ?`;
    params = [`"${q.replace(/"/g, '""')}"`, limit, offset];
  } else {
    sql = `SELECT ${LIST_COLS} FROM articles a
           LEFT JOIN categories c ON c.id = a.category_id
           WHERE a.status = 'published' ${category ? 'AND c.slug = ?' : ''}
           ORDER BY a.published_at DESC LIMIT ? OFFSET ?`;
    params = category ? [category, limit, offset] : [limit, offset];
  }
  res.json(db.prepare(sql).all(...params));
});

app.get('/api/articles/:slug', (req, res) => {
  const a = db.prepare(
    `SELECT a.*, COALESCE(c.name_en, c.name_te) AS category, u.name AS author FROM articles a
     LEFT JOIN categories c ON c.id = a.category_id
     LEFT JOIN users u ON u.id = a.author_id
     WHERE a.slug = ? AND a.status = 'published'`
  ).get(req.params.slug);
  if (!a) return res.status(404).json({ error: 'Not found' });

  db.prepare('UPDATE articles SET views = views + 1 WHERE id = ?').run(a.id);
  const related = db.prepare(
    `SELECT id, title, slug, image_path FROM articles
     WHERE status = 'published' AND category_id = ? AND id != ?
     ORDER BY published_at DESC LIMIT 4`
  ).all(a.category_id, a.id);
  res.json({ ...a, related });
});

app.get('/api/breaking', (_req, res) =>
  res.json(
    db.prepare(
      `SELECT title, slug FROM articles
       WHERE status = 'published' AND is_breaking = 1
       ORDER BY published_at DESC LIMIT 8`
    ).all()
  )
);

app.get('/api/categories', (_req, res) =>
  res.json(db.prepare('SELECT * FROM categories ORDER BY sort_order').all())
);

app.get('/api/ads', (req, res) => {
  const ads = db.prepare(
    `SELECT id, image_path, link_url FROM ads
     WHERE slot = ? AND active = 1
       AND (start_date IS NULL OR start_date <= date('now'))
       AND (end_date IS NULL OR end_date >= date('now'))`
  ).all(req.query.slot || '');
  res.json(ads.length ? ads[Math.floor(Math.random() * ads.length)] : null); // simple rotation
});

app.get('/api/epaper', (req, res) => {
  const rows = req.query.date
    ? db.prepare('SELECT * FROM epaper_editions WHERE edition_date = ?').all(req.query.date)
    : db.prepare('SELECT * FROM epaper_editions ORDER BY edition_date DESC LIMIT 1').all();
  res.json(rows);
});

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
app.post('/api/subscribe', rateLimit({ windowMs: 3600e3, max: 10 }), (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!EMAIL.test(email)) return res.status(400).json({ error: 'Enter a valid email' });
  db.prepare('INSERT OR IGNORE INTO subscribers (email) VALUES (?)').run(email);
  res.json({ ok: true });
});

// ---------- public HTML forms (work without JS): redirect to /thanks in server/render.js ----------
const formLimit = rateLimit({ windowMs: 3600e3, max: 10, handler: (_req, res) => res.redirect(303, '/thanks?t=limit') });
app.post('/newsletter', formLimit, (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!EMAIL.test(email)) return res.redirect(303, '/thanks?t=invalid');
  db.prepare('INSERT OR IGNORE INTO subscribers (email) VALUES (?)').run(email);
  res.redirect(303, '/thanks?t=newsletter');
});
app.post('/enquiry', formLimit, (req, res) => {
  const b = req.body, s = (v, n) => String(v || '').trim().slice(0, n);
  const kind = ['advertise', 'subscription'].includes(b.kind) ? b.kind : null;
  if (s(b.website, 1)) return res.redirect(303, '/thanks?t=enquiry'); // honeypot: only bots fill the hidden field
  const name = s(b.name, 100), phone = s(b.phone, 20), email = s(b.email, 200).toLowerCase(), place = s(b.place, 200);
  if (!kind || !name || !/^[0-9+\- ]{10,20}$/.test(phone) || (email && !EMAIL.test(email)) || (kind === 'subscription' && !place))
    return res.redirect(303, '/thanks?t=invalid&from=' + (kind === 'advertise' ? 'advertise' : 'subscribe'));
  const option_key = s(b.option, 40) || null;
  const { lastInsertRowid: id } = db.prepare('INSERT INTO enquiries (kind, name, phone, email, option_key, place, message) VALUES (?,?,?,?,?,?,?)')
    .run(kind, name, phone, email || null, option_key, place || null, s(b.message, 2000) || null);
  res.redirect(303, '/thanks?t=enquiry');
  // SMS alert to staff after the reply, so a slow or failing SMS provider never holds up the visitor
  enquiryAlert({ kind, name, phone, option_key, place }).then((r) => {
    if (!r.ok) console.error(`[notify] enquiry ${id}: ${r.error}`);
    db.prepare('UPDATE enquiries SET notify_status = ?, notify_error = ? WHERE id = ?')
      .run(r.ok ? (r.provider === 'log' ? 'logged' : 'sent') : 'failed', r.ok ? null : r.error, id);
  }).catch((err) => console.error(`[notify] enquiry ${id}:`, err));
});

// ---------- auth ----------
app.post('/api/auth/login', rateLimit({ windowMs: 15 * 60e3, max: 10 }), (req, res) => {
  const { email, password } = req.body;
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').toLowerCase());
  if (!u || !bcrypt.compareSync(String(password || ''), u.password_hash))
    return res.status(401).json({ error: 'Wrong email or password' });
  req.session.regenerate(() => {
    req.session.user = { id: u.id, name: u.name, role: u.role };
    audit(req, 'login', 'user', u.id);
    res.json(req.session.user);
  });
});
app.post('/api/auth/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

// ---------- admin API ----------
const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, '..', 'uploads', 'images'),
    filename: (_r, f, cb) =>
      cb(null, Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[f.mimetype] || '')),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, f, cb) => cb(null, /^image\/(jpeg|png|webp)$/.test(f.mimetype)),
});

app.post('/api/admin/upload', requireRole('admin', 'editor', 'reporter'), upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Upload a JPG, PNG or WebP under 5 MB' });
  // TODO: convert to WebP + resize with sharp
  res.json({ path: `/uploads/images/${req.file.filename}` });
});

app.post('/api/admin/articles', requireRole('admin', 'editor', 'reporter'), (req, res) => {
  const { title, summary, body, image_path, category_id, is_breaking, publish_at } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'Title and body are required' });

  // Reporters can only save drafts
  let status = 'draft', publishedAt = null;
  if (req.session.user.role !== 'reporter' && publish_at) {
    publishedAt = toDbTime(publish_at);
    status = new Date(publish_at) <= new Date() ? 'published' : 'scheduled';
  }

  let slug = slugify(title);
  if (db.prepare('SELECT 1 FROM articles WHERE slug = ?').get(slug)) slug += '-' + Date.now().toString(36);

  const info = db.prepare(
    `INSERT INTO articles (title, slug, summary, body, image_path, category_id, author_id, status, is_breaking, published_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(title, slug, summary || null, cleanHtml(body), image_path || null,
        category_id || null, req.session.user.id, status, is_breaking ? 1 : 0, publishedAt);

  audit(req, 'create', 'article', info.lastInsertRowid);
  res.status(201).json({ id: info.lastInsertRowid, slug, status });
});

app.post('/api/admin/articles/:id/publish', requireRole('admin', 'editor'), (req, res) => {
  const { changes } = db.prepare(
    `UPDATE articles SET status='published', published_at = COALESCE(published_at, datetime('now')),
     updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(req.params.id);
  if (!changes) return res.status(404).json({ error: 'Not found' });
  audit(req, 'publish', 'article', Number(req.params.id));
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) =>
  req.session.user ? res.json(req.session.user) : res.status(401).json({ error: 'Login required' }));

app.get('/api/admin/articles', requireRole('admin', 'editor', 'reporter'), (req, res) => {
  const { id, role } = req.session.user;
  const cols = 'id, title, slug, status, published_at, updated_at';
  res.json(role === 'reporter'
    ? db.prepare(`SELECT ${cols} FROM articles WHERE author_id = ? ORDER BY updated_at DESC LIMIT 100`).all(id)
    : db.prepare(`SELECT ${cols} FROM articles ORDER BY updated_at DESC LIMIT 100`).all());
});

const pdfUpload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, '..', 'uploads', 'epaper'),
    filename: (_r, _f, cb) => cb(null, Date.now() + '.pdf'),
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_r, f, cb) => cb(null, f.mimetype === 'application/pdf'),
});

app.post('/api/admin/epaper', requireRole('admin', 'editor'), pdfUpload.single('pdf'), async (req, res) => {
  const { date, edition } = req.body;
  if (!req.file || !/^\d{4}-\d{2}-\d{2}$/.test(date || ''))
    return res.status(400).json({ error: 'Choose a date and a PDF file under 50 MB' });
  // Front-page thumbnail via poppler's pdftoppm (apt install poppler-utils)
  const base = req.file.path.replace(/\.pdf$/, '-thumb');
  let thumb = null;
  try {
    await new Promise((ok, fail) =>
      execFile('pdftoppm', ['-jpeg', '-r', '50', '-f', '1', '-l', '1', '-singlefile', '-scale-to-x', '400', '-scale-to-y', '-1', req.file.path, base],
        { timeout: 30000 }, (e) => (e ? fail(e) : ok())));
    thumb = `/uploads/epaper/${path.basename(base)}.jpg`;
  } catch (e) { console.error('[epaper] thumbnail failed:', e.message); }
  db.prepare(
    `INSERT INTO epaper_editions (edition_date, edition_name, pdf_path, thumb_path) VALUES (?,?,?,?)
     ON CONFLICT(edition_date, edition_name) DO UPDATE SET pdf_path = excluded.pdf_path, thumb_path = excluded.thumb_path`
  ).run(date, String(edition || 'Main').slice(0, 40), `/uploads/epaper/${req.file.filename}`, thumb);
  audit(req, 'upload', 'epaper', null);
  res.status(201).json({ ok: true, thumb: !!thumb });
});

// Editors/admins may change any article; reporters only their own drafts
const canEdit = (u, a) => u.role !== 'reporter' || (a.author_id === u.id && a.status === 'draft');
const ALL = ['admin', 'editor', 'reporter'];
const loadArticle = (req, res) => {
  const a = db.prepare('SELECT * FROM articles WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' }) && null;
  if (!canEdit(req.session.user, a)) return res.status(403).json({ error: 'Not allowed' }) && null;
  return a;
};

app.get('/api/admin/articles/:id', requireRole(...ALL), (req, res) => {
  const a = loadArticle(req, res);
  if (a) res.json(a);
});

app.put('/api/admin/articles/:id', requireRole(...ALL), (req, res) => {
  const a = loadArticle(req, res);
  if (!a) return;
  const { title, summary, body, image_path, category_id, is_breaking, action, publish_at } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'Title and body are required' });

  let status = a.status, published = a.published_at;
  if (req.session.user.role !== 'reporter') {
    if (action === 'publish' && !(a.status === 'published' && !publish_at)) {
      const t = publish_at ? new Date(publish_at) : new Date();
      published = toDbTime(t);
      status = t <= new Date() ? 'published' : 'scheduled';
    } else if (action === 'draft') { status = 'draft'; published = null; }
  }
  db.prepare(
    `UPDATE articles SET title=?, summary=?, body=?, image_path=?, category_id=?, is_breaking=?,
     status=?, published_at=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
  ).run(title, summary || null, cleanHtml(body), image_path || null, category_id || null,
        is_breaking ? 1 : 0, status, published, a.id); // slug stays the same so links keep working
  audit(req, 'update', 'article', a.id);
  res.json({ id: a.id, status });
});

app.delete('/api/admin/articles/:id', requireRole(...ALL), (req, res) => {
  const a = loadArticle(req, res);
  if (!a) return;
  db.prepare('DELETE FROM articles WHERE id = ?').run(a.id);
  audit(req, 'delete', 'article', a.id);
  res.json({ ok: true });
});

// ---------- categories, ads, users, subscribers, audit ----------
const ADMIN = ['admin'], STAFF = ['admin', 'editor'];
const isHttp = (u) => !u || /^https?:\/\/\S+$/i.test(u);
const isDate = (d) => !d || /^\d{4}-\d{2}-\d{2}$/.test(d);
const tryDb = (res, fn) => {
  try { return fn(); } catch (e) {
    if (/UNIQUE/.test(e.message)) return res.status(409).json({ error: 'Already exists' });
    if (/FOREIGN KEY/.test(e.message)) return res.status(409).json({ error: 'Still in use: move or delete the related items first' });
    throw e;
  }
};

app.post('/api/admin/categories', requireRole(...STAFF), (req, res) => {
  // English name is required; the Telugu translation is optional (name_te is NOT NULL, so it falls back to the English name)
  const name = String(req.body.name_en || '').trim(), nameTe = String(req.body.name_te || '').trim() || name;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const slug = String(req.body.slug || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '') || slugify(name);
  tryDb(res, () => {
    const n = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM categories').get().n;
    const i = db.prepare('INSERT INTO categories (name_te, name_en, slug, sort_order) VALUES (?,?,?,?)').run(nameTe, name, slug, n);
    audit(req, 'create', 'category', i.lastInsertRowid);
    res.status(201).json({ id: i.lastInsertRowid });
  });
});
app.put('/api/admin/categories/:id', requireRole(...STAFF), (req, res) => {
  const name = String(req.body.name_en || '').trim(), nameTe = String(req.body.name_te || '').trim() || name;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  db.prepare('UPDATE categories SET name_en = ?, name_te = ?, sort_order = ? WHERE id = ?').run(name, nameTe, parseInt(req.body.sort_order) || 0, req.params.id);
  audit(req, 'update', 'category', Number(req.params.id));
  res.json({ ok: true });
});
app.delete('/api/admin/categories/:id', requireRole(...STAFF), (req, res) =>
  tryDb(res, () => { db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id); audit(req, 'delete', 'category', Number(req.params.id)); res.json({ ok: true }); }));

app.get('/api/admin/ads', requireRole(...STAFF), (_req, res) => res.json(db.prepare('SELECT * FROM ads ORDER BY id DESC').all()));
app.post('/api/admin/ads', requireRole(...STAFF), upload.single('image'), (req, res) => {
  const { link_url, start_date, end_date } = req.body;
  if (!req.file) return res.status(400).json({ error: 'Upload a JPG, PNG or WebP image under 5 MB' });
  if (!isHttp(link_url)) return res.status(400).json({ error: 'Link must start with http:// or https://' });
  if (!isDate(start_date) || !isDate(end_date)) return res.status(400).json({ error: 'Dates must be YYYY-MM-DD' });
  const i = db.prepare('INSERT INTO ads (slot, image_path, link_url, start_date, end_date) VALUES (?,?,?,?,?)')
    .run('inline', `/uploads/images/${req.file.filename}`, link_url || null, start_date || null, end_date || null);
  audit(req, 'create', 'ad', i.lastInsertRowid);
  res.status(201).json({ id: i.lastInsertRowid });
});
app.put('/api/admin/ads/:id', requireRole(...STAFF), (req, res) => {
  db.prepare('UPDATE ads SET active = ? WHERE id = ?').run(req.body.active ? 1 : 0, req.params.id);
  audit(req, 'update', 'ad', Number(req.params.id));
  res.json({ ok: true });
});
app.delete('/api/admin/ads/:id', requireRole(...STAFF), (req, res) => {
  db.prepare('DELETE FROM ads WHERE id = ?').run(req.params.id);
  audit(req, 'delete', 'ad', Number(req.params.id));
  res.json({ ok: true });
});

const ROLES = ['admin', 'editor', 'reporter'];
app.get('/api/admin/users', requireRole(...ADMIN), (_req, res) =>
  res.json(db.prepare('SELECT id, name, email, role, created_at FROM users ORDER BY id').all()));
app.post('/api/admin/users', requireRole(...ADMIN), (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email || '') || String(password || '').length < 8 || !ROLES.includes(role))
    return res.status(400).json({ error: 'Name, a valid email, a password of 8+ characters and a role are required' });
  tryDb(res, () => {
    const i = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)')
      .run(String(name).trim(), email.toLowerCase(), bcrypt.hashSync(password, 12), role);
    audit(req, 'create', 'user', i.lastInsertRowid);
    res.status(201).json({ id: i.lastInsertRowid });
  });
});
app.put('/api/admin/users/:id', requireRole(...ADMIN), (req, res) => {
  const { role, password } = req.body;
  const id = Number(req.params.id);
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (id === req.session.user.id && role !== 'admin') return res.status(400).json({ error: 'You cannot change your own role' });
  if (password && String(password).length < 8) return res.status(400).json({ error: 'Password must be 8+ characters' });
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  if (password) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 12), id);
  audit(req, 'update', 'user', id);
  res.json({ ok: true });
});
app.delete('/api/admin/users/:id', requireRole(...ADMIN), (req, res) => {
  const id = Number(req.params.id);
  if (id === req.session.user.id) return res.status(400).json({ error: 'You cannot delete your own account' });
  tryDb(res, () => { db.prepare('DELETE FROM users WHERE id = ?').run(id); audit(req, 'delete', 'user', id); res.json({ ok: true }); });
});

app.get('/api/admin/subscribers', requireRole(...ADMIN), (_req, res) =>
  res.json(db.prepare('SELECT * FROM subscribers ORDER BY id DESC LIMIT 5000').all()));
app.get('/api/admin/subscribers.csv', requireRole(...ADMIN), (_req, res) => {
  const cell = (v) => '"' + String(/^[=+\-@]/.test(v) ? "'" + v : v).replace(/"/g, '""') + '"'; // blocks spreadsheet formulas
  const rows = db.prepare('SELECT email, subscribed_at FROM subscribers ORDER BY id').all();
  res.type('text/csv').set('Content-Disposition', 'attachment; filename="subscribers.csv"')
    .send('email,subscribed_at\n' + rows.map((r) => cell(r.email) + ',' + cell(r.subscribed_at)).join('\n'));
});
app.delete('/api/admin/subscribers/:id', requireRole(...ADMIN), (req, res) => {
  db.prepare('DELETE FROM subscribers WHERE id = ?').run(req.params.id);
  audit(req, 'delete', 'subscriber', Number(req.params.id));
  res.json({ ok: true });
});

app.get('/api/admin/enquiries', requireRole(...STAFF), (_req, res) =>
  res.json(db.prepare('SELECT * FROM enquiries ORDER BY id DESC LIMIT 500').all()));
app.put('/api/admin/enquiries/:id', requireRole(...STAFF), (req, res) => {
  db.prepare('UPDATE enquiries SET status = ? WHERE id = ?').run(req.body.status === 'done' ? 'done' : 'new', req.params.id);
  audit(req, 'update', 'enquiry', Number(req.params.id));
  res.json({ ok: true });
});
app.delete('/api/admin/enquiries/:id', requireRole(...STAFF), (req, res) => {
  db.prepare('DELETE FROM enquiries WHERE id = ?').run(req.params.id);
  audit(req, 'delete', 'enquiry', Number(req.params.id));
  res.json({ ok: true });
});

// WhatsApp group feed (server/whatsapp.js): what was pulled, and a manual "pull now"
app.get('/api/admin/whatsapp', requireRole(...STAFF), (_req, res) => res.json({
  enabled: whatsapp.enabled(whatsapp.config()), groups: whatsapp.config().groups, last: whatsapp.status(),
  messages: db.prepare(`SELECT w.id, w.sender, w.sender_name, w.text, w.image_path, w.sent_at, w.status, w.article_id, a.title, a.status AS article_status
    FROM wa_messages w LEFT JOIN articles a ON a.id = w.article_id ORDER BY w.sent_at DESC LIMIT 200`).all(),
}));
app.post('/api/admin/whatsapp/pull', requireRole(...STAFF), async (req, res) => {
  if (!whatsapp.enabled(whatsapp.config())) return res.status(400).json({ error: 'Set WAHA_URL and WHATSAPP_GROUPS in .env' });
  const r = await whatsapp.pull({ db });
  audit(req, 'pull', 'whatsapp', null);
  res.json(r);
});

app.get('/api/admin/audit', requireRole(...ADMIN), (_req, res) =>
  res.json(db.prepare(`SELECT l.at, l.action, l.entity, l.entity_id, u.name FROM audit_log l LEFT JOIN users u ON u.id = l.user_id ORDER BY l.id DESC LIMIT 200`).all()));

app.use(notFound);

// ---------- start ----------
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Jaathiya Vaartalu API on http://localhost:${port}`);
  scheduler.start();
  whatsappFeed.start();
});
