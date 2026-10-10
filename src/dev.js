// Local preview: builds the site, then serves dist/ on http://localhost:3000 the way GitHub Pages does
// (folder → index.html, /x → /x/, missing → 404.html). `npm run dev` rebuilds when content/, src/ or public/ changes.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { build } = require('./build');

const port = Number(process.env.PORT) || 3000;
const OUT = path.join(__dirname, '..', 'dist');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.xml': 'application/xml',
  '.txt': 'text/plain', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.pdf': 'application/pdf' };

try {
  const r = build({ siteUrl: `http://localhost:${port}` });
  console.log(`Built ${r.files} files (${r.articles} published stories)`);
} catch (e) {
  console.error(e.message);
  process.exit(1); // npm run dev waits for the next file change
}

http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { p = '/'; }
  let f = path.join(OUT, p);
  if (!f.startsWith(OUT)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) {
    if (!p.endsWith('/')) { res.writeHead(301, { Location: encodeURI(p) + '/' }).end(); return; }
    f = path.join(f, 'index.html');
  }
  const found = fs.existsSync(f);
  if (!found) f = path.join(OUT, '404.html');
  res.writeHead(found ? 200 : 404, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(port, () => console.log(`Preview on http://localhost:${port}`));
