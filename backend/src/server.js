// The backend service: the website's data as a JSON API. It owns content/ (checked by content.js) and reads approved
// news and published e-papers from the news desk app's MongoDB (mongo.js), or from the desk app's public API
// (remote.js) when there is no MONGODB_URI. The frontend service (frontend/) renders the pages from this API.
// Every REFRESH_SECONDS it reads the database again, so approved news, scheduled stories and ad dates show up
// within that time without a redeploy.
//
// API (all GET; JSON is UTF-8 and gzipped when asked for):
//   /api/site       { generatedAt, site, cats, articles, editions, ads, images }: everything the pages need.
//                   articles: { slug, title, summary, body, image, section, author, date, updated, breaking }
//                   (section = a cats slug or ''; dates ISO), newest first; images: files under content/images/
//   /api/news/<id>  one desk story by its Mongo id, same shape as an articles item, for stories older than
//                   NEWS_DAYS; 404 when missing, not approved or not yet due
//   /images/<path>  the files in content/images/
//   /healthz        503 until the first read of the news source succeeds
//
// Environment (see render.yaml):
//   PORT             set by Render (default 4000)
//   MONGODB_URI      the desk app's database, ideally a read-only user
//   NEWS_API_URL     the desk app's public API, used only when MONGODB_URI is not set (the GitHub Pages build)
//   DESK_APP_URL     the desk app's address, for e-paper reader links (<app>/e/<link>)
//   NEWS_DAYS        days of approved news in /api/site (default 90); older stories still open via /api/news/<id>
//   REFRESH_SECONDS  how often the news source is read again (default 120)
// Without MONGODB_URI and NEWS_API_URL only content/ is served.
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { load, remoteArticle } = require('./content');

const ROOT = path.join(__dirname, '..');
const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.pdf': 'application/pdf' };
const JSON_TYPE = 'application/json; charset=utf-8';

// A loaded story → its API shape (cat object → section slug; Dates become ISO strings in JSON)
const toJson = ({ cat, ...a }) => ({ ...a, section: cat ? cat.slug : '' });

function listImages(dir, rel = '') {
  let out = [];
  for (const d of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
    if (d.name.startsWith('.')) continue;
    const r = rel ? `${rel}/${d.name}` : d.name;
    out = d.isDirectory() ? out.concat(listImages(path.join(dir, d.name), r)) : out.concat(`images/${r}`);
  }
  return out;
}

// db: { fetchFromMongo({ days, base }), findNews(id) } from mongo.js (or remote.js wrapped alike); none = content/ only
function createServer({ contentDir = path.join(ROOT, 'content'), db, days = 90, deskUrl = '', log = console } = {}) {
  let cats = [], body, gz, loadedFromDb = !db, remote;

  // Reads content/ and the news source and swaps in the new data. If the news source fails, the last news is kept.
  // A content/ mistake throws (and stops the start).
  async function refresh() {
    if (db) {
      try { remote = await db.fetchFromMongo({ days, base: deskUrl }); loadedFromDb = true; } catch (e) { log.error(`News read failed, keeping the last news: ${e.message}`); }
    }
    const now = new Date();
    const data = load(contentDir, now, remote);
    cats = data.cats;
    body = Buffer.from(JSON.stringify({ generatedAt: now, ...data, articles: data.articles.map(toJson), images: listImages(path.join(contentDir, 'images')) }));
    gz = zlib.gzipSync(body);
    return data;
  }

  function send(req, res, status, buf, type, maxAge, zipped) {
    const headers = { 'Content-Type': type, 'Cache-Control': `public, max-age=${maxAge}`, 'X-Content-Type-Options': 'nosniff', Vary: 'Accept-Encoding' };
    if (/^(application\/json|image\/svg)/.test(type) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      buf = zipped || zlib.gzipSync(buf);
      headers['Content-Encoding'] = 'gzip';
    }
    headers['Content-Length'] = buf.length;
    res.writeHead(status, headers);
    res.end(req.method === 'HEAD' ? undefined : buf);
  }
  const sendJson = (req, res, status, v, maxAge = 0) => send(req, res, status, Buffer.from(JSON.stringify(v)), JSON_TYPE, maxAge);

  async function handle(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    let p;
    try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { p = '/'; }
    if (p === '/healthz') return res.writeHead(loadedFromDb ? 200 : 503, { 'Content-Type': 'text/plain' }).end(loadedFromDb ? 'ok' : 'waiting for the news source');
    if (p === '/api/site') return send(req, res, 200, body, JSON_TYPE, 30, gz);
    const m = /^\/api\/news\/([a-f0-9]{24})$/.exec(p);
    if (m) {
      const n = db && (await db.findNews(m[1]));
      if (n && new Date(n.approvedAt) <= new Date()) return sendJson(req, res, 200, toJson(remoteArticle(n, cats)), 60);
      return sendJson(req, res, 404, { error: 'not found' });
    }
    if (p.startsWith('/images/')) {
      const dir = path.join(contentDir, 'images');
      const f = path.join(dir, p.slice(8));
      let ok = false;
      try { ok = f.startsWith(dir + path.sep) && !path.basename(f).startsWith('.') && fs.statSync(f).isFile(); } catch {}
      if (ok) return send(req, res, 200, fs.readFileSync(f), TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream', 86400);
    }
    sendJson(req, res, 404, { error: 'not found' });
  }

  const server = http.createServer((req, res) => handle(req, res).catch((e) => {
    log.error(e);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Server error');
  }));
  return { server, refresh };
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 4000;
  const days = Number(process.env.NEWS_DAYS) || 90;
  let db = null;
  if (process.env.MONGODB_URI) db = require('./mongo').connect(process.env.MONGODB_URI);
  else if (process.env.NEWS_API_URL) {
    const { fetchRemote } = require('./remote');
    db = { fetchFromMongo: () => fetchRemote(process.env.NEWS_API_URL, { days }), findNews: async () => null };
  }
  const { server, refresh } = createServer({ db, days, deskUrl: process.env.DESK_APP_URL || '' });
  const every = Math.max(30, Number(process.env.REFRESH_SECONDS) || 120) * 1000;
  // A mistake in content/ stops the start, so Render keeps the previous deploy live
  refresh().then((data) => {
    const from = process.env.MONGODB_URI ? 'MongoDB' : process.env.NEWS_API_URL ? 'the desk app API' : 'content/ only';
    server.listen(port, () => console.log(`API on port ${port} (${data.articles.length} stories, news from ${from})`));
    setInterval(() => refresh().catch((e) => console.error(`Refresh failed: ${e.message}`)), every).unref();
  }, (e) => { console.error(e.message); process.exit(1); });
  process.on('SIGTERM', () => server.close(() => (db && db.close ? db.close() : Promise.resolve()).finally(() => process.exit(0))));
}

module.exports = { createServer, toJson };
