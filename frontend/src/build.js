// Builds the whole site into dist/: pages from content/ (JSON), plus public/ (CSS, fonts, JS, logo) and content/images/.
// Usage: SITE_URL=https://example.com npm run build   (SITE_URL may end in a sub-path, e.g. https://user.github.io/repo)
// NEWS_API_URL=https://<desk app>.onrender.com also adds the desk app's approved news and published e-papers
// (NEWS_DAYS, default 90: how many days of approved news are shown). See src/remote.js.
const fs = require('fs');
const path = require('path');
const { load } = require('./content');
const { renderSite } = require('./render');
const { fetchRemote } = require('./remote');

const ROOT = path.join(__dirname, '..');

function build({ contentDir = path.join(ROOT, 'content'), publicDir = path.join(ROOT, 'public'), outDir = path.join(ROOT, 'dist'),
  siteUrl = process.env.SITE_URL || 'http://localhost:3000', now = new Date(), remote } = {}) {
  const data = load(contentDir, now, remote);
  const files = renderSite({ ...data, siteUrl, now });
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.cpSync(publicDir, outDir, { recursive: true, filter: (src) => !src.endsWith('.txt') });
  const images = path.join(contentDir, 'images');
  if (fs.existsSync(images)) fs.cpSync(images, path.join(outDir, 'images'), { recursive: true, filter: (src) => !src.endsWith('.gitkeep') });
  for (const [file, body] of files) {
    const p = path.join(outDir, file);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
  return { files: files.size, articles: data.articles.length };
}

// build() plus the desk app's news when NEWS_API_URL is set (used by npm run build and npm run dev)
async function buildAll(opts = {}) {
  const api = process.env.NEWS_API_URL;
  const remote = api ? await fetchRemote(api, { days: Number(process.env.NEWS_DAYS) || 90 }) : undefined;
  if (remote) console.log(`Desk app: ${remote.news.length} approved stories, ${remote.epapers.length} e-papers`);
  return build({ ...opts, remote });
}

if (require.main === module) {
  buildAll().then((r) => console.log(`Built ${r.files} files (${r.articles} published stories) into dist/`), (e) => {
    console.error(e.message);
    process.exit(1);
  });
}

module.exports = { build, buildAll };
