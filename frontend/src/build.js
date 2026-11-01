// Builds the whole site into dist/ (GitHub Pages): pages rendered from the backend API's data, plus public/
// (CSS, fonts, JS, logo) and the backend's content/images/, downloaded from the API.
// Usage: API_URL=http://localhost:4000 SITE_URL=https://example.com npm run build
// (SITE_URL may end in a sub-path, e.g. https://user.github.io/repo). If the API can't be read the build fails.
const fs = require('fs');
const path = require('path');
const { renderSite } = require('./render');
const { connect } = require('./api');

const ROOT = path.join(__dirname, '..');

// data: what api.fetchSite() returns
function build({ data, publicDir = path.join(ROOT, 'public'), outDir = path.join(ROOT, 'dist'),
  siteUrl = process.env.SITE_URL || 'http://localhost:3000', now = new Date() }) {
  const files = renderSite({ ...data, siteUrl, now });
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.cpSync(publicDir, outDir, { recursive: true, filter: (src) => !src.endsWith('.txt') });
  for (const [file, body] of files) {
    const p = path.join(outDir, file);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
  return { files: files.size, articles: data.articles.length };
}

// build() from the API, then every file in the backend's content/images/
async function buildAll({ apiUrl = process.env.API_URL, outDir = path.join(ROOT, 'dist'), ...opts } = {}) {
  if (!apiUrl) throw new Error('API_URL (the backend service) is not set');
  const api = connect(apiUrl);
  const data = await api.fetchSite();
  const r = build({ ...opts, outDir, data });
  for (const rel of data.images || []) {
    const res = await api.image(rel);
    if (!res.ok) throw new Error(`Backend API: ${rel} gave HTTP ${res.status}`);
    const p = path.join(outDir, rel);
    if (!p.startsWith(outDir + path.sep)) continue;
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, Buffer.from(await res.arrayBuffer()));
  }
  return { ...r, images: (data.images || []).length };
}

if (require.main === module) {
  buildAll().then((r) => console.log(`Built ${r.files} files and ${r.images} images (${r.articles} published stories) into dist/`), (e) => {
    console.error(e.message);
    process.exit(1);
  });
}

module.exports = { build, buildAll };
