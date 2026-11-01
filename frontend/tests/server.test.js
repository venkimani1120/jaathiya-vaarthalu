// Starts the frontend (src/server.js) on a free port against a stand-in backend API and checks the pages, redirects,
// static files, images, old stories by id and that a refresh picks up new data. Run: npm test
const assert = require('node:assert');
const zlib = require('zlib');
const { createServer } = require('../src/server');
const { connect } = require('../src/api');
const { apiData, stubApi, ID, OLD } = require('./fixture');

(async () => {
  const state = { data: apiData() };
  const stub = await stubApi(state);
  const real = connect(stub.url);
  // Fails at once when state.down (the real client retries for a while first)
  const api = { ...real, fetchSite: () => (state.down ? Promise.reject(new Error('down')) : real.fetchSite()) };
  const { server, refresh } = createServer({ siteUrl: 'https://jv.example', api, log: { error() {} } });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (p, h = {}) => { const r = await fetch(base + p, { redirect: 'manual', headers: h }); return { s: r.status, h: r.headers, t: await r.text() }; };
  try {
    // Nothing to show until the first API read
    assert((await get('/healthz')).s === 503 && (await get('/')).s === 503);
    state.down = true;
    await assert.rejects(refresh(), /down/);
    state.down = false;
    await refresh();

    assert.strictEqual((await get('/healthz')).t, 'ok');
    const home = await get('/');
    assert(home.s === 200 && home.t.includes('భారత్ ఘన విజయం') && home.h.get('content-type').startsWith('text/html'));
    assert((await get('/te/')).t.includes('<html lang="te">'));
    assert((await get(`/article/${ID}/`)).t.includes('రూ.45 లక్షలు'));
    assert.strictEqual((await get('/te')).h.get('location'), '/te/');
    assert.strictEqual((await get(`/article/${OLD}`)).h.get('location'), `/article/${OLD}/`);
    assert((await get(`/te/article/${OLD}/`)).t.includes('పాత వార్త'), 'stories older than NEWS_DAYS open by their id');
    assert.strictEqual((await get(`/article/${'9'.repeat(24)}/`)).s, 404);
    assert((await get('/epaper/')).t.includes('href="https://desk.example/e/gnt-1010"'));
    assert((await get('/css/site.css')).s === 200 && (await get('/fonts/README.txt')).s === 404 && (await get('/../package.json')).s === 404);
    const img = await get('/images/win.jpg');
    assert(img.s === 200 && img.t === 'jpeg /images/win.jpg' && img.h.get('content-type') === 'image/jpeg', 'images come from the API');
    assert((await get('/images/missing.jpg')).s === 404 && (await get('/images/.env')).s === 404);
    assert(JSON.parse((await get('/search-index.json')).t).length >= 1 && (await get('/sitemap.xml')).t.includes('https://jv.example/'));
    assert((await get('/nope/')).s === 404 && (await get('/nope/')).t.includes('noindex'));
    assert.strictEqual((await fetch(base + '/', { method: 'POST' })).status, 405);
    // gzip for pages (Node's fetch unpacks it, so ask with a raw request)
    const raw = await new Promise((r) => require('http').get(base + '/', { headers: { 'accept-encoding': 'gzip' } }, (res) => {
      const parts = []; res.on('data', (c) => parts.push(c)); res.on('end', () => r({ enc: res.headers['content-encoding'], body: Buffer.concat(parts) }));
    }));
    assert(raw.enc === 'gzip' && zlib.gunzipSync(raw.body).toString().includes('భారత్ ఘన విజయం'));

    // New data shows after the next refresh; a failed read keeps the last site
    state.data.articles.unshift({ ...state.data.articles[0], slug: 'kotha', title: 'కొత్తగా ఆమోదించిన వార్త', date: '2026-10-10T05:00:00.000Z' });
    assert(!(await get('/')).t.includes('కొత్తగా ఆమోదించిన'));
    await refresh();
    assert((await get('/')).t.includes('కొత్తగా ఆమోదించిన'));
    state.down = true;
    await refresh();
    assert((await get('/')).t.includes('కొత్తగా ఆమోదించిన'), 'last site kept when the API fails');
    console.log('all server checks passed');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    server.close();
    stub.server.close();
  }
})();
