// Pulls news posts from the configured WhatsApp groups and turns them into DRAFT articles for editors to review.
// WhatsApp's official API cannot read ordinary groups, so messages come from a self-hosted WAHA gateway
// (WhatsApp HTTP API, https://waha.devlike.pro) linked to a WhatsApp number by QR code.
// Nothing is ever published automatically. Each message is stored once in wa_messages (keyed by its WhatsApp id).
const fs = require('fs');
const path = require('path');
const { slugify, cleanHtml, toDbTime } = require('./util');

const IMAGE_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const PAIR_MINUTES = 10; // a photo and a text from the same sender this close together belong to one story

const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
const last10 = (s) => String(s || '').replace(/\D/g, '').slice(-10);

function config(env = process.env) {
  return {
    url: String(env.WAHA_URL || '').replace(/\/$/, ''),
    key: env.WAHA_API_KEY || '',
    session: env.WAHA_SESSION || 'default',
    groups: list(env.WHATSAPP_GROUPS),
    senders: list(env.WHATSAPP_SENDERS).map(last10), // empty: everyone in the group may send news
    minChars: Number(env.WHATSAPP_MIN_CHARS) || 40,  // shorter texts ("ok", "👍") are skipped
    maxAgeHours: Number(env.WHATSAPP_MAX_AGE_HOURS) || 24,
    authorEmail: env.WHATSAPP_AUTHOR_EMAIL || '',
  };
}
const enabled = (c) => Boolean(c.url && c.groups.length);

// WAHA message → the fields we use. In a group, `from` is the group and `participant` is the person.
const fromWaha = (m, groupId) => ({
  waId: String(m.id && typeof m.id === 'object' ? m.id._serialized : m.id),
  groupId,
  sender: last10(m.participant || m.author || (m._data && (m._data.author || m._data.participant)) || ''),
  senderName: String((m._data && (m._data.notifyName || m._data.pushName)) || m.notifyName || '').slice(0, 80),
  text: String(m.body || m.caption || '').trim(),
  at: toDbTime(Number(m.timestamp) * 1000),
  media: m.hasMedia && m.media && m.media.url ? { url: m.media.url, mimetype: m.media.mimetype } : null,
});

const headers = (c) => (c.key ? { 'X-Api-Key': c.key } : {});

async function fetchGroup(c, groupId, fetch) {
  const u = `${c.url}/api/${encodeURIComponent(c.session)}/chats/${encodeURIComponent(groupId)}/messages?limit=50&downloadMedia=true`;
  const r = await fetch(u, { headers: headers(c), signal: AbortSignal.timeout(20e3) });
  if (!r.ok) throw new Error(`WAHA ${r.status} for group ${groupId}`);
  const rows = await r.json();
  return (Array.isArray(rows) ? rows : []).filter((m) => m && m.id && m.timestamp).map((m) => fromWaha(m, groupId)).sort((a, b) => (a.at < b.at ? -1 : 1));
}

// Downloads a photo from the gateway. Only the path of the gateway's media URL is used, always against WAHA_URL,
// so a message can never make the server fetch some other address.
async function saveImage(c, media, uploadsDir, fetch) {
  const ext = IMAGE_EXT[media.mimetype];
  if (!ext) return null;
  const u = new URL(media.url, c.url);
  const r = await fetch(c.url + u.pathname + u.search, { headers: headers(c), signal: AbortSignal.timeout(30e3) });
  if (!r.ok) throw new Error(`WAHA media ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 5 * 1024 * 1024) return null; // same 5 MB limit as admin uploads
  const name = `wa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.writeFileSync(path.join(uploadsDir, name), buf);
  return `/uploads/images/${name}`;
}

// WhatsApp text → title + body. The first line is the headline; *bold* and _italic_ markers become HTML.
const escHtml = (s) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const plainMarks = (s) => s.replace(/(^|\s)[*_~]+|[*_~]+(?=\s|$|[.,!?:;])/g, '$1').trim();
function toArticle(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const first = plainMarks(lines[0] || '');
  const title = Array.from(first).length > 150 ? Array.from(first).slice(0, 147).join('').replace(/\s+\S*$/, '') + '…' : first;
  const rest = lines.slice(1).join('\n').trim() || text;
  const body = rest.split(/\n\s*\n|\n/).filter((p) => p.trim()).map((p) =>
    `<p>${escHtml(p.trim()).replace(/(^|\s)\*([^*\n]+)\*/g, '$1<b>$2</b>').replace(/(^|\s)_([^_\n]+)_/g, '$1<i>$2</i>')}</p>`).join('');
  return { title, body: cleanHtml(body) };
}

// Stores new messages and creates drafts. Safe to run again on the same messages.
async function ingest(db, msgs, c, { saveImg, authorId, now = Date.now() }) {
  const out = { drafts: 0, images: 0, skipped: 0 };
  const seen = db.prepare('SELECT 1 FROM wa_messages WHERE wa_id = ?');
  const insMsg = db.prepare('INSERT INTO wa_messages (wa_id, group_id, sender, sender_name, text, image_path, sent_at, article_id, status) VALUES (?,?,?,?,?,?,?,?,?)');
  const near = `datetime(?, '-${PAIR_MINUTES} minutes')`;
  for (const m of msgs) {
    if (seen.get(m.waId)) continue;
    const allowed = !c.senders.length || c.senders.includes(m.sender);
    const old = now - new Date(m.at.replace(' ', 'T') + 'Z').getTime() > c.maxAgeHours * 3600e3;
    if (!allowed || old) { insMsg.run(m.waId, m.groupId, m.sender, m.senderName, m.text.slice(0, 2000), null, m.at, null, 'skipped'); out.skipped++; continue; }

    const img = m.media ? await saveImg(m.media).catch((e) => (console.error(`[whatsapp] image ${m.waId}: ${e.message}`), null)) : null;
    if (Array.from(m.text).length >= c.minChars) {
      // The story's photo: its own, or a photo this sender posted just before that no story has taken yet
      const prior = img ? null : db.prepare(`SELECT id, image_path FROM wa_messages WHERE status = 'image' AND article_id IS NULL AND image_path IS NOT NULL
        AND group_id = ? AND sender = ? AND sent_at BETWEEN ${near} AND ? ORDER BY sent_at DESC LIMIT 1`).get(m.groupId, m.sender, m.at, m.at);
      const { title, body } = toArticle(m.text);
      let slug = slugify(title);
      if (db.prepare('SELECT 1 FROM articles WHERE slug = ?').get(slug)) slug += '-' + Date.now().toString(36);
      const { lastInsertRowid: aid } = db.prepare(`INSERT INTO articles (title, slug, body, image_path, author_id, status) VALUES (?,?,?,?,?,'draft')`)
        .run(title, slug, body, img || (prior && prior.image_path) || null, authorId ?? null);
      insMsg.run(m.waId, m.groupId, m.sender, m.senderName, m.text, img, m.at, aid, 'draft');
      if (prior) db.prepare('UPDATE wa_messages SET article_id = ? WHERE id = ?').run(aid, prior.id);
      db.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id) VALUES (NULL, 'whatsapp-import', 'article', ?)`).run(aid);
      out.drafts++;
    } else if (img) {
      // A photo on its own: give it to this sender's latest WhatsApp draft from just before, if that has no photo yet
      const d = db.prepare(`SELECT w.article_id FROM wa_messages w JOIN articles a ON a.id = w.article_id
        WHERE w.status = 'draft' AND a.status = 'draft' AND a.image_path IS NULL AND w.group_id = ? AND w.sender = ? AND w.sent_at BETWEEN ${near} AND ?
        ORDER BY w.sent_at DESC LIMIT 1`).get(m.groupId, m.sender, m.at, m.at);
      if (d) db.prepare('UPDATE articles SET image_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(img, d.article_id);
      insMsg.run(m.waId, m.groupId, m.sender, m.senderName, m.text, img, m.at, d ? d.article_id : null, 'image');
      out.images++;
    } else {
      insMsg.run(m.waId, m.groupId, m.sender, m.senderName, m.text, null, m.at, null, 'skipped');
      out.skipped++;
    }
  }
  return out;
}

// One pull of every configured group. Never throws; the result is kept for the admin WhatsApp tab.
let lastRun = null, busy = false;
async function pull({ db, env = process.env, fetch = globalThis.fetch, uploadsDir = path.join(__dirname, '..', 'uploads', 'images'), now } = {}) {
  const c = config(env);
  if (!enabled(c)) return lastRun;
  if (busy) return { busy: true };
  busy = true;
  const res = { at: new Date().toISOString(), drafts: 0, images: 0, skipped: 0, errors: [] };
  try {
    const author = (c.authorEmail && db.prepare('SELECT id FROM users WHERE email = ?').get(c.authorEmail))
      || db.prepare(`SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`).get();
    for (const g of c.groups) {
      try {
        const r = await ingest(db, await fetchGroup(c, g, fetch), c, { saveImg: (m) => saveImage(c, m, uploadsDir, fetch), authorId: author && author.id, now });
        for (const k of ['drafts', 'images', 'skipped']) res[k] += r[k];
      } catch (e) { res.errors.push(`${g}: ${e.message}`); }
    }
  } finally { busy = false; }
  if (res.drafts) console.log(`[whatsapp] ${res.drafts} new draft(s)`);
  res.errors.forEach((e) => console.error(`[whatsapp] ${e}`));
  return (lastRun = res);
}

module.exports = { pull, ingest, toArticle, fromWaha, config, enabled, status: () => lastRun };
