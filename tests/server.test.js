// Starts the dynamic site (src/server.js) on a free port with a stand-in for the desk app's MongoDB, and checks
// the pages, redirects, static files, old stories by id and that a refresh picks up newly approved news. Run: npm test
const assert = require('node:assert');
const zlib = require('zlib');
const { createServer } = require('../src/server');
const { toItem } = require('../src/mongo');

const ID = '1'.repeat(24), OLD = '2'.repeat(24), NEW = '3'.repeat(24);
const story = (id, title, approvedAt) => ({ id, title, highlights: ['ముఖ్యాంశం'], body: 'పేరా', images: [], section: 'state', author: 'రాజేష్', approvedAt, updatedAt: approvedAt });
const db = {
  news: [story(ID, 'తాజా వార్త', '2026-10-01T05:00:00Z')],
  async fetchFromMongo({ base }) { return { base, news: this.news, epapers: [{ title: 'Guntur', editionDate: '2026-10-01T00:00:00Z', shareSlug: 'g1' }] }; },
  async findNews(id) { return id === OLD ? story(OLD, 'పాత వార్త', '2025-01-01T05:00:00Z') : null; },
};

// A desk news document becomes the API shape; desk-made news has no reviewedAt, so its creation time counts
const item = toItem({ _id: ID, title: 't', body: 'b', author: 'u1', createdAt: new Date('2026-10-01T00:00:00Z') }, new Map([['u1', 'పేరు']]));
assert(item.id === ID && item.author === 'పేరు' && item.approvedAt.toISOString() === '2026-10-01T00:00:00.000Z' && item.highlights.length === 0);

(async () => {
  const { server, refresh } = createServer({ siteUrl: 'https://jv.example', db, deskUrl: 'https://desk.example/', log: { error() {} } });
  await refresh();
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (p, h = {}) => { const r = await fetch(base + p, { redirect: 'manual', headers: h }); return { s: r.status, h: r.headers, t: await r.text() }; };
  try {
    assert.strictEqual((await get('/healthz')).t, 'ok');
    const home = await get('/');
    assert(home.s === 200 && home.t.includes('తాజా వార్త') && home.h.get('content-type').startsWith('text/html'));
    assert((await get('/te/')).t.includes('<html lang="te">'));
    assert((await get(`/article/${ID}/`)).t.includes('ముఖ్యాంశం'));
    assert.strictEqual((await get('/te')).h.get('location'), '/te/');
    assert.strictEqual((await get(`/article/${OLD}`)).h.get('location'), `/article/${OLD}/`);
    assert((await get(`/te/article/${OLD}/`)).t.includes('పాత వార్త'), 'stories older than NEWS_DAYS open by their id');
    assert.strictEqual((await get(`/article/${'9'.repeat(24)}/`)).s, 404);
    assert((await get('/epaper/')).t.includes('href="https://desk.example/e/g1"'));
    assert((await get('/css/site.css')).s === 200 && (await get('/fonts/README.txt')).s === 404 && (await get('/../package.json')).s === 404);
    assert(JSON.parse((await get('/search-index.json')).t).length >= 1 && (await get('/sitemap.xml')).t.includes('https://jv.example/'));
    assert((await get('/nope/')).s === 404 && (await get('/nope/')).t.includes('noindex'));
    assert.strictEqual((await fetch(base + '/', { method: 'POST' })).status, 405);
    // gzip for pages (Node's fetch unpacks it, so ask with a raw request)
    const raw = await new Promise((r) => require('http').get(base + '/', { headers: { 'accept-encoding': 'gzip' } }, (res) => {
      const parts = []; res.on('data', (c) => parts.push(c)); res.on('end', () => r({ enc: res.headers['content-encoding'], body: Buffer.concat(parts) }));
    }));
    assert(raw.enc === 'gzip' && zlib.gunzipSync(raw.body).toString().includes('తాజా వార్త'));
    // Newly approved news shows after the next refresh
    db.news = [story(NEW, 'కొత్తగా ఆమోదించిన వార్త', '2026-10-02T05:00:00Z'), ...db.news];
    assert(!(await get('/')).t.includes('కొత్తగా ఆమోదించిన'));
    await refresh();
    assert((await get('/')).t.includes('కొత్తగా ఆమోదించిన'));
    console.log('all server checks passed');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    server.close();
  }
})();
