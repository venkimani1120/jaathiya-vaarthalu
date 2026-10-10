// Checks the WhatsApp group feed (server/whatsapp.js) against a fake WAHA gateway and an in-memory DB. Run: npm test
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { pull, toArticle } = require('../server/whatsapp.js');

const raw = new DatabaseSync(':memory:');
raw.exec('PRAGMA foreign_keys = ON;');
raw.exec(fs.readFileSync(path.join(__dirname, '..', 'server', 'db', 'schema.sql'), 'utf8'));
const db = { prepare: (q) => { const st = raw.prepare(q); return { all: (...a) => st.all(...a), get: (...a) => st.get(...a), run: (...a) => st.run(...a) }; } };
raw.exec(`INSERT INTO users(name,email,password_hash,role) VALUES('Admin','a@b.c','x','admin'), ('Desk','desk@b.c','x','editor')`);

const G = '120363000000000001@g.us';
const NOW = Date.parse('2026-10-10T06:00:00Z');
const ts = (min) => Math.floor((NOW - min * 60e3) / 1000); // minutes ago
const msg = (id, min, from, body, extra = {}) => ({ id: `false_${G}_${id}`, timestamp: ts(min), from: G, participant: `${from}@c.us`, body, _data: { notifyName: 'Ravi' }, ...extra });
const photo = (url) => ({ hasMedia: true, media: { url, mimetype: 'image/jpeg' } });

const RAVI = '919876543210', SITA = '919123456789';
let feed = [
  msg('A1', 30, RAVI, '', photo('http://localhost:3000/api/files/default/A1.jpeg')),            // photo first …
  msg('A2', 28, RAVI, '*గుంటూరులో భారీ వర్షం*\nనగరంలో ఉదయం నుంచి భారీ వర్షం కురుస్తోంది.\nపలు కాలనీలు జలమయమయ్యాయి.'), // … then the story
  msg('B1', 20, SITA, 'ok 👍'),                                                                   // chatter: skipped
  msg('C1', 15, SITA, 'Narasaraopet market committee elections announced for next month, says collector'),
  msg('C2', 14, SITA, '', photo('http://evil.example/steal?x=1')),                                // photo after the story
  msg('D1', 26 * 60, RAVI, 'An old message from yesterday that is long enough to be news but too old'),
];
const calls = [];
const fakeFetch = async (url, o = {}) => {
  calls.push({ url, headers: o.headers });
  if (url.includes('/messages?')) return { ok: true, status: 200, json: async () => feed };
  if (url.includes('/api/files/') || url.includes('/steal')) return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('JPEGDATA').buffer };
  return { ok: false, status: 404, json: async () => ({}) };
};
const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-test-'));
const env = { WAHA_URL: 'http://127.0.0.1:3001/', WAHA_API_KEY: 'secret', WHATSAPP_GROUPS: G, WHATSAPP_AUTHOR_EMAIL: 'desk@b.c' };

(async () => {
  // title/body conversion
  const t = toArticle('*Big news* today\nFirst para with *bold*.\n\nSecond <para>');
  assert.strictEqual(t.title, 'Big news today');
  assert.strictEqual(t.body, '<p>First para with <b>bold</b>.</p><p>Second &lt;para&gt;</p>');

  // off until configured
  assert.strictEqual(await pull({ db, env: {}, fetch: fakeFetch }), null);
  assert.strictEqual(calls.length, 0);

  const r = await pull({ db, env, fetch: fakeFetch, uploadsDir, now: NOW });
  assert.deepStrictEqual({ d: r.drafts, i: r.images, s: r.skipped, e: r.errors }, { d: 2, i: 2, s: 2, e: [] });
  assert.strictEqual(calls[0].url, `http://127.0.0.1:3001/api/default/chats/${encodeURIComponent(G)}/messages?limit=50&downloadMedia=true`);
  assert.strictEqual(calls[0].headers['X-Api-Key'], 'secret');
  // media is always fetched from WAHA_URL, never from the host inside the message
  assert(calls.slice(1).every((c) => c.url.startsWith('http://127.0.0.1:3001/')), 'no fetch outside the gateway');
  assert(calls.some((c) => c.url === 'http://127.0.0.1:3001/steal?x=1'));

  const arts = raw.prepare('SELECT title, body, image_path, status, author_id FROM articles ORDER BY id').all();
  assert.strictEqual(arts.length, 2);
  assert(arts.every((a) => a.status === 'draft' && a.author_id === 2), 'drafts only, by WHATSAPP_AUTHOR_EMAIL');
  assert.strictEqual(arts[0].title, 'గుంటూరులో భారీ వర్షం');
  assert.strictEqual(arts[0].body, '<p>నగరంలో ఉదయం నుంచి భారీ వర్షం కురుస్తోంది.</p><p>పలు కాలనీలు జలమయమయ్యాయి.</p>');
  assert.match(arts[0].image_path, /^\/uploads\/images\/wa-.+\.jpg$/, 'photo sent before the story is used');
  assert.match(arts[1].image_path || '', /^\/uploads\/images\/wa-/, 'photo sent after the story is attached');
  assert(fs.existsSync(path.join(uploadsDir, path.basename(arts[0].image_path))));
  const st = Object.fromEntries(raw.prepare('SELECT wa_id, status FROM wa_messages').all().map((m) => [m.wa_id.split('_').pop(), m.status]));
  assert.deepStrictEqual(st, { A1: 'image', A2: 'draft', B1: 'skipped', C1: 'draft', C2: 'image', D1: 'skipped' });
  assert.strictEqual(raw.prepare(`SELECT COUNT(*) n FROM audit_log WHERE action = 'whatsapp-import'`).get().n, 2);

  // the same messages again: nothing new
  const again = await pull({ db, env, fetch: fakeFetch, uploadsDir, now: NOW });
  assert.deepStrictEqual([again.drafts, again.images, again.skipped], [0, 0, 0]);
  assert.strictEqual(raw.prepare('SELECT COUNT(*) n FROM articles').get().n, 2);

  // sender allowlist: messages from others are skipped
  feed = [msg('E1', 5, SITA, 'Another long enough report from a sender who is not on the reporters list')];
  const only = await pull({ db, env: { ...env, WHATSAPP_SENDERS: '98765 43210' }, fetch: fakeFetch, uploadsDir, now: NOW });
  assert.deepStrictEqual([only.drafts, only.skipped], [0, 1]);

  // gateway errors are reported, not thrown
  const bad = await pull({ db, env, fetch: async () => ({ ok: false, status: 401 }), uploadsDir, now: NOW });
  assert.deepStrictEqual(bad.errors, [`${G}: WAHA 401 for group ${G}`]);

  // deleting a draft keeps the message log
  raw.exec('DELETE FROM articles WHERE id = 1');
  assert.strictEqual(raw.prepare(`SELECT article_id FROM wa_messages WHERE wa_id LIKE '%A2'`).get().article_id, null);

  fs.rmSync(uploadsDir, { recursive: true, force: true });
  console.log('all whatsapp checks passed');
})().catch((err) => { console.error(err); process.exit(1); });
