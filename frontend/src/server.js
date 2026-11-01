// The frontend service: the public website (Render web service). It renders the same pages as the static build
// from the backend service's API (src/api.js) and serves public/ (CSS, JS, fonts, logo). It holds no data of its own.
// Every REFRESH_SECONDS it reads /api/site again, so approved news, scheduled stories and ad dates show up within
// that time (plus the backend's own refresh). Pages are rendered when first asked for and kept until the next refresh.
//
// Environment (see render.yaml):
//   PORT             set by Render (default 3000)
//   SITE_URL         public address; Render's RENDER_EXTERNAL_URL is used when it is not set
//   API_URL          the backend service, e.g. https://jaathiya-vaarthalu-api.onrender.com (required)
//   REFRESH_SECONDS  how often the API is read again (default 120)
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { createSite } = require('./render');

const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.pdf': 'application/pdf', '.ico': 'image/x-icon' };
const GZIP = /^(text\/|application\/(json|xml)|image\/svg)/;
const CACHE_MAX = 2000; // rendered pages kept between refreshes

// api: { fetchSite(), findNews(id, cats), image(rel) } from src/api.js
function createServer({ publicDir = path.join(ROOT, 'public'), siteUrl, api, log = console } = {}) {
  const BP = new URL(siteUrl.replace(/\/?$/, '/')).pathname.replace(/\/$/, ''); // '' or '/sub-path'
  let site, cats, cache = new Map();

  // Reads the API and swaps in the new site. If the API can't be read, the last site is kept (and the error thrown
  // when there is none yet).
  async function refresh() {
    let data;
    try { data = await api.fetchSite(); } catch (e) {
      if (!site) throw e;
      log.error(`API read failed, keeping the last site: ${e.message}`);
      return site;
    }
    site = createSite({ ...data, siteUrl, now: new Date() });
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

  // A story older than NEWS_DAYS: looked up by its id. Misses are kept too, so a bad link doesn't hit the API each time.
  async function oldStory(file) {
    const m = /^(te\/)?article\/([a-f0-9]{24})\/index\.html$/.exec(file);
    if (!m) return null;
    if (cache.has(file)) return cache.get(file);
    let found = null;
    try {
      const a = await api.findNews(m[2], cats);
      if (a) found = entry(site.article(m[1] ? 'te' : 'en', a), TYPES['.html']);
    } catch (e) { log.error(`Story ${m[2]}: ${e.message}`); return null; }
    return remember(file, found);
  }

  function page(file) {
    if (cache.has(file)) return cache.get(file);
    const fn = site.routes.get(file);
    return fn ? remember(file, entry(fn(), TYPES[path.extname(file)] || TYPES['.html'])) : null;
  }

  // public/ (CSS, JS, fonts, logo; not the .txt notes)
  function staticFile(rel) {
    const f = path.join(publicDir, rel);
    if (!f.startsWith(publicDir + path.sep) || f.endsWith('.txt') || f.endsWith('.gitkeep')) return null;
    try { return fs.statSync(f).isFile() ? f : null; } catch { return null; }
  }

  // /images/ is the backend's content/images/, passed through so pages keep one address
  async function image(rel) {
    if (rel.split('/').some((s) => s === '..' || s.startsWith('.'))) return null;
    try {
      const r = await api.image(rel);
      if (!r.ok) return null;
      return { body: Buffer.from(await r.arrayBuffer()), type: r.headers.get('content-type') || TYPES[path.extname(rel).toLowerCase()] || 'application/octet-stream' };
    } catch (e) { log.error(`Image ${rel}: ${e.message}`); return null; }
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
    if (p === '/healthz') return res.writeHead(site ? 200 : 503, { 'Content-Type': 'text/plain' }).end(site ? 'ok' : 'waiting for the API');
    if (!site) return res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '30' }).end('Starting, please try again in a minute');
    if (BP && !(p + '/').startsWith(BP + '/')) return send(req, res, 404, page('404.html'), 60);
    p = p.slice(BP.length) || '/';
    const file = p.replace(/^\/+/, '') + (p.endsWith('/') ? 'index.html' : '');
    const hit = page(file) || (await oldStory(file));
    if (hit) return send(req, res, 200, hit, 60);
    // /article/x → /article/x/, like GitHub Pages
    if (!p.endsWith('/') && (site.routes.has(file + '/index.html') || /^\/(te\/)?article\/[a-f0-9]{24}$/.test(p))) {
      return res.writeHead(301, { Location: encodeURI(BP + p + '/') }).end();
    }
    const img = file.startsWith('images/') && (await image(file));
    if (img) return send(req, res, 200, img, 86400);
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
  if (!process.env.API_URL) { console.error('API_URL (the backend service) is not set'); process.exit(1); }
  const { server, refresh } = createServer({ siteUrl, api: require('./api').connect(process.env.API_URL) });
  const every = Math.max(30, Number(process.env.REFRESH_SECONDS) || 120) * 1000;
  const update = () => refresh().catch((e) => console.error(`Refresh failed: ${e.message}`));
  // Listen at once: /healthz stays 503 until the first API read, so Render keeps the previous deploy live until then
  server.listen(port, () => console.log(`Site on ${siteUrl} (port ${port}, data from ${process.env.API_URL})`));
  update().then((s) => s && console.log(`${s.routes.size} pages ready`));
  setInterval(update, every).unref();
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}

module.exports = { createServer };
