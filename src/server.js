// The website as a dynamic app (Render web service). It serves the same pages as the static build, rendered from
// content/ plus the approved news and published e-papers in the news desk app's MongoDB (src/mongo.js).
// Every REFRESH_SECONDS it reads the database again, so approved news, scheduled stories and ad dates show up within
// that time without a rebuild. Pages are rendered when first asked for and kept until the next refresh.
//
// Environment (see render.yaml):
//   PORT             set by Render (default 3000)
//   SITE_URL         public address; Render's RENDER_EXTERNAL_URL is used when it is not set
//   MONGODB_URI      the desk app's database, ideally a read-only user; without it only content/ is shown
//   DESK_APP_URL     the desk app's address, for e-paper reader links (<app>/e/<link>)
//   NEWS_DAYS        days of approved news in the lists (default 90); older stories still open by their link
//   REFRESH_SECONDS  how often the database is read again (default 120)
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { load, remoteArticle } = require('./content');
const { createSite } = require('./render');

const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.pdf': 'application/pdf', '.ico': 'image/x-icon' };
const GZIP = /^(text\/|application\/(json|xml)|image\/svg)/;
const CACHE_MAX = 2000; // rendered pages kept between refreshes

function createServer({ contentDir = path.join(ROOT, 'content'), publicDir = path.join(ROOT, 'public'), siteUrl, db, days = 90,
  deskUrl = '', log = console } = {}) {
  const BP = new URL(siteUrl.replace(/\/?$/, '/')).pathname.replace(/\/$/, ''); // '' or '/sub-path'
  let site, cats, remote, cache = new Map(), loadedFromDb = !db;

  // Reads content/ and the database and swaps in the new site. If the database can't be read, the last news is kept.
  async function refresh() {
    if (db) {
      try { remote = await db.fetchFromMongo({ days, base: deskUrl }); loadedFromDb = true; } catch (e) { log.error(`MongoDB read failed, keeping the last news: ${e.message}`); }
    }
    const now = new Date();
    const data = load(contentDir, now, remote);
    site = createSite({ ...data, siteUrl, now });
    cats = data.cats;
    cache = new Map();
    return site;
  }

  const remember = (key, v) => {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, v);
    return v;
  };
  const entry = (body, type) => ({ body: Buffer.from(body), type });

  // A story older than NEWS_DAYS: looked up by its id. Misses are kept too, so a bad link doesn't hit the database each time.
  async function oldStory(file) {
    const m = /^(te\/)?article\/([a-f0-9]{24})\/index\.html$/.exec(file);
    if (!db || !m) return null;
    if (cache.has(file)) return cache.get(file);
    let found = null;
    try {
      const n = await db.findNews(m[2]);
      if (n && new Date(n.approvedAt) <= new Date()) {
        found = entry(site.article(m[1] ? 'te' : 'en', remoteArticle(n, cats)), TYPES['.html']);
      }
    } catch (e) { log.error(`Story ${m[2]}: ${e.message}`); return null; }
    return remember(file, found);
  }

  function page(file) {
    if (cache.has(file)) return cache.get(file);
    const fn = site.routes.get(file);
    return fn ? remember(file, entry(fn(), TYPES[path.extname(file)] || TYPES['.html'])) : null;
  }

  // public/ (CSS, JS, fonts, logo; not the .txt notes) and content/images/ → /images/
  function staticFile(rel) {
    const [dir, sub] = rel.startsWith('images/') ? [path.join(contentDir, 'images'), rel.slice(7)] : [publicDir, rel];
    const f = path.join(dir, sub);
    if (!f.startsWith(dir + path.sep) || f.endsWith('.txt') || f.endsWith('.gitkeep')) return null;
    try { return fs.statSync(f).isFile() ? f : null; } catch { return null; }
  }

  function send(req, res, status, { body, type }, maxAge) {
    const headers = { 'Content-Type': type, 'Cache-Control': `public, max-age=${maxAge}`, 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin', Vary: 'Accept-Encoding' };
    if (GZIP.test(type) && body.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      body = zlib.gzipSync(body);
      headers['Content-Encoding'] = 'gzip';
    }
    headers['Content-Length'] = body.length;
    res.writeHead(status, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  async function handle(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    let p;
    try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { p = '/'; }
    if (p === '/healthz') return res.writeHead(loadedFromDb ? 200 : 503, { 'Content-Type': 'text/plain' }).end(loadedFromDb ? 'ok' : 'waiting for MongoDB');
    if (BP && !(p + '/').startsWith(BP + '/')) return send(req, res, 404, page('404.html'), 60);
    p = p.slice(BP.length) || '/';
    const file = p.replace(/^\/+/, '') + (p.endsWith('/') ? 'index.html' : '');
    const hit = page(file) || (await oldStory(file));
    if (hit) return send(req, res, 200, hit, 60);
    // /article/x → /article/x/, like GitHub Pages
    if (!p.endsWith('/') && (site.routes.has(file + '/index.html') || /^\/(te\/)?article\/[a-f0-9]{24}$/.test(p))) {
      return res.writeHead(301, { Location: encodeURI(BP + p + '/') }).end();
    }
    const f = staticFile(file);
    if (f) return send(req, res, 200, { body: fs.readFileSync(f), type: TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream' }, /\.(woff2|jpe?g|png|webp)$/i.test(f) ? 86400 : 3600);
    send(req, res, 404, page('404.html'), 60);
  }

  const server = http.createServer((req, res) => handle(req, res).catch((e) => {
    log.error(e);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Server error');
  }));
  return { server, refresh };
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const siteUrl = process.env.SITE_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`;
  const db = process.env.MONGODB_URI ? require('./mongo').connect(process.env.MONGODB_URI) : null;
  const { server, refresh } = createServer({ siteUrl, db, days: Number(process.env.NEWS_DAYS) || 90, deskUrl: process.env.DESK_APP_URL || '' });
  const every = Math.max(30, Number(process.env.REFRESH_SECONDS) || 120) * 1000;
  // A mistake in content/ stops the start, so Render keeps the previous deploy live
  refresh().then((site) => {
    server.listen(port, () => console.log(`Site on ${siteUrl} (port ${port}, ${site.routes.size} pages${db ? ', reading news from MongoDB' : ', content/ only'})`));
    setInterval(() => refresh().catch((e) => console.error(`Refresh failed: ${e.message}`)), every).unref();
  }, (e) => { console.error(e.message); process.exit(1); });
  process.on('SIGTERM', () => server.close(() => (db ? db.close() : Promise.resolve()).finally(() => process.exit(0))));
}

module.exports = { createServer };
