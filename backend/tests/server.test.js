// Starts the API (src/server.js) on a free port with a stand-in for the desk app's MongoDB and checks /api/site,
// stories by id, images, gzip and that a refresh picks up newly approved news. Run: npm test
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { createServer } = require('../src/server');
const { toItem } = require('../src/mongo');

const ID = '1'.repeat(24), OLD = '2'.repeat(24), NEW = '3'.repeat(24), LATER = '4'.repeat(24);
const story = (id, title, approvedAt) => ({ id, title, highlights: ['ముఖ్యాంశం'], body: 'పేరా', images: [], section: 'state', author: 'రాజేష్', approvedAt, updatedAt: approvedAt });
const db = {
  news: [story(ID, 'తాజా వార్త', '2026-10-01T05:00:00Z')],
  async fetchFromMongo({ base }) { return { base, news: this.news, epapers: [{ title: 'Guntur', editionDate: '2026-10-01T00:00:00Z', shareSlug: 'g1' }] }; },
  async findNews(id) { return id === OLD ? story(OLD, 'పాత వార్త', '2025-01-01T05:00:00Z') : id === LATER ? story(LATER, 'x', '2999-01-01T00:00:00Z') : null; },
};

// A desk news document becomes the API shape; desk-made news has no reviewedAt, so its creation time counts
const item = toItem({ _id: ID, title: 't', body: 'b', author: 'u1', createdAt: new Date('2026-10-01T00:00:00Z') }, new Map([['u1', 'పేరు']]));
assert(item.id === ID && item.author === 'పేరు' && item.approvedAt.toISOString() === '2026-10-01T00:00:00.000Z' && item.highlights.length === 0);

// The real content/ plus one image in a sub-folder
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-api-srv-'));
const contentDir = path.join(tmp, 'content');
fs.cpSync(path.join(__dirname, '..', 'content'), contentDir, { recursive: true });
fs.mkdirSync(path.join(contentDir, 'images', '2026'), { recursive: true });
fs.writeFileSync(path.join(contentDir, 'images', '2026', 'a.jpg'), 'jpeg');

(async () => {
  const { server, refresh } = createServer({ contentDir, db, deskUrl: 'https://desk.example/', log: { error() {} } });
  await refresh();
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (p) => { const r = await fetch(base + p); return { s: r.status, h: r.headers, t: await r.text() }; };
  try {
    assert.strictEqual((await get('/healthz')).t, 'ok');
    const s = await get('/api/site');
    assert(s.s === 200 && s.h.get('content-type').startsWith('application/json'));
    const d = JSON.parse(s.t);
    const a = d.articles.find((x) => x.slug === ID);
    assert(a && a.title === 'తాజా వార్త' && a.section === 'state' && a.date === '2026-10-01T05:00:00.000Z' && !('cat' in a), 'stories carry their section slug');
    assert(d.site.name_en && d.cats.length && Array.isArray(d.ads) && d.generatedAt);
    assert.deepStrictEqual(d.editions.find((e) => e.link), { date: '2026-10-01', link: 'https://desk.example/e/g1', name: 'Guntur' });
    assert(d.images.includes('images/2026/a.jpg') && !d.images.some((f) => f.endsWith('.gitkeep')));

    const old = JSON.parse((await get(`/api/news/${OLD}`)).t);
    assert(old.title === 'పాత వార్త' && old.summary === 'ముఖ్యాంశం' && old.section === 'state', 'stories older than NEWS_DAYS open by their id');
    assert.strictEqual((await get(`/api/news/${'9'.repeat(24)}`)).s, 404);
    assert.strictEqual((await get(`/api/news/${LATER}`)).s, 404, 'not before its time');
    assert.strictEqual((await get('/api/news/nope')).s, 404);

    const img = await get('/images/2026/a.jpg');
    assert(img.s === 200 && img.t === 'jpeg' && img.h.get('content-type') === 'image/jpeg');
    assert((await get('/images/.gitkeep')).s === 404 && (await get('/images/../site.json')).s === 404 && (await get('/nope')).s === 404);
    assert.strictEqual((await fetch(base + '/api/site', { method: 'POST' })).status, 405);

    // gzip (Node's fetch unpacks it, so ask with a raw request)
    const raw = await new Promise((r) => require('http').get(base + '/api/site', { headers: { 'accept-encoding': 'gzip' } }, (res) => {
      const parts = []; res.on('data', (c) => parts.push(c)); res.on('end', () => r({ enc: res.headers['content-encoding'], body: Buffer.concat(parts) }));
    }));
    assert(raw.enc === 'gzip' && JSON.parse(zlib.gunzipSync(raw.body)).articles.length === d.articles.length);

    // Newly approved news shows after the next refresh; a failed read keeps the last news
    db.news = [story(NEW, 'కొత్తగా ఆమోదించిన వార్త', '2026-10-02T05:00:00Z'), ...db.news];
    assert(!(await get('/api/site')).t.includes('కొత్తగా ఆమోదించిన'));
    await refresh();
    assert((await get('/api/site')).t.includes('కొత్తగా ఆమోదించిన'));
    const fetchOk = db.fetchFromMongo;
    db.fetchFromMongo = async () => { throw new Error('down'); };
    await refresh();
    assert((await get('/api/site')).t.includes('కొత్తగా ఆమోదించిన'), 'last news kept when MongoDB fails');
    db.fetchFromMongo = fetchOk;
    console.log('all API checks passed');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();
